import { demoProvider } from './demo';
import { tiktokProvider } from './tiktok';
import type { Provider } from './types';
import { youtubeProvider } from './youtube';

const providers: Record<string, Provider> = {
  tiktok: tiktokProvider,
  youtube: youtubeProvider,
  demo: demoProvider,
};

export function getProvider(id: string): Provider {
  const p = providers[id];
  if (!p) throw new Error(`Không có nền tảng: ${id}`);
  return p;
}

export function listProviders(): Provider[] {
  return Object.values(providers);
}
