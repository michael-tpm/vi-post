import { getAccessToken, markNeedReconnect } from './channels';
import { prisma } from './db';
import { getProvider } from './providers';
import { ProviderError, type PostWithRelations, type PublishContext, type PublishResult } from './providers/types';

/**
 * Vòng đời bài đăng:
 *   QUEUE ──(đến giờ)──► PUBLISHING ──► PENDING (nền tảng đang xử lý) ──► PUBLISHED
 *                            │                    │
 *                            └──── lỗi ───────────┴──► ERROR (hoặc quay lại QUEUE nếu lỗi tạm thời)
 */

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_SEC = [60, 5 * 60, 15 * 60];
const MAX_CHECKS = 120; // ~3 giờ theo dõi
const STALE_MS = 2 * 60 * 60_000;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

function later(sec: number) {
  return new Date(Date.now() + sec * 1000);
}

async function loadPost(id: string): Promise<PostWithRelations> {
  return prisma.post.findUniqueOrThrow({ where: { id }, include: { channel: true, media: true } });
}

function makeContext(post: PostWithRelations, accessToken: string): PublishContext {
  const ctx: PublishContext = {
    post,
    accessToken,
    settings: JSON.parse(post.settings || '{}'),
    pendingData: post.pendingData ? JSON.parse(post.pendingData) : null,
    saveProgress: async (data) => {
      ctx.pendingData = data;
      await prisma.post.update({
        where: { id: post.id },
        data: { pendingData: data == null ? null : JSON.stringify(data) },
        select: { id: true },
      });
    },
  };
  return ctx;
}

const MAX_REFRESH_PER_RUN = 3;

/**
 * Chạy fn với token; nền tảng báo token hết hạn thì làm mới rồi chạy tiếp (tối đa 3 lần/lượt).
 * Upload YouTube dài hơn 1 giờ sẽ gặp hết hạn token giữa chừng — nhờ uploadUri đã lưu nên chạy lại là tải tiếp.
 */
async function withToken(post: PostWithRelations, fn: (ctx: PublishContext) => Promise<PublishResult>) {
  const ctx = makeContext(post, await getAccessToken(post.channelId));
  for (let i = 0; ; i++) {
    try {
      return await fn(ctx);
    } catch (err) {
      if (!(err instanceof ProviderError) || err.kind !== 'refresh' || i >= MAX_REFRESH_PER_RUN) throw err;
      ctx.accessToken = await getAccessToken(post.channelId, true); // ctx giữ nguyên pendingData mới nhất
    }
  }
}

async function applyResult(post: PostWithRelations, result: PublishResult, fromCheck: boolean) {
  if (result.status === 'published') {
    await prisma.post.update({
      where: { id: post.id },
      data: {
        state: 'PUBLISHED',
        externalId: result.externalId,
        externalUrl: result.url,
        warning: result.warning ?? null,
        error: null,
        lockedAt: null,
        nextCheckAt: null,
      },
      select: { id: true },
    });
    log(`✅ Đã đăng ${post.channel.provider} | ${post.id} | ${result.url}`);
    return;
  }
  const checkCount = fromCheck ? post.checkCount + 1 : 0;
  if (checkCount > MAX_CHECKS) {
    // giữ pendingData: bấm "Thử lại" sẽ hỏi lại nền tảng thay vì tải lên lần nữa
    await fail(post, 'Đã theo dõi hơn 3 giờ mà nền tảng chưa xử lý xong. Hãy kiểm tra trực tiếp trên app.');
    return;
  }
  const wait = result.checkInSec ?? Math.min(10 * Math.pow(1.25, checkCount), 120);
  await prisma.post.update({
    where: { id: post.id },
    data: {
      state: 'PENDING',
      pendingData: JSON.stringify(result.pendingData),
      nextCheckAt: later(wait),
      checkCount,
      lockedAt: null,
      error: null,
    },
    select: { id: true },
  });
}

async function fail(post: { id: string }, message: string, clearProgress = false) {
  await prisma.post.update({
    where: { id: post.id },
    data: { state: 'ERROR', error: message, lockedAt: null, nextCheckAt: null, ...(clearProgress ? { pendingData: null } : {}) },
    select: { id: true },
  });
  log(`❌ Lỗi ${post.id}: ${message}`);
}

async function handleError(post: PostWithRelations, err: unknown, phase: 'publish' | 'check') {
  const pe =
    err instanceof ProviderError
      ? err
      : new ProviderError('retry', 'Lỗi hệ thống không mong muốn. Sẽ tự thử lại.', String((err as any)?.stack || err));
  if (pe.raw) log(`   chi tiết (${post.channel.provider}):`, pe.raw.slice(0, 1000));

  if (pe.kind === 'reconnect') {
    await markNeedReconnect(post.channelId, pe.message).catch(() => {});
    if (phase === 'check' && !pe.restart) {
      // Bài có thể ĐANG được nền tảng đăng → không chuyển sang Lỗi (bấm Thử lại sẽ đăng trùng).
      // Tạm dừng theo dõi; kết nối lại kênh xong sẽ tự kiểm tra tiếp.
      await prisma.post.update({
        where: { id: post.id },
        data: { nextCheckAt: later(15 * 60), lockedAt: null, error: `${pe.message} — kết nối lại để tiếp tục theo dõi bài này.` },
        select: { id: true },
      });
      return;
    }
    return fail(post, pe.message, pe.restart);
  }

  if (pe.kind === 'retry' || pe.kind === 'refresh') {
    if (phase === 'check' && !pe.restart) {
      await applyResult(post, { status: 'pending', pendingData: JSON.parse(post.pendingData || 'null'), checkInSec: 60 }, true);
      return;
    }
    if (post.attempts < MAX_ATTEMPTS) {
      const wait = RETRY_BACKOFF_SEC[post.attempts - 1] ?? 15 * 60;
      await prisma.post.update({
        where: { id: post.id },
        data: {
          state: 'QUEUE',
          nextCheckAt: later(wait),
          lockedAt: null,
          checkCount: 0,
          error: `${pe.message} (lần ${post.attempts}/${MAX_ATTEMPTS})`,
          // Lần đăng cũ đã hỏng hẳn → bỏ trạng thái dở dang để đăng lại từ đầu
          ...(pe.restart ? { pendingData: null } : {}),
        },
        select: { id: true },
      });
      log(`↻ Thử lại sau ${wait}s: ${post.id} — ${pe.message}`);
      return;
    }
    return fail(post, `Đã thử ${MAX_ATTEMPTS} lần không thành công: ${pe.message}`, pe.restart);
  }

  return fail(post, pe.message, pe.restart);
}

/** Đăng các bài đã tới giờ */
export async function processDuePosts() {
  const now = new Date();
  const due = await prisma.post.findMany({
    where: {
      state: 'QUEUE',
      publishAt: { lte: now },
      OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }],
    },
    orderBy: { publishAt: 'asc' },
    take: 5,
    select: { id: true },
  });

  for (const { id } of due) {
    // Khoá bài: chỉ 1 tiến trình được đăng (tránh đăng trùng)
    const claimed = await prisma.post.updateMany({
      where: { id, state: 'QUEUE' },
      data: { state: 'PUBLISHING', lockedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;

    const post = await loadPost(id);
    log(`→ Đăng ${post.channel.provider} | ${post.id} (lần ${post.attempts})`);
    try {
      const result = await withToken(post, (ctx) => getProvider(post.channel.provider).publish(ctx));
      await applyResult(await loadPost(id), result, false);
    } catch (err) {
      const fresh = await prisma.post.findUnique({ where: { id }, include: { channel: true, media: true } });
      if (fresh) await handleError(fresh, err, 'publish'); // null = kênh vừa bị gỡ cùng bài
    }
  }
}

/** Hỏi lại trạng thái các bài nền tảng đang xử lý */
export async function processPendingPosts() {
  const now = new Date();
  const pending = await prisma.post.findMany({
    where: { state: 'PENDING', nextCheckAt: { lte: now } },
    orderBy: { nextCheckAt: 'asc' },
    take: 10,
    select: { id: true, nextCheckAt: true },
  });

  for (const p of pending) {
    const leased = await prisma.post.updateMany({
      where: { id: p.id, state: 'PENDING', nextCheckAt: p.nextCheckAt },
      data: { nextCheckAt: later(300) },
    });
    if (leased.count !== 1) continue;

    const post = await loadPost(p.id);
    const provider = getProvider(post.channel.provider);
    if (!provider.checkStatus) continue;
    try {
      const result = await withToken(post, (ctx) => provider.checkStatus!(ctx));
      await applyResult(post, result, true);
    } catch (err) {
      await handleError(post, err, 'check');
    }
  }
}

/**
 * Bài kẹt ở PUBLISHING (app bị tắt giữa lúc tải lên).
 * all = true khi worker vừa khởi động: mọi bài PUBLISHING đều là bài bị gián đoạn.
 */
export async function recoverInterrupted(all: boolean) {
  const stuck = await prisma.post.findMany({
    where: { state: 'PUBLISHING', ...(all ? {} : { lockedAt: { lt: new Date(Date.now() - STALE_MS) } }) },
    include: { channel: true },
  });
  for (const post of stuck) {
    const decision = getProvider(post.channel.provider).onInterrupted(post.pendingData ? JSON.parse(post.pendingData) : null);
    if (decision === 'resume' && post.attempts < MAX_ATTEMPTS) {
      // không trừ attempts: app sập liên tục ở cùng 1 bài thì sau 3 lần sẽ dừng hẳn
      await prisma.post.update({
        where: { id: post.id },
        data: { state: 'QUEUE', lockedAt: null, nextCheckAt: null },
        select: { id: true },
      });
      log(`↻ Tiếp tục bài bị gián đoạn: ${post.id}`);
    } else {
      await fail(
        post,
        'Bị gián đoạn khi đang tải video lên (app bị tắt). Hãy mở app kiểm tra bài đã lên chưa — nếu chưa, bấm "Thử lại".'
      );
    }
  }
}
