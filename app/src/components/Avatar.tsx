'use client';
import { useState } from 'react';
import { ProviderIcon } from './ProviderIcon';

/** Ảnh đại diện từ TikTok/YouTube là link có hạn (TikTok ~2 giờ) → hỏng thì hiện icon nền tảng */
export function Avatar({ src, provider }: { src: string | null; provider: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken)
    return (
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100">
        <ProviderIcon provider={provider} />
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" onError={() => setBroken(true)} className="h-10 w-10 shrink-0 rounded-full object-cover" />;
}
