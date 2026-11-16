import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { isAuthorized, isSameOrigin } from '../src/lib/basic-auth';
import { readTokenResponse } from '../src/lib/providers/http';
import { tiktokProvider } from '../src/lib/providers/tiktok';
import { ProviderError } from '../src/lib/providers/types';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('Token: 5xx / HTML / 429 → thử lại, không bắt kết nối lại', async () => {
  for (const res of [new Response('<html>502</html>', { status: 502 }), new Response('{}', { status: 429 }), new Response('not json', { status: 200 })]) {
    await assert.rejects(readTokenResponse(res, 'X'), (e: any) => e instanceof ProviderError && e.kind === 'retry');
  }
  await assert.rejects(readTokenResponse(json({ error: 'invalid_grant' }, 400), 'X'), (e: any) => e.kind === 'reconnect');
  assert.equal((await readTokenResponse(json({ access_token: 'a' }), 'X')).access_token, 'a');
});

test('Mật khẩu có dấu tiếng Việt (UTF-8) vẫn đăng nhập được', () => {
  process.env.APP_PASSWORD = 'mậtkhẩu';
  const header = 'Basic ' + Buffer.from('u:mậtkhẩu', 'utf8').toString('base64');
  assert.equal(isAuthorized(header), true);
  assert.equal(isAuthorized('Basic ' + Buffer.from('u:matkhau', 'utf8').toString('base64')), false);
});

test('Chặn yêu cầu thay đổi dữ liệu từ trang web khác (CSRF)', () => {
  const mk = (origin?: string, method = 'POST') =>
    new Request('http://localhost:3000/api/posts/x', { method, headers: origin ? { origin, host: 'localhost:3000' } : {} });
  assert.equal(isSameOrigin(mk('http://localhost:3000')), true);
  assert.equal(isSameOrigin(mk('https://evil.example')), false);
  assert.equal(isSameOrigin(mk('https://evil.example', 'GET')), true);
  assert.equal(isSameOrigin(mk(undefined)), true);
});

// ---- TikTok: thử lại sau khi lần trước đã có publish_id ----
function ctxWith(pendingData: any, size = 1000) {
  const dir = mkdtempSync(path.join(tmpdir(), 'vp-'));
  const file = path.join(dir, 'v.mp4');
  writeFileSync(file, Buffer.alloc(size));
  const saved: any[] = [];
  return {
    saved,
    ctx: {
      post: { caption: 'c', channel: { username: 'u' }, media: { path: file, mime: 'video/mp4', duration: 5 } } as any,
      accessToken: 't',
      settings: { mode: 'direct', privacyLevel: 'SELF_ONLY' },
      pendingData,
      saveProgress: async (d: any) => void saved.push(d),
    },
  };
}

function mockTikTok(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    calls.push(u);
    for (const [k, fn] of Object.entries(routes)) if (u.includes(k)) return fn();
    throw new Error('unexpected ' + u);
  }) as any;
  return calls;
}

test('TikTok: khúc cuối mất phản hồi nhưng TikTok đã nhận đủ → KHÔNG init lại (không đăng trùng)', async () => {
  const calls = mockTikTok({
    '/status/fetch/': () => json({ data: { status: 'PROCESSING_UPLOAD', uploaded_bytes: 1000 }, error: { code: 'ok' } }),
  });
  const { ctx } = ctxWith({ publishId: 'p1', uploaded: false });
  const r = await tiktokProvider.publish(ctx);
  assert.equal(r.status, 'pending');
  assert.ok(!calls.some((c) => c.includes('/video/init/')), 'không được gọi init lại');
});

test('TikTok: bài cũ đã đăng xong → chỉ theo dõi', async () => {
  const calls = mockTikTok({ '/status/fetch/': () => json({ data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } }) });
  const r = await tiktokProvider.publish(ctxWith({ publishId: 'p1', uploaded: false }).ctx);
  assert.equal(r.status, 'pending');
  assert.ok(!calls.some((c) => c.includes('/init/')));
});

test('TikTok: bài cũ tải dở → huỷ bản cũ rồi mới init lại', async () => {
  const calls = mockTikTok({
    '/status/fetch/': () => json({ data: { status: 'PROCESSING_UPLOAD', uploaded_bytes: 10 }, error: { code: 'ok' } }),
    '/publish/cancel/': () => json({ data: {}, error: { code: 'ok' } }),
    '/creator_info/': () =>
      json({ data: { privacy_level_options: ['SELF_ONLY'], max_video_post_duration_sec: 600, comment_disabled: false, duet_disabled: false, stitch_disabled: false }, error: { code: 'ok' } }),
    '/video/init/': () => json({ data: { publish_id: 'p2', upload_url: 'https://upload.test/x' }, error: { code: 'ok' } }),
    'upload.test': () => new Response('', { status: 201 }),
  });
  const { ctx, saved } = ctxWith({ publishId: 'p1', uploaded: false });
  const r = await tiktokProvider.publish(ctx);
  const order = calls.map((c) => (c.includes('cancel') ? 'cancel' : c.includes('/video/init/') ? 'init' : '')).filter(Boolean);
  assert.deepEqual(order, ['cancel', 'init']);
  assert.equal(r.status, 'pending');
  assert.equal((r as any).pendingData.publishId, 'p2');
  assert.ok(saved.some((d) => d?.publishId === 'p2' && d.uploaded === true));
});

test('TikTok: không huỷ được vì đã xử lý → coi là đang đăng, không init lại', async () => {
  const calls = mockTikTok({
    '/status/fetch/': () => json({ data: { status: 'PROCESSING_UPLOAD' }, error: { code: 'ok' } }),
    '/publish/cancel/': () => json({ error: { code: 'publish_not_cancellable' } }, 400),
  });
  const r = await tiktokProvider.publish(ctxWith({ publishId: 'p1', uploaded: false }).ctx);
  assert.equal(r.status, 'pending');
  assert.ok(!calls.some((c) => c.includes('/init/')));
});

test('TikTok: lỗi khúc cuối KHÔNG xoá publish_id', async () => {
  mockTikTok({
    '/creator_info/': () =>
      json({ data: { privacy_level_options: ['SELF_ONLY'], max_video_post_duration_sec: 600, comment_disabled: false, duet_disabled: false, stitch_disabled: false }, error: { code: 'ok' } }),
    '/video/init/': () => json({ data: { publish_id: 'p9', upload_url: 'https://upload.test/x' }, error: { code: 'ok' } }),
    'upload.test': () => {
      throw new Error('ECONNRESET');
    },
  });
  const { ctx, saved } = ctxWith(null);
  await assert.rejects(tiktokProvider.publish(ctx), (e: any) => e.kind === 'retry');
  assert.ok(!saved.includes(null), 'không được saveProgress(null)');
  assert.equal(saved.at(-1).publishId, 'p9');
});

test('TikTok: FAILED vì internal → đăng lại từ đầu (restart)', async () => {
  mockTikTok({ '/status/fetch/': () => json({ data: { status: 'FAILED', fail_reason: 'internal' }, error: { code: 'ok' } }) });
  const { ctx } = ctxWith({ publishId: 'p1', uploaded: true });
  await assert.rejects(tiktokProvider.checkStatus!(ctx), (e: any) => e.kind === 'retry' && e.restart === true);
});
