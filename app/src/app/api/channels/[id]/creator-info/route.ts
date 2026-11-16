import { NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/channels';
import { prisma } from '@/lib/db';
import { getCreatorInfo, type CreatorInfo } from '@/lib/providers/tiktok';
import { errorMessage, jsonError } from '@/lib/api';

// TikTok yêu cầu hiện thông tin tài khoản + các lựa chọn quyền riêng tư lấy trực tiếp từ API mỗi lần soạn bài
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const channel = await prisma.channel.findUnique({ where: { id }, select: { provider: true, name: true, username: true } });
  if (!channel) return jsonError('Không tìm thấy kênh', 404);

  if (channel.provider === 'demo') {
    const demo: CreatorInfo = {
      creator_avatar_url: '',
      creator_username: channel.username || 'demo',
      creator_nickname: channel.name,
      privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
      comment_disabled: false,
      duet_disabled: false,
      stitch_disabled: true,
      max_video_post_duration_sec: 600,
    };
    return NextResponse.json(demo);
  }
  if (channel.provider !== 'tiktok') return jsonError('Chỉ áp dụng cho TikTok');

  try {
    let token = await getAccessToken(id);
    try {
      return NextResponse.json(await getCreatorInfo(token));
    } catch (err: any) {
      if (err?.kind !== 'refresh') throw err;
      token = await getAccessToken(id, true);
      return NextResponse.json(await getCreatorInfo(token));
    }
  } catch (err) {
    return jsonError(errorMessage(err));
  }
}
