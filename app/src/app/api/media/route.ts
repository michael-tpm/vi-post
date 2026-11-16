import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { NextResponse } from 'next/server';
import { isAuthorized, UNAUTHORIZED_HEADERS } from '@/lib/basic-auth';
import { config } from '@/lib/config';
import { randomId } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { ALLOWED_VIDEO, probeVideo } from '@/lib/media';

export const runtime = 'nodejs';

const MAX_BYTES = 4 * 1024 * 1024 * 1024; // TikTok tối đa 4GB

// PUT /api/media?name=video.mp4  — body là file thô (stream thẳng xuống đĩa, không dồn vào RAM)
export async function PUT(req: Request) {
  if (!isAuthorized(req.headers.get('authorization'))) {
    return new NextResponse('Cần đăng nhập', { status: 401, headers: UNAUTHORIZED_HEADERS });
  }
  const url = new URL(req.url);
  const originalName = (url.searchParams.get('name') || 'video.mp4').normalize('NFC').slice(0, 200);
  const ext = path.extname(originalName).toLowerCase();
  const mime = ALLOWED_VIDEO[ext];
  if (!mime) return NextResponse.json({ error: 'Chỉ nhận video MP4, MOV hoặc WebM.' }, { status: 400 });
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) return NextResponse.json({ error: 'Video tối đa 4GB.' }, { status: 400 });
  if (!req.body) return NextResponse.json({ error: 'Không có dữ liệu file.' }, { status: 400 });

  await mkdir(config.uploadDir, { recursive: true });
  const dest = path.join(config.uploadDir, `${Date.now()}-${randomId(6)}${ext}`);
  let size = 0;
  try {
    const source = Readable.fromWeb(req.body as any);
    source.on('data', (c: Buffer) => {
      size += c.length;
      // dừng ngay khi vượt 4GB, không đợi ghi hết lên đĩa
      if (size > MAX_BYTES) source.destroy(new Error('too-large'));
    });
    await pipeline(source, createWriteStream(dest));
  } catch {
    await unlink(dest).catch(() => {});
    const msg = size > MAX_BYTES ? 'Video tối đa 4GB.' : 'Tải file bị gián đoạn, hãy thử lại.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  // Trình duyệt bị ngắt giữa chừng có thể kết thúc luồng "êm" → so với dung lượng khai báo để không lưu file cụt
  if (size === 0 || (declared && size !== declared)) {
    await unlink(dest).catch(() => {});
    return NextResponse.json({ error: size === 0 ? 'File rỗng.' : 'Tải file chưa trọn vẹn, hãy thử lại.' }, { status: 400 });
  }

  const info = await probeVideo(dest);
  const clientDuration = Number(url.searchParams.get('duration'));
  const media = await prisma.media.create({
    data: {
      originalName,
      path: dest,
      mime,
      size: BigInt(size),
      duration: info.duration ?? (Number.isFinite(clientDuration) && clientDuration > 0 ? clientDuration : null),
      width: info.width ?? null,
      height: info.height ?? null,
    },
  });
  return NextResponse.json({
    id: media.id,
    originalName,
    size,
    duration: media.duration,
    width: media.width,
    height: media.height,
  });
}
