'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ProviderIcon } from '@/components/ProviderIcon';

type Channel = { id: string; provider: string; name: string; username: string | null; avatar: string | null; status: string };
type UploadedMedia = { id: string; originalName: string; size: number; duration: number | null; width: number | null; height: number | null };
type CreatorInfo = {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
};

const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Mọi người',
  MUTUAL_FOLLOW_FRIENDS: 'Bạn bè (follow lẫn nhau)',
  FOLLOWER_OF_CREATOR: 'Người theo dõi',
  SELF_ONLY: 'Chỉ mình tôi',
};

const isTikTokLike = (p: string) => p === 'tiktok' || p === 'demo';

function fmtSize(n: number) {
  return n > 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
}
function fmtDur(s?: number | null) {
  if (s == null) return '?';
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}
// Luôn hiểu giờ nhập là GIỜ VIỆT NAM (GMT+7, không có giờ mùa hè), dù máy đang đặt múi giờ khác —
// khớp với trang tổng quan vốn hiển thị theo Asia/Ho_Chi_Minh.
const VN_OFFSET_MS = 7 * 3600_000;
function toVnInput(d: Date) {
  return new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 16); // "YYYY-MM-DDTHH:mm" theo giờ VN
}
function fromVnInput(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return null;
  const d = new Date(`${s}:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function vnTime(dayOffset: number, h: number, m: number): Date {
  const today = toVnInput(new Date()).slice(0, 10);
  return new Date(new Date(`${today}T00:00:00+07:00`).getTime() + dayOffset * 86_400_000 + (h * 60 + m) * 60_000);
}
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(v.src);
      resolve(Number.isFinite(v.duration) ? v.duration : null);
    };
    v.onerror = () => resolve(null);
    v.src = URL.createObjectURL(file);
  });
}

export default function NewPostPage() {
  const router = useRouter();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [needReconnect, setNeedReconnect] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [media, setMedia] = useState<UploadedMedia | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [caption, setCaption] = useState('');
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [creator, setCreator] = useState<Record<string, CreatorInfo | { error: string }>>({});
  const requested = useRef(new Set<string>()); // tránh gọi creator_info trùng (TikTok giới hạn 20 lần/phút)
  const uploadReq = useRef<XMLHttpRequest | null>(null);
  const [when, setWhen] = useState<'now' | 'later'>('later');
  const [at, setAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/channels')
      .then((r) => r.json())
      .then((list: Channel[]) => {
        setChannels(list.filter((c) => c.status === 'ACTIVE'));
        setNeedReconnect(list.filter((c) => c.status !== 'ACTIVE').length);
      });
    setAt(toVnInput(new Date(Date.now() + 60 * 60_000)).slice(0, 14) + '00');
  }, []);

  // TikTok: lấy thông tin tài khoản + lựa chọn quyền riêng tư mới nhất mỗi lần chọn kênh
  useEffect(() => {
    for (const id of selected) {
      const ch = channels.find((c) => c.id === id);
      if (!ch || !isTikTokLike(ch.provider) || requested.current.has(id)) continue;
      requested.current.add(id);
      fetch(`/api/channels/${id}/creator-info`)
        .then(async (r) => ((r.ok ? r.json() : { error: (await r.json()).error }) as any))
        .then((info) => setCreator((c) => ({ ...c, [id]: info })))
        .catch(() => setCreator((c) => ({ ...c, [id]: { error: 'Không lấy được thông tin tài khoản TikTok.' } })));
    }
  }, [selected, channels]);

  const selectedChannels = useMemo(() => channels.filter((c) => selected.includes(c.id)), [channels, selected]);

  // Kiểm tra ngay trên giao diện: còn lỗi thì khoá nút đăng (TikTok yêu cầu khoá nút khi thiếu lựa chọn bắt buộc)
  const problems = useMemo(() => {
    const list: string[] = [];
    if (progress !== null) list.push('Đang tải video lên…');
    else if (!media) list.push('Chưa tải video lên.');
    if (selectedChannels.length === 0) list.push('Chưa chọn kênh nào.');
    for (const ch of selectedChannels) {
      const s = settings[ch.id] || {};
      if (isTikTokLike(ch.provider)) {
        const info = creator[ch.id];
        const text = (s.captionOverride ?? caption).normalize('NFC');
        if (!info) list.push(`${ch.name}: đang lấy thông tin tài khoản TikTok…`);
        else if ('error' in info) list.push(`${ch.name}: ${info.error}`);
        else if (s.mode !== 'inbox') {
          if (!s.privacyLevel) list.push(`${ch.name}: chưa chọn ai được xem video.`);
          if (s.commercial && !s.yourBrand && !s.brandedContent) list.push(`${ch.name}: chưa chọn loại nội dung thương mại.`);
          if (media?.duration != null && media.duration > info.max_video_post_duration_sec)
            list.push(`${ch.name}: video dài quá ${info.max_video_post_duration_sec} giây.`);
        }
        if (text.length > 2200) list.push(`${ch.name}: nội dung quá 2200 ký tự.`);
      } else {
        const title = String(s.title || '').trim();
        if (!title) list.push(`${ch.name}: chưa có tiêu đề YouTube.`);
        if (/[<>]/.test(title) || /[<>]/.test(s.description ?? caption)) list.push(`${ch.name}: YouTube không cho dùng ký tự < hoặc >.`);
        if (typeof s.madeForKids !== 'boolean') list.push(`${ch.name}: chưa chọn video có dành cho trẻ em không.`);
      }
    }
    if (when === 'later') {
      const d = fromVnInput(at);
      if (!d) list.push('Chưa chọn thời gian hẹn.');
      else if (d.getTime() < Date.now() - 60_000) list.push('Thời gian hẹn đã qua.');
    }
    return list;
  }, [progress, media, selectedChannels, settings, creator, caption, when, at]);

  function patch(id: string, p: Record<string, any>) {
    setSettings((s) => ({ ...s, [id]: { ...s[id], ...p } }));
  }

  function toggleChannel(ch: Channel) {
    setSelected((s) => (s.includes(ch.id) ? s.filter((x) => x !== ch.id) : [...s, ch.id]));
    if (!settings[ch.id]) {
      patch(
        ch.id,
        isTikTokLike(ch.provider)
          ? { mode: 'direct', allowComment: false, allowDuet: false, allowStitch: false, commercial: false, isAigc: false }
          : { privacy: 'public', madeForKids: undefined, tags: '', notifySubscribers: true, title: '' }
      );
    }
  }

  async function upload(file: File) {
    // Chọn video khác khi video trước chưa tải xong → huỷ bản trước, tránh đăng nhầm video
    uploadReq.current?.abort();
    uploadReq.current = null;
    setError(null);
    setMedia(null);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    const duration = await readDuration(file);
    setProgress(0);
    const xhr = new XMLHttpRequest();
    uploadReq.current = xhr;
    const isCurrent = () => uploadReq.current === xhr;
    xhr.open('PUT', `/api/media?name=${encodeURIComponent(file.name)}${duration ? `&duration=${duration}` : ''}`);
    xhr.upload.onprogress = (e) => isCurrent() && e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (!isCurrent()) return;
      setProgress(null);
      let json: any = {};
      try {
        json = JSON.parse(xhr.responseText || '{}');
      } catch {}
      if (xhr.status >= 300) setError(json.error || 'Tải video thất bại');
      else setMedia(json);
    };
    xhr.onerror = () => {
      if (!isCurrent()) return;
      setProgress(null);
      setError('Mất kết nối khi tải video.');
    };
    xhr.send(file);
  }

  async function submit() {
    setError(null);
    if (!media) return setError('Hãy tải video lên trước.');
    if (selectedChannels.length === 0) return setError('Hãy chọn ít nhất 1 kênh.');
    const targets = selectedChannels.map((ch) => {
      const s = settings[ch.id] || {};
      if (isTikTokLike(ch.provider)) {
        const { captionOverride, ...rest } = s;
        return { channelId: ch.id, caption: captionOverride?.trim() ? captionOverride : caption, settings: rest };
      }
      const { title, description, tags, ...rest } = s;
      return {
        channelId: ch.id,
        title,
        caption: description?.trim() ? description : caption,
        settings: { ...rest, tags: String(tags || '').split(',').map((t: string) => t.trim()).filter(Boolean) },
      };
    });
    const when_ = when === 'now' ? null : fromVnInput(at);
    if (when === 'later' && !when_) return setError('Thời gian hẹn không hợp lệ.');
    const publishAt = when_ ? when_.toISOString() : null;
    if (submitting) return;
    setSubmitting(true);
    let res: Response;
    let json: any = {};
    try {
      res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaId: media.id, publishAt, targets }),
      });
      json = await res.json().catch(() => ({}));
    } catch {
      setSubmitting(false);
      return setError('Mất kết nối tới ViPost, bài chưa được lưu. Hãy thử lại.');
    }
    // Thành công thì GIỮ nút ở trạng thái "Đang lưu…" tới khi chuyển trang → không bấm được lần 2 (tránh lên lịch trùng)
    if (!res.ok) {
      setSubmitting(false);
      return setError(json.error || 'Không tạo được bài.');
    }
    const msg = when === 'now' ? `Đã đưa ${json.count} bài vào hàng đợi, sẽ đăng trong vài giây.` : `Đã lên lịch ${json.count} bài.`;
    router.push(`/?ok=${encodeURIComponent(msg)}`);
  }

  const quickTimes = [
    { label: 'Trưa nay 11:30', h: 11, m: 30, day: 0 },
    { label: 'Tối nay 19:30', h: 19, m: 30, day: 0 },
    { label: 'Tối nay 21:00', h: 21, m: 0, day: 0 },
    { label: 'Mai 11:30', h: 11, m: 30, day: 1 },
    { label: 'Mai 19:30', h: 19, m: 30, day: 1 },
  ].filter((q) => vnTime(q.day, q.h, q.m).getTime() > Date.now());

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Soạn bài mới</h1>
        <Link href="/" className="text-sm text-slate-500 hover:underline">← Quay lại</Link>
      </div>

      {/* 1. Video */}
      <section className="card space-y-3">
        <h2 className="font-semibold">1. Video</h2>
        <input
          type="file"
          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:font-semibold file:text-indigo-700"
        />
        {progress !== null && (
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
        {preview && (
          <div className="flex flex-col gap-3 sm:flex-row">
            <video src={preview} controls className="max-h-72 rounded-xl bg-black" />
            {media && (
              <div className="text-sm text-slate-600">
                <div className="font-medium text-slate-800">{media.originalName}</div>
                <div>Dung lượng: {fmtSize(media.size)}</div>
                <div>Thời lượng: {fmtDur(media.duration)}</div>
                {media.width && <div>Khung hình: {media.width}×{media.height} {media.height! > media.width ? '(dọc)' : '(ngang)'}</div>}
                <div className="mt-1 text-emerald-600">✓ Đã tải lên máy chủ local</div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. Kênh */}
      <section className="card space-y-3">
        <h2 className="font-semibold">2. Chọn kênh</h2>
        {needReconnect > 0 && (
          <p className="text-xs text-amber-700">
            Có {needReconnect} kênh cần kết nối lại nên không hiện ở đây. <Link href="/" className="underline">Mở trang kênh</Link>
          </p>
        )}
        {channels.length === 0 ? (
          <p className="text-sm text-slate-500">
            Chưa có kênh nào hoạt động. <Link href="/" className="text-indigo-600 underline">Kết nối kênh</Link> trước.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {channels.map((ch) => (
              <label key={ch.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${selected.includes(ch.id) ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200'}`}>
                <input type="checkbox" checked={selected.includes(ch.id)} onChange={() => toggleChannel(ch)} />
                <ProviderIcon provider={ch.provider} className="h-4 w-4" />
                {ch.name}
              </label>
            ))}
          </div>
        )}
      </section>

      {/* 3. Nội dung chung */}
      <section className="card space-y-2">
        <h2 className="font-semibold">3. Nội dung chung</h2>
        <p className="text-xs text-slate-500">Dùng làm caption TikTok và mô tả YouTube (có thể sửa riêng từng kênh bên dưới).</p>
        <textarea className="input min-h-28" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Viết nội dung, hashtag… #viral #xuhuong" />
        <div className="text-right text-xs text-slate-400">{caption.normalize('NFC').length}/2200</div>
      </section>

      {/* 4. Cài đặt từng kênh */}
      {selectedChannels.map((ch) =>
        isTikTokLike(ch.provider) ? (
          <TikTokPanel key={ch.id} ch={ch} s={settings[ch.id] || {}} info={creator[ch.id]} media={media} caption={caption} patch={(p) => patch(ch.id, p)} />
        ) : (
          <YouTubePanel key={ch.id} ch={ch} s={settings[ch.id] || {}} caption={caption} patch={(p) => patch(ch.id, p)} />
        )
      )}

      {/* 5. Thời gian */}
      <section className="card space-y-3">
        <h2 className="font-semibold">4. Thời gian đăng</h2>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={when === 'later'} onChange={() => setWhen('later')} /> Hẹn giờ</label>
          <label className="flex items-center gap-2"><input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} /> Đăng ngay</label>
        </div>
        {when === 'later' && (
          <>
            <input type="datetime-local" className="input max-w-xs" value={at} onChange={(e) => setAt(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              {quickTimes.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  className="btn-ghost !px-3 !py-1 text-xs"
                  onClick={() => setAt(toVnInput(vnTime(q.day, q.h, q.m)))}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500">Giờ Việt Nam (GMT+7), kể cả khi máy đang đặt múi giờ khác. Máy phải bật và worker phải chạy vào giờ này.</p>
          </>
        )}
      </section>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {problems.length > 0 && (
        <ul className="list-disc rounded-xl border border-amber-200 bg-amber-50 py-3 pl-8 pr-4 text-sm text-amber-800">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      <div className="flex justify-end">
        <button className="btn-primary px-6 py-3" disabled={submitting || problems.length > 0} onClick={submit}>
          {submitting ? 'Đang lưu…' : when === 'now' ? 'Đăng ngay' : 'Lên lịch'}
        </button>
      </div>
    </div>
  );
}

function PanelHeader({ ch }: { ch: Channel }) {
  return (
    <h2 className="flex items-center gap-2 font-semibold">
      <ProviderIcon provider={ch.provider} /> Cài đặt cho {ch.name}
    </h2>
  );
}

function TikTokPanel({
  ch, s, info, media, caption, patch,
}: {
  ch: Channel;
  s: any;
  info?: CreatorInfo | { error: string };
  media: UploadedMedia | null;
  caption: string;
  patch: (p: Record<string, any>) => void;
}) {
  if (!info) return <section className="card"><PanelHeader ch={ch} /><p className="mt-2 text-sm text-slate-500">Đang lấy thông tin tài khoản TikTok…</p></section>;
  if ('error' in info) return <section className="card"><PanelHeader ch={ch} /><p className="mt-2 text-sm text-red-600">{info.error}</p></section>;

  const tooLong = media?.duration != null && media.duration > info.max_video_post_duration_sec;
  const direct = s.mode !== 'inbox';

  return (
    <section className="card space-y-4">
      <PanelHeader ch={ch} />

      {/* TikTok yêu cầu hiện rõ tài khoản sẽ nhận bài */}
      <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
        {info.creator_avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={info.creator_avatar_url} alt="" className="h-10 w-10 rounded-full" />
        ) : (
          <div className="h-10 w-10 rounded-full bg-slate-200" />
        )}
        <div className="text-sm">
          <div className="font-semibold">{info.creator_nickname}</div>
          <div className="text-slate-500">@{info.creator_username} · video tối đa {Math.round(info.max_video_post_duration_sec / 60)} phút</div>
        </div>
      </div>

      {tooLong && <p className="text-sm text-red-600">Video dài hơn giới hạn {info.max_video_post_duration_sec} giây của tài khoản này.</p>}

      <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-6">
        <label className="flex items-center gap-2"><input type="radio" checked={direct} onChange={() => patch({ mode: 'direct' })} /> Đăng thẳng lên TikTok</label>
        <label className="flex items-center gap-2"><input type="radio" checked={!direct} onChange={() => patch({ mode: 'inbox' })} /> Đẩy vào hộp nháp (tự bấm đăng trong app)</label>
      </div>
      {!direct && (
        <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
          Video sẽ vào mục Hộp thư của app TikTok, bạn mở điện thoại để chỉnh và bấm đăng trong 24 giờ. Tối đa 5 video chờ mỗi 24 giờ.
          Cách này dùng được cả khi app chưa qua kiểm duyệt TikTok mà vẫn đăng công khai được.
          <br />
          <b>Lưu ý:</b> ở chế độ này TikTok không nhận nội dung chữ từ app — bạn dán caption khi bấm đăng trong app TikTok.
        </p>
      )}

      {direct && (
        <div>
          <label className="label">Nội dung riêng cho TikTok (để trống = dùng nội dung chung)</label>
          <textarea className="input min-h-20" value={s.captionOverride ?? ''} placeholder={caption} onChange={(e) => patch({ captionOverride: e.target.value || undefined })} />
        </div>
      )}

      {direct && (
        <>
          <div>
            <label className="label">Ai có thể xem video này? *</label>
            <select className="input max-w-sm" value={s.privacyLevel || ''} onChange={(e) => patch({ privacyLevel: e.target.value || undefined })}>
              <option value="">— Chọn —</option>
              {info.privacy_level_options.map((o) => (
                <option key={o} value={o} disabled={o === 'SELF_ONLY' && s.commercial && s.brandedContent}>
                  {PRIVACY_LABEL[o] || o}
                  {o === 'SELF_ONLY' && s.commercial && s.brandedContent ? ' (không dùng được với nội dung có thương hiệu)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="label">Cho phép người xem</div>
            <div className="flex flex-wrap gap-4 text-sm">
              {([
                ['allowComment', 'Bình luận', info.comment_disabled],
                ['allowDuet', 'Duet', info.duet_disabled],
                ['allowStitch', 'Stitch', info.stitch_disabled],
              ] as const).map(([key, label, disabled]) => (
                <label key={key} className={`flex items-center gap-2 ${disabled ? 'text-slate-400' : ''}`}>
                  <input type="checkbox" disabled={disabled} checked={!disabled && Boolean(s[key])} onChange={(e) => patch({ [key]: e.target.checked })} />
                  {label}
                  {disabled && <span className="text-xs">(đã tắt trong cài đặt TikTok)</span>}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={Boolean(s.commercial)} onChange={(e) => patch({ commercial: e.target.checked, yourBrand: false, brandedContent: false })} />
              Tiết lộ nội dung thương mại (video quảng bá sản phẩm, thương hiệu…)
            </label>
            {s.commercial && (
              <div className="space-y-2 pl-6 text-sm">
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={Boolean(s.yourBrand)} onChange={(e) => patch({ yourBrand: e.target.checked })} />
                  <span><b>Thương hiệu của bạn</b> — quảng bá cho chính bạn/doanh nghiệp của bạn. Video sẽ được gắn nhãn “Nội dung quảng cáo”.</span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(s.brandedContent)}
                    onChange={(e) => patch({ brandedContent: e.target.checked, ...(e.target.checked && s.privacyLevel === 'SELF_ONLY' ? { privacyLevel: undefined } : {}) })}
                  />
                  <span><b>Nội dung có thương hiệu</b> — hợp tác/được trả tiền bởi bên thứ ba. Video sẽ được gắn nhãn “Hợp tác trả phí”.</span>
                </label>
                {!s.yourBrand && !s.brandedContent ? (
                  <p className="text-xs text-red-600">Hãy chọn ít nhất 1 loại để có thể đăng.</p>
                ) : (
                  <p className="text-xs text-slate-600">
                    Video sẽ được gắn nhãn <b>“{s.brandedContent ? 'Hợp tác trả phí' : 'Nội dung quảng cáo'}”</b>.
                  </p>
                )}
                {s.brandedContent && <p className="text-xs text-slate-500">Nội dung có thương hiệu không thể để chế độ “Chỉ mình tôi”.</p>}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(s.isAigc)} onChange={(e) => patch({ isAigc: e.target.checked })} />
            Video có nội dung tạo bằng AI (TikTok sẽ gắn nhãn AI)
          </label>
        </>
      )}

      <p className="text-xs text-slate-500">
        Khi đăng, bạn đồng ý với{' '}
        {s.commercial && s.brandedContent && (
          <>
            <a className="underline" href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">Chính sách nội dung có thương hiệu</a> và{' '}
          </>
        )}
        <a className="underline" href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Xác nhận sử dụng nhạc</a> của TikTok.
        Sau khi đăng, TikTok có thể mất vài phút để xử lý video trước khi hiện trên trang cá nhân.
      </p>
    </section>
  );
}

function YouTubePanel({ ch, s, caption, patch }: { ch: Channel; s: any; caption: string; patch: (p: Record<string, any>) => void }) {
  const title: string = s.title || '';
  return (
    <section className="card space-y-4">
      <PanelHeader ch={ch} />
      <div>
        <label className="label">Tiêu đề * <span className="font-normal text-slate-400">({title.length}/100)</span></label>
        <input className="input" maxLength={100} value={title} onChange={(e) => patch({ title: e.target.value })} placeholder="Tiêu đề video" />
      </div>
      <div>
        <label className="label">Mô tả (để trống = dùng nội dung chung)</label>
        <textarea className="input min-h-20" value={s.description ?? ''} placeholder={caption} onChange={(e) => patch({ description: e.target.value || undefined })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Chế độ hiển thị</label>
          <select className="input" value={s.privacy} onChange={(e) => patch({ privacy: e.target.value })}>
            <option value="public">Công khai</option>
            <option value="unlisted">Không công khai (ai có link mới xem)</option>
            <option value="private">Riêng tư</option>
          </select>
        </div>
        <div>
          <label className="label">Thẻ (tags), cách nhau dấu phẩy</label>
          <input className="input" value={s.tags || ''} onChange={(e) => patch({ tags: e.target.value })} placeholder="review, mẹo vặt, shorts" />
        </div>
      </div>
      <div>
        <div className="label">Video có dành cho trẻ em không? * (YouTube bắt buộc khai báo)</div>
        <div className="flex gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={s.madeForKids === true} onChange={() => patch({ madeForKids: true })} /> Có, dành cho trẻ em</label>
          <label className="flex items-center gap-2"><input type="radio" checked={s.madeForKids === false} onChange={() => patch({ madeForKids: false })} /> Không</label>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.notifySubscribers !== false} onChange={(e) => patch({ notifySubscribers: e.target.checked })} />
        Thông báo cho người đăng ký kênh
      </label>
      <p className="text-xs text-slate-500">Video dọc ≤ 3 phút sẽ tự thành YouTube Shorts. Mặc định mỗi project Google được tải tối đa 100 video/ngày qua API.</p>
    </section>
  );
}
