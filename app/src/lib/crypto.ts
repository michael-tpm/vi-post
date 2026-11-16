import crypto from 'node:crypto';

// Token của TikTok/YouTube = quyền đăng bài lên kênh. Luôn mã hoá trước khi lưu DB.
function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'Thiếu ENCRYPTION_KEY (64 ký tự hex) trong file .env — tạo bằng: openssl rand -hex 32'
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split(':');
  if (version !== 'v1') throw new Error('Định dạng token không hợp lệ');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export function randomId(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('hex');
}
