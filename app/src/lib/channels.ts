import type { Channel } from '@prisma/client';
import { decrypt, encrypt } from './crypto';
import { prisma } from './db';
import { getProvider } from './providers';
import { ProviderError, type ConnectedAccount, type TokenSet } from './providers/types';

const REFRESH_BEFORE_MS = 5 * 60_000;

export async function saveConnectedAccount(provider: string, acc: ConnectedAccount) {
  const data = {
    name: acc.name,
    username: acc.username ?? null,
    avatar: acc.avatar ?? null,
    accessToken: encrypt(acc.accessToken),
    refreshToken: acc.refreshToken ? encrypt(acc.refreshToken) : null,
    expiresAt: acc.expiresAt ?? null,
    refreshExpiresAt: acc.refreshExpiresAt ?? null,
    status: 'ACTIVE',
    statusMessage: null,
  };
  return prisma.channel.upsert({
    where: { provider_externalId: { provider, externalId: acc.externalId } },
    create: { provider, externalId: acc.externalId, ...data },
    update: data,
    select: { id: true },
  });
}

export async function markNeedReconnect(channelId: string, message: string) {
  await prisma.channel.update({
    where: { id: channelId },
    data: { status: 'NEED_RECONNECT', statusMessage: message },
    select: { id: true },
  });
}

/** Lấy access token còn hạn; sắp hết hạn (hoặc force) thì làm mới. Không làm mới được → kênh cần kết nối lại */
export async function getAccessToken(channelId: string, force = false): Promise<string> {
  const channel: Channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
  if (channel.status !== 'ACTIVE') {
    throw new ProviderError('reconnect', channel.statusMessage || 'Kênh cần được kết nối lại.');
  }
  const fresh = channel.expiresAt && channel.expiresAt.getTime() - Date.now() > REFRESH_BEFORE_MS;
  if (!force && (fresh || !channel.expiresAt)) return decrypt(channel.accessToken);

  if (!channel.refreshToken) {
    const msg = 'Phiên đăng nhập đã hết hạn. Hãy bấm "Kết nối lại".';
    await markNeedReconnect(channel.id, msg);
    throw new ProviderError('reconnect', msg);
  }

  let t: TokenSet;
  try {
    t = await getProvider(channel.provider).refresh(decrypt(channel.refreshToken));
  } catch (err) {
    if (!(err instanceof ProviderError) || err.kind === 'retry') {
      // Sự cố tạm thời (mạng, máy chủ nền tảng 5xx, lỗi đọc DB…) → thử lại sau, KHÔNG bắt khách kết nối lại
      throw err instanceof ProviderError
        ? err
        : new ProviderError('retry', 'Chưa làm mới được phiên đăng nhập. Sẽ tự thử lại.', String(err));
    }

    // TikTok đổi refresh token sau mỗi lần làm mới. Nếu web và worker cùng làm mới một lúc,
    // bên chậm hơn dùng token cũ sẽ bị từ chối — khi đó bên kia đã lưu token mới, dùng luôn thay vì báo "kết nối lại".
    const latest = await prisma.channel.findUnique({ where: { id: channel.id } });
    if (latest && latest.refreshToken !== channel.refreshToken && latest.status === 'ACTIVE') {
      return decrypt(latest.accessToken);
    }

    await markNeedReconnect(channel.id, err.message);
    throw new ProviderError('reconnect', err.message, err.raw);
  }

  // Lưu token mới. TikTok đã huỷ refresh token cũ, nên mất bản ghi này là mất kênh → thử ghi vài lần.
  for (let i = 0; ; i++) {
    try {
      await prisma.channel.update({
        where: { id: channel.id },
        data: {
          accessToken: encrypt(t.accessToken),
          ...(t.refreshToken ? { refreshToken: encrypt(t.refreshToken) } : {}),
          expiresAt: t.expiresAt ?? null,
          ...(t.refreshExpiresAt ? { refreshExpiresAt: t.refreshExpiresAt } : {}),
        },
        select: { id: true },
      });
      return t.accessToken;
    } catch (err) {
      if (i >= 4) {
        console.error('Không lưu được token mới:', err);
        return t.accessToken; // vẫn dùng được cho lượt này; lần sau nếu hỏng sẽ báo kết nối lại
      }
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
}

/** Danh sách kênh an toàn để trả ra giao diện (không bao giờ kèm token) */
export function listChannelsSafe() {
  return prisma.channel.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      provider: true,
      name: true,
      username: true,
      avatar: true,
      status: true,
      statusMessage: true,
    },
  });
}
