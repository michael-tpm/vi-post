import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 1 câu lệnh: chỉ xoá khi không có bài đang tải/đang xử lý (tránh xoá giữa lúc worker vừa nhận bài)
  const r = await prisma.channel.deleteMany({
    where: { id, posts: { none: { state: { in: ['PUBLISHING', 'PENDING'] } } } },
  });
  if (r.count) return NextResponse.json({ ok: true });
  const exists = await prisma.channel.count({ where: { id } });
  return exists
    ? NextResponse.json({ error: 'Kênh đang có bài tải lên/đang xử lý, hãy đợi xong rồi gỡ.' }, { status: 409 })
    : NextResponse.json({ error: 'Kênh không còn tồn tại.' }, { status: 404 });
}
