import { NextResponse } from 'next/server';
import { randomId } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { validateTikTokSettings, type TikTokSettings } from '@/lib/providers/tiktok';
import { validateYouTube, type YouTubeSettings } from '@/lib/providers/youtube';
import { jsonError } from '@/lib/api';

type Target = { channelId: string; caption?: string; title?: string; settings?: any };

const nfc = (s?: string | null) => (s ?? '').normalize('NFC').trim();

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return jsonError('Dữ liệu không hợp lệ');
  const { mediaId, publishAt, targets } = body as { mediaId: string; publishAt?: string | null; targets: Target[] };

  if (!mediaId) return jsonError('Hãy tải video lên trước.');
  if (!Array.isArray(targets) || targets.length === 0) return jsonError('Hãy chọn ít nhất 1 kênh.');

  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return jsonError('Không tìm thấy video đã tải lên.');

  const when = publishAt ? new Date(publishAt) : new Date();
  if (Number.isNaN(when.getTime())) return jsonError('Thời gian đăng không hợp lệ.');
  if (when.getTime() < Date.now() - 60_000) return jsonError('Thời gian đăng đã qua. Chọn "Đăng ngay" hoặc một thời điểm trong tương lai.');

  const channels = await prisma.channel.findMany({
    where: { id: { in: targets.map((t) => t.channelId) } },
    select: { id: true, provider: true, name: true, status: true },
  });

  const rows = [];
  const seen = new Set<string>();
  for (const t of targets) {
    if (seen.has(t.channelId)) continue; // 1 kênh chỉ 1 bài trong 1 lần soạn
    seen.add(t.channelId);
    const ch = channels.find((c) => c.id === t.channelId);
    if (!ch) return jsonError('Có kênh không tồn tại.');
    if (ch.status !== 'ACTIVE') return jsonError(`Kênh ${ch.name} cần kết nối lại trước khi đăng.`);
    const caption = nfc(t.caption);
    const title = nfc(t.title) || null;
    const settings = t.settings && typeof t.settings === 'object' ? { ...t.settings } : {};
    if (ch.provider === 'youtube') {
      settings.tags = Array.isArray(settings.tags)
        ? settings.tags.filter((x: unknown) => typeof x === 'string').map((x: string) => x.normalize('NFC').trim()).filter(Boolean)
        : [];
    }

    let invalid: string | null = null;
    if (ch.provider === 'youtube') {
      invalid = validateYouTube(title, caption, settings as YouTubeSettings);
    } else {
      // tiktok + demo dùng chung luật TikTok
      if (caption.length > 2200) invalid = 'Nội dung TikTok tối đa 2200 ký tự.';
      else invalid = validateTikTokSettings(settings as TikTokSettings, null, media.duration);
    }
    if (invalid) return jsonError(`${ch.name}: ${invalid}`);

    rows.push({ channelId: ch.id, caption, title, settings: JSON.stringify(settings) });
  }

  const groupId = randomId(8);
  await prisma.post.createMany({
    data: rows.map((r) => ({ ...r, groupId, mediaId, publishAt: when })),
  });
  return NextResponse.json({ groupId, count: rows.length });
}
