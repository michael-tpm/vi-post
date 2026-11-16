'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ActionButton({
  url,
  method = 'POST',
  body,
  confirmText,
  children,
  className = 'btn-ghost !px-3 !py-1 text-xs',
}: {
  url: string;
  method?: 'POST' | 'DELETE';
  body?: unknown;
  confirmText?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={className}
      disabled={busy}
      onClick={async () => {
        if (confirmText && !confirm(confirmText)) return;
        setBusy(true);
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) alert((await res.json().catch(() => ({}))).error || 'Có lỗi xảy ra');
        setBusy(false);
        router.refresh();
      }}
    >
      {children}
    </button>
  );
}
