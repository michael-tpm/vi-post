import { stat } from 'node:fs/promises';
import { config } from '../config';
import { addSeconds, httpFetch, readChunk, readTokenResponse } from './http';
import {
  ProviderError,
  type ConnectedAccount,
  type Provider,
  type PublishContext,
  type PublishResult,
  type TokenSet,
} from './types';

/**
 * YouTube Data API v3 — tải video bằng resumable upload: máy mình đọc file và đẩy lên,
 * nên chạy được trên localhost. Mất mạng giữa chừng thì hỏi YouTube đã nhận tới byte nào rồi tải tiếp.
 * Tài liệu: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 */

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];
const CHUNK = 32 * 256 * 1024; // 8MB, phải là bội số của 256KB

export type YouTubeSettings = {
  privacy: 'public' | 'unlisted' | 'private';
  madeForKids: boolean;
  tags?: string[];
  categoryId?: string;
  notifySubscribers?: boolean;
};

export function validateYouTube(title: string | null | undefined, description: string, s: YouTubeSettings): string | null {
  if (!title?.trim()) return 'YouTube cần tiêu đề.';
  if (title.length > 100) return 'Tiêu đề YouTube tối đa 100 ký tự.';
  if (/[<>]/.test(title) || /[<>]/.test(description)) return 'YouTube không cho dùng ký tự < hoặc > trong tiêu đề/mô tả.';
  if (Buffer.byteLength(description, 'utf8') > 5000) return 'Mô tả YouTube tối đa 5000 byte (khoảng 2500–5000 ký tự tiếng Việt).';
  if (!['public', 'unlisted', 'private'].includes(s.privacy)) return 'Chọn chế độ hiển thị cho YouTube.';
  if (typeof s.madeForKids !== 'boolean') return 'YouTube bắt buộc khai báo video có dành cho trẻ em hay không.';
  const tagLen = (s.tags || []).reduce((n, t) => n + t.length + (t.includes(' ') ? 2 : 0), 0) + Math.max(0, (s.tags || []).length - 1);
  if (tagLen > 500) return 'Tổng độ dài thẻ (tags) YouTube tối đa 500 ký tự.';
  return null;
}

const REASON_MESSAGES: Record<string, { kind: ProviderError['kind']; msg: string }> = {
  quotaExceeded: {
    kind: 'fatal',
    msg: 'Đã hết hạn mức (quota) YouTube API hôm nay — mặc định mỗi project được 100 lần tải video/ngày. Hãy dời lịch sang sau 15h (giờ VN), lúc quota được reset.',
  },
  uploadLimitExceeded: { kind: 'fatal', msg: 'Kênh YouTube đã chạm giới hạn số video tải lên trong ngày. Hãy dời lịch.' },
  youtubeSignupRequired: { kind: 'reconnect', msg: 'Tài khoản Google này chưa tạo kênh YouTube.' },
  invalidTitle: { kind: 'fatal', msg: 'Tiêu đề YouTube không hợp lệ.' },
  invalidDescription: { kind: 'fatal', msg: 'Mô tả YouTube không hợp lệ.' },
  invalidTags: { kind: 'fatal', msg: 'Thẻ (tags) YouTube không hợp lệ.' },
  invalidCategoryId: { kind: 'fatal', msg: 'Danh mục YouTube không hợp lệ.' },
  forbidden: { kind: 'fatal', msg: 'YouTube từ chối yêu cầu tải lên (403). Kiểm tra kênh trong YouTube Studio có bị hạn chế không.' },
  forbiddenPrivacySetting: { kind: 'fatal', msg: 'Chế độ hiển thị đã chọn không hợp lệ với kênh này.' },
  mediaBodyRequired: { kind: 'retry', msg: 'YouTube chưa nhận được nội dung video. Sẽ tự thử lại.' },
  insufficientPermissions: { kind: 'reconnect', msg: 'Thiếu quyền tải video lên YouTube. Hãy kết nối lại và tick đủ quyền.' },
  authError: { kind: 'refresh', msg: 'Phiên đăng nhập YouTube đã hết hạn.' },
  rateLimitExceeded: { kind: 'retry', msg: 'YouTube đang giới hạn tần suất. Sẽ tự thử lại.' },
  userRateLimitExceeded: { kind: 'retry', msg: 'YouTube đang giới hạn tần suất. Sẽ tự thử lại.' },
};

function errorFrom(status: number, raw: string): ProviderError {
  if (status === 401) return new ProviderError('refresh', 'Phiên đăng nhập YouTube đã hết hạn.', raw);
  if (status >= 500 || status === 429) return new ProviderError('retry', 'YouTube đang gặp sự cố. Sẽ tự thử lại.', raw);
  let reason = '';
  let message = '';
  try {
    const j = JSON.parse(raw);
    reason = j?.error?.errors?.[0]?.reason || '';
    message = j?.error?.message || '';
  } catch {}
  const m = REASON_MESSAGES[reason];
  if (m) return new ProviderError(m.kind, m.msg, raw);
  return new ProviderError('fatal', `YouTube báo lỗi: ${message || reason || `HTTP ${status}`}`, raw);
}

async function tokenRequest(params: Record<string, string>): Promise<any> {
  const res = await httpFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      ...params,
    }).toString(),
  });
  return readTokenResponse(res, 'Google', (json) =>
    json?.error === 'invalid_grant'
      ? ' (Nếu app Google Cloud đang ở chế độ "Testing", quyền chỉ sống 7 ngày — chuyển sang "In production".)'
      : ''
  );
}

function toTokenSet(json: any): TokenSet {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token, // Google thường không trả lại khi refresh → giữ token cũ
    expiresAt: addSeconds(json.expires_in),
  };
}

type Session = { uploadUri: string; size: number };

/** Hỏi YouTube đã nhận tới đâu. Trả về offset kế tiếp, video nếu đã xong, hoặc null nếu phiên đã hết hạn */
async function probe(session: Session, token: string): Promise<{ next: number } | { video: any } | null> {
  const res = await httpFetch(session.uploadUri, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0', 'Content-Range': `bytes */${session.size}` },
  });
  if (res.status === 200 || res.status === 201) return { video: await res.json() };
  if (res.status === 308) return { next: nextOffset(res.headers.get('range')) };
  if (res.status === 404 || res.status === 410) return null;
  throw errorFrom(res.status, await res.text());
}

/** Google yêu cầu chờ tăng dần (exponential backoff) trước khi tải tiếp sau lỗi 5xx / mất kết nối */
const backoff = (n: number) => new Promise((r) => setTimeout(r, Math.min(2 ** n, 32) * 1000 + Math.random() * 1000));

export function nextOffset(range: string | null): number {
  const m = range?.match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
}

function videoUrl(id: string, width?: number | null, height?: number | null, duration?: number | null) {
  const isShort = width && height && height > width && duration != null && duration <= 180;
  return isShort ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
}

export const youtubeProvider: Provider = {
  id: 'youtube',
  label: 'YouTube',

  isConfigured() {
    return Boolean(config.google.clientId && config.google.clientSecret);
  },

  authUrl(state) {
    const q = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: config.google.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent', // bắt Google trả refresh_token
      include_granted_scopes: 'true',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
  },

  async exchangeCode(code): Promise<ConnectedAccount> {
    const json = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: config.google.redirectUri });
    const granted = String(json.scope || '').split(' ');
    if (!granted.includes(SCOPES[0])) {
      throw new ProviderError('reconnect', 'Bạn chưa cấp quyền tải video lên YouTube. Hãy kết nối lại và tick ô quyền đó.');
    }
    const tokens = toTokenSet(json);
    const res = await httpFetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!res.ok) throw errorFrom(res.status, await res.text());
    const ch = (await res.json())?.items?.[0];
    if (!ch) throw new ProviderError('reconnect', 'Tài khoản Google này chưa có kênh YouTube. Hãy tạo kênh trước.');
    return {
      ...tokens,
      externalId: ch.id,
      name: ch.snippet?.title || 'YouTube',
      username: ch.snippet?.customUrl,
      avatar: ch.snippet?.thumbnails?.default?.url,
    };
  },

  async refresh(refreshToken) {
    return toTokenSet(await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }));
  },

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const s = ctx.settings as YouTubeSettings;
    const { media } = ctx.post;
    const size = (await stat(media.path).catch(() => null))?.size;
    if (!size) throw new ProviderError('fatal', 'Không tìm thấy file video trên máy (có thể đã bị xoá).');

    let session: Session | null = ctx.pendingData?.uploadUri ? (ctx.pendingData as Session) : null;
    let offset = 0;
    let video: any = null;

    // Lần trước tải dở → hỏi YouTube để tải tiếp
    if (session) {
      const p = await probe(session, ctx.accessToken);
      if (p === null) session = null; // phiên hết hạn, chưa có video nào được tạo → tạo phiên mới
      else if ('video' in p) video = p.video;
      else offset = p.next;
    }

    if (!video && !session) {
      const res = await httpFetch(
        `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${s.notifySubscribers !== false}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${ctx.accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Length': String(size),
            'X-Upload-Content-Type': media.mime,
          },
          body: JSON.stringify({
            snippet: {
              title: ctx.post.title,
              description: ctx.post.caption,
              tags: s.tags?.length ? s.tags : undefined,
              categoryId: s.categoryId || '22',
              defaultLanguage: 'vi',
              defaultAudioLanguage: 'vi',
            },
            status: { privacyStatus: s.privacy, selfDeclaredMadeForKids: s.madeForKids },
          }),
        }
      );
      const location = res.headers.get('location');
      if (!res.ok || !location) throw errorFrom(res.status, await res.text());
      session = { uploadUri: location, size };
      offset = 0;
      await ctx.saveProgress(session);
    }

    let failures = 0;
    while (!video && session) {
      const end = Math.min(offset + CHUNK, size) - 1;
      const chunk = await readChunk(media.path, offset, end);
      let res: Response;
      try {
        res = await fetch(session.uploadUri, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${ctx.accessToken}`,
            'Content-Type': media.mime,
            'Content-Length': String(chunk.length),
            'Content-Range': `bytes ${offset}-${end}/${size}`,
          },
          body: new Uint8Array(chunk),
          signal: AbortSignal.timeout(10 * 60_000),
        });
      } catch (e: any) {
        if (++failures > 5) throw new ProviderError('retry', 'Mạng chập chờn khi tải lên YouTube. Sẽ tự tải tiếp sau.', String(e?.message || e));
        await backoff(failures);
        const p = await probe(session, ctx.accessToken);
        if (p === null) throw new ProviderError('retry', 'Phiên tải lên YouTube hết hạn. Sẽ tự thử lại.');
        if ('video' in p) video = p.video;
        else offset = p.next;
        continue;
      }

      if (res.status === 200 || res.status === 201) video = await res.json();
      else if (res.status === 308) offset = nextOffset(res.headers.get('range'));
      else if (res.status >= 500) {
        if (++failures > 5) throw errorFrom(res.status, await res.text());
        await backoff(failures);
        const p = await probe(session, ctx.accessToken);
        if (p === null) throw new ProviderError('retry', 'Phiên tải lên YouTube hết hạn. Sẽ tự thử lại.');
        if ('video' in p) video = p.video;
        else offset = p.next;
      } else throw errorFrom(res.status, await res.text()); // 401 → refresh rồi lần sau tải tiếp nhờ uploadUri đã lưu
    }

    const id = video?.id;
    if (!id) throw new ProviderError('fatal', 'YouTube không trả về mã video.', JSON.stringify(video));

    const gotPrivacy = video?.status?.privacyStatus;
    const warning =
      s.privacy !== 'private' && gotPrivacy === 'private'
        ? 'YouTube đã để video ở chế độ riêng tư (có thể do cài đặt mặc định của kênh). Mở YouTube Studio để đổi sang công khai nếu cần.'
        : undefined;

    return { status: 'published', externalId: id, url: videoUrl(id, media.width, media.height, media.duration), warning };
  },

  onInterrupted() {
    return 'resume'; // resumable upload: hỏi YouTube rồi tải tiếp, không tạo video trùng
  },
};
