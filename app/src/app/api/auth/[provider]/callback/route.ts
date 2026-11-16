import { NextResponse } from 'next/server';
import { saveConnectedAccount } from '@/lib/channels';
import { config } from '@/lib/config';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers';
import { errorMessage } from '@/lib/api';

const back = (q: string) => NextResponse.redirect(`${config.appUrl}/?${q}`);

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: id } = await params;
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const denied = url.searchParams.get('error');

  if (denied) return back(`err=${encodeURIComponent('Bạn đã huỷ hoặc nền tảng từ chối cấp quyền.')}`);
  if (!code || !state) return back(`err=${encodeURIComponent('Thiếu mã xác thực từ nền tảng.')}`);

  // Chống giả mạo: state phải do chính app tạo, đúng nền tảng, trong 15 phút
  const saved = await prisma.oAuthState.findUnique({ where: { id: state } });
  // deleteMany: dùng 1 lần duy nhất, tải lại trang callback lần 2 không gây lỗi 500
  const consumed = saved ? (await prisma.oAuthState.deleteMany({ where: { id: state } })).count : 0;
  if (!saved || !consumed || saved.provider !== id || Date.now() - saved.createdAt.getTime() > 15 * 60_000) {
    return back(`err=${encodeURIComponent('Phiên kết nối đã hết hạn, hãy bấm kết nối lại.')}`);
  }

  try {
    const provider = getProvider(id);
    const account = await provider.exchangeCode(code);
    await saveConnectedAccount(id, account);
    return back(`ok=${encodeURIComponent(`Đã kết nối ${provider.label}: ${account.name}`)}`);
  } catch (err) {
    return back(`err=${encodeURIComponent(errorMessage(err))}`);
  }
}
