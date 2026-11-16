import type { Channel, Media, Post } from '@prisma/client';

/**
 * Cách xử lý khi nền tảng báo lỗi:
 * - refresh:   token hết hạn → làm mới token rồi thử lại
 * - reconnect: token/quyền không còn dùng được → khách phải bấm "Kết nối lại"
 * - retry:     lỗi tạm thời (mạng, 5xx, rate limit) → thử lại sau
 * - fatal:     lỗi do nội dung/cài đặt → báo khách, không tự thử lại
 */
export type ProviderErrorKind = 'refresh' | 'reconnect' | 'retry' | 'fatal';

export class ProviderError extends Error {
  constructor(
    public kind: ProviderErrorKind,
    message: string, // tiếng Việt, hiện cho khách
    public raw?: string, // dữ liệu gốc để debug, không hiện cho khách
    /** Nền tảng báo lần đăng này đã hỏng hẳn (không thể đã lên) → được phép đăng lại từ đầu */
    public restart = false
  ) {
    super(message);
  }
}

export type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  refreshExpiresAt?: Date;
};

export type ConnectedAccount = TokenSet & {
  externalId: string;
  name: string;
  username?: string;
  avatar?: string;
};

export type PostWithRelations = Post & { channel: Channel; media: Media };

export type PublishContext = {
  post: PostWithRelations;
  accessToken: string;
  settings: any;
  pendingData: any | null;
  /** Lưu tiến độ ngay lập tức (vd publish_id) để lỡ app tắt giữa chừng không đăng trùng */
  saveProgress: (data: any) => Promise<void>;
};

export type PublishResult =
  | { status: 'published'; externalId: string; url: string; warning?: string }
  | { status: 'pending'; pendingData: any; checkInSec?: number };

export interface Provider {
  id: 'tiktok' | 'youtube' | 'demo';
  label: string;
  isConfigured(): boolean;
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<ConnectedAccount>;
  refresh(refreshToken: string): Promise<TokenSet>;
  publish(ctx: PublishContext): Promise<PublishResult>;
  /** Hỏi lại trạng thái khi nền tảng còn đang xử lý video */
  checkStatus?(ctx: PublishContext): Promise<PublishResult>;
  /**
   * App bị tắt giữa lúc tải lên. Trả 'resume' nếu provider tự tải tiếp an toàn được,
   * 'fail' nếu không chắc chắn (tránh đăng trùng).
   */
  onInterrupted(pendingData: any | null): 'resume' | 'fail';
}
