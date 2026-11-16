// Dùng được cả ở middleware (edge) lẫn route handler (node) — không import module node

/** So sánh chuỗi không lộ thời gian (tránh đoán mật khẩu theo tốc độ phản hồi) */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function isAuthorized(authHeader: string | null): boolean {
  const password = (process.env.APP_PASSWORD || '').normalize('NFC');
  if (!password) return true; // chưa đặt mật khẩu → mở (chỉ nên dùng khi không mở tunnel)
  if (!authHeader?.startsWith('Basic ')) return false;
  try {
    // Trình duyệt gửi user:pass dạng UTF-8 (realm có charset="UTF-8") → giải mã đúng để mật khẩu có dấu tiếng Việt vẫn khớp
    const bytes = Uint8Array.from(atob(authHeader.slice(6)), (c) => c.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const pass = decoded.slice(decoded.indexOf(':') + 1).normalize('NFC');
    return safeEqual(pass, password);
  } catch {
    return false;
  }
}

export const UNAUTHORIZED_HEADERS = { 'WWW-Authenticate': 'Basic realm="ViPost", charset="UTF-8"' };

/** Chặn trang web khác gửi lệnh thay bạn (CSRF): yêu cầu thay đổi dữ liệu phải đến từ chính ViPost */
export function isSameOrigin(req: Request): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  const origin = req.headers.get('origin');
  if (!origin) return true; // curl/công cụ dòng lệnh không gửi Origin
  try {
    return new URL(origin).host === new URL(req.url).host || new URL(origin).host === req.headers.get('host');
  } catch {
    return false;
  }
}
