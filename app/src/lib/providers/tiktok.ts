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
 * TikTok Content Posting API — chỉ VIDEO, gửi file trực tiếp (FILE_UPLOAD),
 * nên chạy được trên localhost (không cần TikTok tự tải file từ URL).
 * Tài liệu: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
 */

const API = 'https://open.tiktokapis.com/v2';
const SCOPES = ['user.info.basic', 'video.publish', 'video.upload'];

// TikTok tính "MB" theo ví dụ trong tài liệu là 10^6 byte (chunk_size 10,000,000) → dùng hệ thập phân cho an toàn
const MB = 1_000_000;
const MAX_SINGLE_CHUNK = 64 * MB;
const CHUNK = 10 * MB;

export type TikTokPrivacy =
  | 'PUBLIC_TO_EVERYONE'
  | 'MUTUAL_FOLLOW_FRIENDS'
  | 'FOLLOWER_OF_CREATOR'
  | 'SELF_ONLY';

export type TikTokSettings = {
  mode: 'direct' | 'inbox'; // direct: đăng thẳng; inbox: đẩy vào hộp nháp TikTok, khách tự bấm đăng
  privacyLevel?: TikTokPrivacy;
  allowComment?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
  commercial?: boolean; // có tiết lộ nội dung thương mại
  yourBrand?: boolean; // quảng bá thương hiệu của chính mình
  brandedContent?: boolean; // hợp tác/được tài trợ bởi bên thứ ba
  isAigc?: boolean; // nội dung tạo bằng AI
  coverMs?: number; // khung hình làm ảnh bìa (mili giây)
};

export type CreatorInfo = {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: TikTokPrivacy[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
};

/**
 * TikTok chia file: mỗi khúc 5–64MB, khúc cuối được lớn hơn (tối đa 128MB).
 * File ≤ 64MB gửi 1 lần. total_chunk_count = floor(size / chunk_size).
 */
export function tiktokChunkPlan(size: number): { chunkSize: number; totalChunkCount: number } {
  if (size <= 0) throw new ProviderError('fatal', 'File video rỗng.');
  if (size <= MAX_SINGLE_CHUNK) return { chunkSize: size, totalChunkCount: 1 };
  return { chunkSize: CHUNK, totalChunkCount: Math.floor(size / CHUNK) };
}

/** Khoảng byte của khúc thứ i (khúc cuối gánh phần dư) */
export function tiktokChunkRange(
  i: number,
  plan: { chunkSize: number; totalChunkCount: number },
  size: number
): { start: number; end: number } {
  const start = i * plan.chunkSize;
  const end = i === plan.totalChunkCount - 1 ? size - 1 : start + plan.chunkSize - 1;
  return { start, end };
}

const ERROR_MESSAGES: Record<string, { kind: ProviderError['kind']; msg: string }> = {
  access_token_invalid: { kind: 'refresh', msg: 'Phiên đăng nhập TikTok đã hết hạn.' },
  scope_not_authorized: {
    kind: 'reconnect',
    msg: 'Thiếu quyền đăng bài TikTok. Hãy bấm "Kết nối lại" và tick đủ các quyền.',
  },
  scope_permission_missed: {
    kind: 'reconnect',
    msg: 'Thiếu quyền đăng bài TikTok. Hãy bấm "Kết nối lại" và tick đủ các quyền.',
  },
  rate_limit_exceeded: { kind: 'retry', msg: 'TikTok đang giới hạn tần suất gọi. Sẽ tự thử lại.' },
  internal_error: { kind: 'retry', msg: 'TikTok đang gặp lỗi nội bộ. Sẽ tự thử lại.' },
  spam_risk_too_many_posts: {
    kind: 'fatal',
    msg: 'Tài khoản TikTok đã đăng quá nhiều bài trong 24 giờ. Hãy dời lịch sang ngày mai.',
  },
  spam_risk_user_banned_from_posting: {
    kind: 'fatal',
    msg: 'Tài khoản TikTok đang bị TikTok chặn đăng bài. Kiểm tra thông báo trong app TikTok.',
  },
  spam_risk_too_many_pending_share: {
    kind: 'fatal',
    msg: 'Đã có 5 video chờ trong hộp nháp TikTok (giới hạn 24 giờ). Mở app TikTok đăng/xoá bớt rồi thử lại.',
  },
  reached_active_user_cap: {
    kind: 'fatal',
    msg: 'App TikTok của bạn đã chạm giới hạn số người dùng/ngày (app chưa qua kiểm duyệt).',
  },
  unaudited_client_can_only_post_to_private_accounts: {
    kind: 'fatal',
    msg:
      'App TikTok chưa qua kiểm duyệt nên chỉ đăng được khi tài khoản TikTok để chế độ riêng tư và chọn "Chỉ mình tôi". ' +
      'Cách khác: chọn chế độ "Đẩy vào hộp nháp" rồi tự bấm đăng trong app TikTok.',
  },
  privacy_level_option_mismatch: {
    kind: 'fatal',
    msg: 'Quyền riêng tư đã chọn không còn hợp lệ với tài khoản này. Hãy sửa bài và chọn lại.',
  },
  url_ownership_unverified: { kind: 'fatal', msg: 'TikTok yêu cầu tên miền đã xác minh.' },
  invalid_params: { kind: 'fatal', msg: 'Thông tin bài đăng không hợp lệ theo TikTok.' },
  duration_check_failed: { kind: 'fatal', msg: 'Video dài quá giới hạn cho phép của tài khoản TikTok này.' },
  file_format_check_failed: { kind: 'fatal', msg: 'TikTok không nhận định dạng video này (dùng MP4/MOV/WebM).' },
  frame_rate_check_failed: { kind: 'fatal', msg: 'Tốc độ khung hình video không hợp lệ (cần 23–60 fps).' },
  picture_size_check_failed: { kind: 'fatal', msg: 'Kích thước khung hình video không hợp lệ (tối thiểu 360px).' },
  publish_cancelled: { kind: 'fatal', msg: 'Bài đăng đã bị huỷ trên TikTok.' },
  auth_removed: { kind: 'reconnect', msg: 'Bạn đã gỡ quyền của app trong TikTok. Hãy kết nối lại.' },
  spam_risk_text: { kind: 'fatal', msg: 'TikTok cho rằng nội dung chữ có dấu hiệu spam. Hãy sửa nội dung.' },
  spam_risk: { kind: 'fatal', msg: 'TikTok từ chối bài vì nghi ngờ spam.' },
  invalid_publish_id: { kind: 'fatal', msg: 'TikTok không nhận ra mã bài đăng.' },
  publish_not_cancellable: { kind: 'fatal', msg: 'Bài đã được TikTok xử lý, không huỷ được.' },
};

function toError(code: string, raw: string, fallback?: string): ProviderError {
  const m = ERROR_MESSAGES[code];
  if (m) return new ProviderError(m.kind, m.msg, raw);
  return new ProviderError('fatal', fallback || `TikTok báo lỗi: ${code}`, raw);
}

/** Gọi API TikTok dạng { data, error: { code, message } } */
async function tiktokApi<T = any>(
  path: string,
  accessToken: string,
  body?: unknown
): Promise<{ data: T; raw: string }> {
  const res = await httpFetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  if (res.status >= 500) throw new ProviderError('retry', 'TikTok đang gặp sự cố. Sẽ tự thử lại.', raw);
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ProviderError('retry', 'TikTok trả về dữ liệu lạ. Sẽ tự thử lại.', raw);
  }
  const code = json?.error?.code;
  if (code && code !== 'ok') throw toError(code, raw, json?.error?.message);
  if (res.status === 401) throw new ProviderError('refresh', 'Phiên đăng nhập TikTok đã hết hạn.', raw);
  return { data: json.data as T, raw };
}

async function tokenRequest(params: Record<string, string>): Promise<any> {
  const res = await httpFetch(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: config.tiktok.clientKey,
      client_secret: config.tiktok.clientSecret,
      ...params,
    }).toString(),
  });
  return readTokenResponse(res, 'TikTok');
}

function toTokenSet(json: any): TokenSet {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: addSeconds(json.expires_in),
    refreshExpiresAt: addSeconds(json.refresh_expires_in),
  };
}

type PublishStatus = { status: string; fail_reason?: string; uploaded_bytes?: number };

async function fetchPublishStatus(accessToken: string, publishId: string) {
  return tiktokApi<PublishStatus>('/post/publish/status/fetch/', accessToken, { publish_id: publishId });
}

/**
 * Lần đăng trước đã có publish_id nhưng chưa chắc TikTok nhận đủ file (app tắt, mất mạng ở khúc cuối…).
 * Trả về true nếu bản cũ VẪN ĐANG/ĐÃ được đăng (chỉ cần theo dõi), false nếu chắc chắn bản cũ không lên → được init lại.
 * Không bao giờ init mù: đó là đường dẫn tới đăng trùng.
 */
async function previousAttemptIsLive(accessToken: string, publishId: string, size: number): Promise<boolean> {
  let st: PublishStatus;
  try {
    st = (await fetchPublishStatus(accessToken, publishId)).data;
  } catch (e) {
    if (e instanceof ProviderError && e.raw?.includes('invalid_publish_id')) return false;
    throw e; // refresh / retry: chưa kết luận được → để lần sau hỏi lại
  }
  if (st.status === 'FAILED') return false;
  if (st.status !== 'PROCESSING_UPLOAD') return true; // đang xử lý / đã đăng / đã vào hộp nháp
  if (Number(st.uploaded_bytes || 0) >= size) return true;

  // Còn đang chờ file: huỷ bản cũ cho chắc rồi mới init lại
  try {
    await tiktokApi('/post/publish/cancel/', accessToken, { publish_id: publishId });
    return false;
  } catch (e) {
    if (e instanceof ProviderError && e.raw?.includes('publish_not_cancellable')) return true;
    if (e instanceof ProviderError && e.raw?.includes('invalid_publish_id')) return false;
    throw new ProviderError('retry', 'Chưa xác định được lần tải trước lên TikTok. Sẽ kiểm tra lại sau.', e instanceof ProviderError ? e.raw : String(e));
  }
}

export async function getCreatorInfo(accessToken: string): Promise<CreatorInfo> {
  const { data } = await tiktokApi<CreatorInfo>('/post/publish/creator_info/query/', accessToken);
  return data;
}

function videoMime(mime: string): string {
  if (['video/mp4', 'video/quicktime', 'video/webm'].includes(mime)) return mime;
  throw new ProviderError('fatal', 'TikTok chỉ nhận video MP4, MOV hoặc WebM.');
}

/** Kiểm tra cài đặt theo đúng hướng dẫn UX của TikTok (điều kiện để qua kiểm duyệt) */
export function validateTikTokSettings(
  s: TikTokSettings,
  info: Pick<CreatorInfo, 'privacy_level_options' | 'max_video_post_duration_sec'> | null,
  durationSec?: number | null
): string | null {
  if (s.mode === 'inbox') return null;
  if (!s.privacyLevel) return 'Hãy chọn ai được xem video (TikTok yêu cầu tự chọn, không chọn sẵn).';
  if (info && !info.privacy_level_options.includes(s.privacyLevel))
    return 'Quyền riêng tư đã chọn không có trong các lựa chọn TikTok cho phép với tài khoản này.';
  if (s.commercial && !s.yourBrand && !s.brandedContent)
    return 'Đã bật "Tiết lộ nội dung thương mại" thì phải chọn ít nhất 1 loại: Thương hiệu của bạn / Nội dung có thương hiệu.';
  if (s.commercial && s.brandedContent && s.privacyLevel === 'SELF_ONLY')
    return 'Nội dung có thương hiệu (branded content) không được để chế độ "Chỉ mình tôi".';
  if (info && durationSec && durationSec > info.max_video_post_duration_sec)
    return `Video dài ${Math.round(durationSec)} giây, vượt giới hạn ${info.max_video_post_duration_sec} giây của tài khoản này.`;
  return null;
}

/** TikTok trả publicaly_available_post_id dạng int64 — JSON.parse làm tròn sai, nên lấy số từ chuỗi gốc */
export function extractPublicPostId(raw: string): string | undefined {
  const m = raw.match(/"publicaly_available_post_id"\s*:\s*\[\s*"?(\d+)/);
  return m?.[1];
}

export const tiktokProvider: Provider = {
  id: 'tiktok',
  label: 'TikTok',

  isConfigured() {
    return Boolean(config.tiktok.clientKey && config.tiktok.clientSecret);
  },

  authUrl(state) {
    const q = new URLSearchParams({
      client_key: config.tiktok.clientKey,
      scope: SCOPES.join(','),
      response_type: 'code',
      redirect_uri: config.tiktok.redirectUri,
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${q.toString()}`;
  },

  async exchangeCode(code): Promise<ConnectedAccount> {
    const json = await tokenRequest({
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.tiktok.redirectUri,
    });
    const granted = String(json.scope || '').split(',');
    const missing = SCOPES.filter((s) => !granted.includes(s));
    if (missing.length) {
      throw new ProviderError(
        'reconnect',
        `Bạn chưa cấp đủ quyền cho app (thiếu: ${missing.join(', ')}). Hãy kết nối lại và tick đủ các quyền.`
      );
    }
    const tokens = toTokenSet(json);

    const res = await httpFetch(
      `${API}/user/info/?fields=open_id,avatar_url,display_name`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    const user: any = (await res.json().catch(() => ({})))?.data?.user || {};

    let username: string | undefined;
    try {
      username = (await getCreatorInfo(tokens.accessToken)).creator_username;
    } catch {
      // không bắt buộc
    }

    return {
      ...tokens,
      externalId: user.open_id || json.open_id,
      name: user.display_name || username || 'TikTok',
      username,
      avatar: user.avatar_url,
    };
  },

  async refresh(refreshToken) {
    return toTokenSet(await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }));
  },

  async publish(ctx): Promise<PublishResult> {
    const s = ctx.settings as TikTokSettings;
    const { media } = ctx.post;

    // Đã tải xong ở lần trước → chỉ cần theo dõi trạng thái, KHÔNG init lại (tránh đăng trùng)
    if (ctx.pendingData?.uploaded) {
      return { status: 'pending', pendingData: ctx.pendingData, checkInSec: 5 };
    }

    const size = (await stat(media.path).catch(() => null))?.size;
    if (!size) throw new ProviderError('fatal', 'Không tìm thấy file video trên máy (có thể đã bị xoá).');

    if (ctx.pendingData?.publishId) {
      if (await previousAttemptIsLive(ctx.accessToken, ctx.pendingData.publishId, size)) {
        const done = { ...ctx.pendingData, uploaded: true };
        await ctx.saveProgress(done);
        return { status: 'pending', pendingData: done, checkInSec: 5 };
      }
      await ctx.saveProgress(null);
    }

    const mime = videoMime(media.mime);
    const plan = tiktokChunkPlan(size);
    const source_info = {
      source: 'FILE_UPLOAD',
      video_size: size,
      chunk_size: plan.chunkSize,
      total_chunk_count: plan.totalChunkCount,
    };

    let init: { publish_id: string; upload_url: string };
    if (s.mode === 'inbox') {
      init = (await tiktokApi('/post/publish/inbox/video/init/', ctx.accessToken, { source_info })).data;
    } else {
      // TikTok yêu cầu gọi creator_info ngay trước khi đăng để kiểm tra lại quyền
      const info = await getCreatorInfo(ctx.accessToken);
      const invalid = validateTikTokSettings(s, info, media.duration);
      if (invalid) throw new ProviderError('fatal', invalid);

      init = (
        await tiktokApi('/post/publish/video/init/', ctx.accessToken, {
          post_info: {
            title: ctx.post.caption,
            privacy_level: s.privacyLevel,
            disable_comment: info.comment_disabled || !s.allowComment,
            disable_duet: info.duet_disabled || !s.allowDuet,
            disable_stitch: info.stitch_disabled || !s.allowStitch,
            brand_content_toggle: Boolean(s.commercial && s.brandedContent),
            brand_organic_toggle: Boolean(s.commercial && s.yourBrand),
            is_aigc: Boolean(s.isAigc),
            ...(s.coverMs != null ? { video_cover_timestamp_ms: s.coverMs } : {}),
          },
          source_info,
        })
      ).data;
    }

    const progress = { publishId: init.publish_id, mode: s.mode, uploaded: false };
    await ctx.saveProgress(progress);

    for (let i = 0; i < plan.totalChunkCount; i++) {
      const { start, end } = tiktokChunkRange(i, plan, size);
      const chunk = await readChunk(media.path, start, end);
      let lastErr = '';
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const res = await fetch(init.upload_url, {
            method: 'PUT',
            headers: {
              'Content-Type': mime,
              'Content-Length': String(chunk.length),
              'Content-Range': `bytes ${start}-${end}/${size}`,
            },
            body: new Uint8Array(chunk),
            signal: AbortSignal.timeout(10 * 60_000),
          });
          if (res.status === 201 || res.status === 206 || res.ok) ok = true;
          else lastErr = `HTTP ${res.status}: ${await res.text().catch(() => '')}`;
        } catch (e: any) {
          lastErr = String(e?.message || e);
        }
      }
      if (!ok) {
        // KHÔNG xoá publish_id: có thể TikTok đã nhận khúc cuối dù mình không nhận được phản hồi.
        // Lần sau previousAttemptIsLive() sẽ hỏi TikTok trước khi quyết định tải lại.
        throw new ProviderError('retry', 'Tải video lên TikTok bị lỗi giữa chừng. Sẽ tự thử lại.', lastErr);
      }
    }

    const done = { ...progress, uploaded: true };
    await ctx.saveProgress(done);
    return { status: 'pending', pendingData: done, checkInSec: 10 };
  },

  async checkStatus(ctx): Promise<PublishResult> {
    const pd = ctx.pendingData;
    const { data, raw } = await fetchPublishStatus(ctx.accessToken, pd.publishId);
    const username = ctx.post.channel.username;
    const profileUrl = username ? `https://www.tiktok.com/@${username}` : 'https://www.tiktok.com/';

    switch (data.status) {
      case 'SEND_TO_USER_INBOX':
        return {
          status: 'published',
          externalId: pd.publishId,
          url: profileUrl,
          warning: 'Video đã vào hộp nháp TikTok. Mở app TikTok (mục Hộp thư) để bấm đăng trong vòng 24 giờ.',
        };
      case 'PUBLISH_COMPLETE': {
        const postId = extractPublicPostId(raw);
        return postId
          ? { status: 'published', externalId: postId, url: `${profileUrl}/video/${postId}` }
          : {
              status: 'published',
              externalId: pd.publishId,
              url: profileUrl,
              warning: 'TikTok đã nhận bài, đang kiểm duyệt nội dung nên chưa có link video.',
            };
      }
      case 'FAILED':
        if (data.fail_reason === 'internal') {
          // Tài liệu TikTok: 'internal' là lỗi có thể thử lại; bài chưa lên nên đăng lại từ đầu không bị trùng
          throw new ProviderError('retry', 'TikTok gặp lỗi nội bộ khi xử lý video. Sẽ tự đăng lại.', raw, true);
        }
        {
          const e = toError(data.fail_reason || 'unknown', raw, `TikTok không đăng được video (${data.fail_reason || 'không rõ lý do'}).`);
          e.restart = true; // bản này chắc chắn không lên → "Thử lại" được phép tải lại từ đầu
          throw e;
        }
      default: // PROCESSING_UPLOAD, PROCESSING_DOWNLOAD
        return { status: 'pending', pendingData: pd };
    }
  },

  onInterrupted() {
    // An toàn để chạy lại: publish() luôn hỏi TikTok về publish_id cũ trước khi tải lại (xem previousAttemptIsLive)
    return 'resume';
  },
};
