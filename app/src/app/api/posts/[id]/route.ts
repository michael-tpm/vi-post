import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonError } from '@/lib/api';

// POST { action: 'cancel' | 'retry' | 'now' }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };

  if (action === 'cancel') {
    const r = await prisma.post.updateMany({ where: { id, state: 'QUEUE' }, data: { state: 'CANCELLED' } });
    if (!r.count) return jsonError('Chỉ huỷ được bài đang chờ đăng.');
  } else if (action === 'now') {
    const r = await prisma.post.updateMany({ where: { id, state: 'QUEUE' }, data: { publishAt: new Date(), nextCheckAt: null } });
    if (!r.count) return jsonError('Chỉ đăng ngay được bài đang chờ.');
  } else if (action === 'retry') {
    const post = await prisma.post.findUnique({ where: { id }, select: { state: true, channel: { select: { status: true } } } });
    if (post?.state !== 'ERROR') return jsonError('Chỉ thử lại được bài bị lỗi.');
    if (post.channel.status !== 'ACTIVE') return jsonError('Kênh cần kết nối lại trước.');
    const now = new Date();
    await prisma.post.update({
      where: { id },
      // GIỮ pendingData: nền tảng sẽ được hỏi về lần đăng trước (TikTok publish_id, YouTube phiên upload)
      // trước khi tải lại → bấm "Thử lại" không gây đăng trùng
      data: { state: 'QUEUE', attempts: 0, error: null, warning: null, nextCheckAt: null, checkCount: 0, publishAt: now },
      select: { id: true },
    });
  } else {
    return jsonError('Thao tác không hợp lệ.');
  }
  return NextResponse.json({ ok: true });
}
