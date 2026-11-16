import Link from 'next/link';
import { ActionButton } from '@/components/ActionButton';
import { Avatar } from '@/components/Avatar';
import { AutoRefresh } from '@/components/AutoRefresh';
import { ProviderIcon } from '@/components/ProviderIcon';
import { listChannelsSafe } from '@/lib/channels';
import { prisma } from '@/lib/db';
import { formatDateTime, PROVIDER_LABEL, STATE_LABEL } from '@/lib/format';
import { listProviders } from '@/lib/providers';

export const dynamic = 'force-dynamic';

const ACTIVE = ['QUEUE', 'PUBLISHING', 'PENDING'];

export default async function Home({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { ok, err } = await searchParams;
  const channels = await listChannelsSafe();
  const providers = listProviders().filter((p) => p.id !== 'demo' || p.isConfigured());

  const postSelect = {
    id: true,
    state: true,
    publishAt: true,
    caption: true,
    title: true,
    externalUrl: true,
    error: true,
    warning: true,
    channel: { select: { name: true, provider: true } },
    media: { select: { originalName: true } },
  } as const;

  const [upcoming, recent] = await Promise.all([
    prisma.post.findMany({ where: { state: { in: ACTIVE } }, orderBy: { publishAt: 'asc' }, select: postSelect }),
    prisma.post.findMany({
      where: { state: { notIn: ACTIVE } },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: postSelect,
    }),
  ]);

  return (
    <div className="space-y-6">
      <AutoRefresh active={upcoming.length > 0} />

      {ok && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{ok}</div>}
      {err && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>}

      <section className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Kênh đã kết nối</h2>
          <div className="flex flex-wrap gap-2">
            {providers.map((p) => (
              <a key={p.id} href={`/api/auth/${p.id}/start`} className="btn-ghost" title={p.isConfigured() ? '' : 'Chưa có khoá API trong .env'}>
                <ProviderIcon provider={p.id} className="h-4 w-4" />
                Kết nối {p.label}
                {!p.isConfigured() && <span className="text-xs font-normal text-amber-600">(chưa cấu hình)</span>}
              </a>
            ))}
          </div>
        </div>

        {channels.length === 0 ? (
          <p className="text-sm text-slate-500">Chưa có kênh nào. Bấm “Kết nối TikTok” hoặc “Kết nối YouTube” ở trên để bắt đầu.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {channels.map((c) => (
              <li key={c.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3">
                <Avatar src={c.avatar} provider={c.provider} />
                <div className="min-w-[9rem] flex-1">
                  <div className="flex items-center gap-1.5 truncate font-medium">
                    <ProviderIcon provider={c.provider} className="h-4 w-4 shrink-0" />
                    <span className="truncate">{c.name}</span>
                  </div>
                  <div className="line-clamp-2 text-xs text-slate-500">
                    {c.username ? `@${c.username.replace(/^@/, '')} · ` : ''}
                    {c.status === 'ACTIVE' ? (
                      <span className="text-emerald-600">Đang hoạt động</span>
                    ) : (
                      <span className="text-red-600">Cần kết nối lại</span>
                    )}
                  </div>
                </div>
                {c.status !== 'ACTIVE' && (
                  <a href={`/api/auth/${c.provider}/start`} className="btn-primary !px-3 !py-1 text-xs">
                    Kết nối lại
                  </a>
                )}
                <ActionButton
                  url={`/api/channels/${c.id}`}
                  method="DELETE"
                  confirmText={`Gỡ kênh "${c.name}"? Các bài chờ đăng của kênh này cũng bị xoá.`}
                >
                  Gỡ
                </ActionButton>
                {c.status !== 'ACTIVE' && c.statusMessage && (
                  <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{c.statusMessage}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Sắp đăng & đang xử lý ({upcoming.length})</h2>
          <Link href="/posts/new" className="text-sm font-medium text-indigo-600 hover:underline">
            + Soạn bài
          </Link>
        </div>
        <PostList posts={upcoming} empty="Không có bài nào đang chờ." />
      </section>

      <section className="card">
        <h2 className="mb-4 text-base font-semibold">Gần đây</h2>
        <PostList posts={recent} empty="Chưa có bài nào." />
      </section>

      <p className="text-center text-xs text-slate-400">
        Giờ hiển thị theo giờ Việt Nam. Bài hẹn giờ chỉ được đăng khi máy đang bật và cửa sổ worker đang chạy.
      </p>
    </div>
  );
}

type PostRow = {
  id: string;
  state: string;
  publishAt: Date;
  caption: string;
  title: string | null;
  externalUrl: string | null;
  error: string | null;
  warning: string | null;
  channel: { name: string; provider: string };
  media: { originalName: string };
};

function PostList({ posts, empty }: { posts: PostRow[]; empty: string }) {
  if (posts.length === 0) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {posts.map((p) => {
        const st = STATE_LABEL[p.state] || STATE_LABEL.QUEUE;
        return (
          <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
            <div className="w-36 shrink-0 text-sm tabular-nums text-slate-600">{formatDateTime(p.publishAt)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-sm font-medium">
                  <ProviderIcon provider={p.channel.provider} className="h-4 w-4" />
                  {p.channel.name}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.className}`}>{st.text}</span>
                <span className="text-xs text-slate-400">{PROVIDER_LABEL[p.channel.provider]} · {p.media.originalName}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-slate-700">{p.title ? <b>{p.title} — </b> : null}{p.caption || <i className="text-slate-400">(không có nội dung)</i>}</p>
              {p.error && <p className="mt-1 text-sm text-red-600">⚠ {p.error}</p>}
              {p.warning && <p className="mt-1 text-sm text-amber-700">ℹ {p.warning}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {p.externalUrl && (
                <a href={p.externalUrl} target="_blank" rel="noreferrer" className="btn-ghost !px-3 !py-1 text-xs">
                  Xem bài ↗
                </a>
              )}
              {p.state === 'QUEUE' && (
                <>
                  <ActionButton url={`/api/posts/${p.id}`} body={{ action: 'now' }}>Đăng ngay</ActionButton>
                  <ActionButton url={`/api/posts/${p.id}`} body={{ action: 'cancel' }} confirmText="Huỷ bài này?">Huỷ</ActionButton>
                </>
              )}
              {p.state === 'ERROR' && (
                <ActionButton url={`/api/posts/${p.id}`} body={{ action: 'retry' }} confirmText="Thử đăng lại bài này? ViPost sẽ hỏi nền tảng về lần đăng trước, chỉ tải lại khi chắc chắn bài chưa lên.">
                  Thử lại
                </ActionButton>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
