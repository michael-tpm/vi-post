import { config } from '../config';
import { ProviderError, type Provider } from './types';

/**
 * Kênh giả lập để thử toàn bộ luồng (soạn → hẹn giờ → đăng → theo dõi) khi chưa có khoá TikTok/YouTube.
 * Chỉ hiện khi DEMO_MODE=1. Viết "#loi" trong nội dung để giả lập bài lỗi.
 */
export const demoProvider: Provider = {
  id: 'demo',
  label: 'Demo',

  isConfigured() {
    return config.demoMode;
  },

  authUrl(state) {
    return `${config.appUrl}/api/auth/demo/callback?code=demo&state=${state}`;
  },

  async exchangeCode() {
    return {
      accessToken: 'demo-token',
      refreshToken: 'demo-refresh',
      expiresAt: new Date(Date.now() + 3600_000),
      externalId: 'demo-channel',
      name: 'Kênh Demo',
      username: 'kenhdemo',
    };
  },

  async refresh() {
    return { accessToken: 'demo-token', expiresAt: new Date(Date.now() + 3600_000) };
  },

  async publish(ctx) {
    if (ctx.post.caption.includes('#loi')) {
      throw new ProviderError('fatal', 'Lỗi giả lập (nội dung có #loi).');
    }
    await ctx.saveProgress({ demoId: ctx.post.id, checks: 0 });
    return { status: 'pending', pendingData: { demoId: ctx.post.id, checks: 0 }, checkInSec: 3 };
  },

  async checkStatus(ctx) {
    const checks = (ctx.pendingData?.checks || 0) + 1;
    if (checks < 2) return { status: 'pending', pendingData: { ...ctx.pendingData, checks } };
    return { status: 'published', externalId: ctx.post.id, url: `${config.appUrl}/?demo=${ctx.post.id}` };
  },

  onInterrupted() {
    return 'resume';
  },
};
