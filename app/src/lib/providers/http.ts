import { ProviderError } from './types';

/** fetch có timeout; lỗi mạng → ProviderError('retry') */
export async function httpFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 60_000, ...rest } = init;
  try {
    return await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err: any) {
    throw new ProviderError(
      'retry',
      'Không kết nối được tới nền tảng (mạng chập chờn). Hệ thống sẽ tự thử lại.',
      String(err?.message || err)
    );
  }
}

export function addSeconds(sec?: number): Date | undefined {
  if (!sec || !Number.isFinite(sec)) return undefined;
  return new Date(Date.now() + sec * 1000);
}

/** Đọc một đoạn byte [start, end] (end tính cả) của file thành Buffer */
export async function readChunk(
  filePath: string,
  start: number,
  end: number
): Promise<Buffer> {
  const { open } = await import('node:fs/promises');
  const fh = await open(filePath, 'r');
  try {
    const length = end - start + 1;
    const buf = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await fh.read(buf, offset, length - offset, start + offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buf.subarray(0, offset);
  } finally {
    await fh.close();
  }
}

/**
 * Đọc phản hồi endpoint cấp token (TikTok/Google).
 * Lỗi máy chủ / quá tải / trả HTML → 'retry' (đừng bắt khách kết nối lại vì sự cố tạm thời).
 * Chỉ khi nền tảng trả lỗi OAuth rõ ràng (invalid_grant…) mới là 'reconnect'.
 */
export async function readTokenResponse(res: Response, label: string, hint?: (json: any) => string): Promise<any> {
  const raw = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(raw);
  } catch {}
  if (res.status >= 500 || res.status === 429 || !json) {
    throw new ProviderError('retry', `${label} đang gặp sự cố khi cấp quyền. Sẽ tự thử lại.`, raw.slice(0, 500));
  }
  if (!res.ok || json.error || !json.access_token) {
    throw new ProviderError('reconnect', `${label} không cấp quyền truy cập. Hãy kết nối lại.${hint?.(json) || ''}`, raw.slice(0, 500));
  }
  return json;
}
