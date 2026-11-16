import path from 'node:path';

export const config = {
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  appPassword: process.env.APP_PASSWORD || '',
  uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads'),
  demoMode: process.env.DEMO_MODE === '1',
  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY || '',
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
    get redirectUri() {
      return (
        process.env.TIKTOK_REDIRECT_URI ||
        `${config.appUrl}/api/auth/tiktok/callback`
      );
    },
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    get redirectUri() {
      return `${config.appUrl}/api/auth/youtube/callback`;
    },
  },
};

export const TIME_ZONE = 'Asia/Ho_Chi_Minh';
