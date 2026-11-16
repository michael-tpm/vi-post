import { TIME_ZONE } from './config';

const dateTimeFmt = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function formatDateTime(d: Date | string): string {
  return dateTimeFmt.format(new Date(d));
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(sec?: number | null): string {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const STATE_LABEL: Record<string, { text: string; className: string }> = {
  QUEUE: { text: 'Chờ đăng', className: 'bg-slate-100 text-slate-700' },
  PUBLISHING: { text: 'Đang tải lên', className: 'bg-blue-100 text-blue-700' },
  PENDING: { text: 'Nền tảng đang xử lý', className: 'bg-amber-100 text-amber-800' },
  PUBLISHED: { text: 'Đã đăng', className: 'bg-emerald-100 text-emerald-700' },
  ERROR: { text: 'Lỗi', className: 'bg-red-100 text-red-700' },
  CANCELLED: { text: 'Đã huỷ', className: 'bg-slate-100 text-slate-400 line-through' },
};

export const PROVIDER_LABEL: Record<string, string> = {
  tiktok: 'TikTok',
  youtube: 'YouTube',
  demo: 'Demo',
};
