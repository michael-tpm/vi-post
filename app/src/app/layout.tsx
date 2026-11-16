import type { Metadata } from 'next';
import { Be_Vietnam_Pro } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const font = Be_Vietnam_Pro({
  subsets: ['vietnamese', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-be-vietnam',
});

export const metadata: Metadata = {
  title: 'ViPost — Lên lịch TikTok & YouTube',
  description: 'Soạn 1 lần, đăng video lên TikTok và YouTube đúng giờ.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={font.variable}>
      <body className="min-h-screen font-sans antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-white">V</span>
              ViPost
            </Link>
            <Link href="/posts/new" className="btn-primary">
              + Soạn bài mới
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
