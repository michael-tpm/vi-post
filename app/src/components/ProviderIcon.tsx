export function ProviderIcon({ provider, className = 'h-5 w-5' }: { provider: string; className?: string }) {
  if (provider === 'tiktok')
    return (
      <svg viewBox="0 0 24 24" className={className} aria-label="TikTok">
        <path fill="#111" d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-1.8-2.5V9.7a5.7 5.7 0 1 0 4.9 5.7V9.1a7.3 7.3 0 0 0 4.3 1.4V7.4a4.3 4.3 0 0 1-3.2-1.6z" />
      </svg>
    );
  if (provider === 'youtube')
    return (
      <svg viewBox="0 0 24 24" className={className} aria-label="YouTube">
        <path fill="#FF0000" d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8z" />
        <path fill="#fff" d="M9.8 15.1 15.6 12 9.8 8.9z" />
      </svg>
    );
  return <span className={`${className} inline-grid place-items-center rounded bg-slate-200 text-[10px] font-bold`}>D</span>;
}
