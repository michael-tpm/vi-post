import { NextResponse } from 'next/server';
import { randomId } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers';
import { config } from '@/lib/config';

export async function GET(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: id } = await params;
  let provider;
  try {
    provider = getProvider(id);
  } catch {
    return NextResponse.redirect(`${config.appUrl}/?err=${encodeURIComponent('Nền tảng không hợp lệ')}`);
  }
  if (!provider.isConfigured()) {
    const msg = `Chưa cấu hình khoá ${provider.label} trong file .env — xem README mục "Lấy khoá API".`;
    return NextResponse.redirect(`${config.appUrl}/?err=${encodeURIComponent(msg)}`);
  }
  const state = randomId();
  await prisma.oAuthState.create({ data: { id: state, provider: id } });
  return NextResponse.redirect(provider.authUrl(state));
}
