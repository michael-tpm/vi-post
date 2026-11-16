# 01 — Phân tích dự án Postiz (nguồn: `../postiz-app`)

> Khảo sát ngày 16/11/2026, phiên bản `v1.47.0`. Mục đích: hiểu Postiz làm gì, xây thế nào, để quyết định phần nào học theo, phần nào bỏ khi làm lại **ViPost** cho thị trường Việt Nam.

---

## 1. Postiz là gì

Công cụ **lên lịch & đăng bài đa nền tảng** (social media scheduler) mã nguồn mở, cạnh tranh với Buffer / Hootsuite.
Người dùng kết nối nhiều tài khoản mạng xã hội → soạn 1 bài → chỉnh riêng cho từng kênh → đặt lịch → hệ thống tự đăng đúng giờ → xem thống kê.

**Giấy phép: AGPL-3.0** ⚠️ (xem mục 6 và file `03_luu_y.md`).

---

## 2. Kiến trúc kỹ thuật

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| `apps/frontend` | React + Vite, Tailwind 3, SWR, Mantine, Tiptap (editor) | Giao diện: lịch, soạn bài, media, thống kê |
| `apps/backend` | NestJS 11 | REST API, xác thực, OAuth với các mạng xã hội |
| `apps/orchestrator` | NestJS + **Temporal** | Job nền: đăng bài đúng giờ, làm mới token, xử lý media, gửi email |
| `apps/extension` | Chrome extension | Đăng / lấy dữ liệu từ trình duyệt |
| `apps/sdk`, `apps/commands` | NodeJS SDK, CLI | Public API cho dev, n8n, Make.com |
| `libraries/nestjs-libraries` | Prisma 6 + PostgreSQL, Redis | Toàn bộ logic server dùng chung |
| `libraries/react-shared-libraries` | i18next | Dịch giao diện (đã có sẵn `vi`) |

- Quy mô: **~133.000 dòng TypeScript**, schema Prisma **1.846 dòng**, ~40 bảng nghiệp vụ + ~45 bảng của Mastra (AI agent).
- Hạ tầng tối thiểu khi chạy: Postgres + Redis + Temporal (+ Elasticsearch/DB của Temporal) + app. → **Nặng** cho một team nhỏ.
- Lưu media: local disk hoặc Cloudflare R2 (S3-compatible).
- Thanh toán: **Stripe** (không dùng được thuận tiện ở VN).
- AI: OpenAI, LangChain/LangGraph, Mastra, CopilotKit, Tavily (search), Deepgram (giọng nói).
- Giám sát: Sentry.

### Luồng đăng bài (phần lõi đáng học nhất)
```
Soạn bài (frontend) → API tạo Post (state = QUEUE, publishDate)
  → Temporal workflow chờ đến giờ
  → Activity gọi provider.post(...)  (Facebook/TikTok/…)
  → Nếu nền tảng xử lý chậm (video): trả "pending" → workflow poll checkPostStatus → finalizePost
  → Lưu releaseId / releaseURL, state = PUBLISHED hoặc ERROR (+ bảng Errors)
  → Token hết hạn → workflow refresh.token → thử lại
```

### Thiết kế "Provider" (rất đáng học)
File `libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts`:
mỗi mạng xã hội là 1 class implement chung interface:
- `generateAuthUrl`, `authenticate`, `refreshToken` — OAuth
- `post`, `postPending`, `comment` — đăng bài, đăng bình luận nối tiếp (thread)
- `checkValidity`, `maxLength`, `dto` — kiểm tra media/độ dài/cài đặt riêng từng kênh
- `analytics`, `postAnalytics` — thống kê
- `maxConcurrentJob`, `refreshCron` — giới hạn tốc độ

→ Code chung **không bao giờ** có `if (facebook)`; muốn thêm kênh mới (vd **Zalo OA**) chỉ cần viết thêm 1 provider.

---

## 3. Danh sách tính năng

### Lõi (nên có trong ViPost)
- **Lịch** (ngày/tuần/tháng), kéo-thả đổi giờ.
- **Soạn bài đa kênh**: 1 nội dung chung + tuỳ chỉnh riêng từng kênh, preview giống thật.
- **Khung giờ đăng mặc định** cho từng kênh (`postingTimes`), hàng đợi tự xếp giờ.
- **Thư viện media**, upload ảnh/video, xử lý chuyển định dạng.
- **Thread / bình luận đầu** (comment đầu tiên chứa link — mẹo phổ biến trên Facebook).
- **Nhãn (tags)**, chữ ký (signatures), bộ mẫu (sets).
- **Nhóm & phân quyền** (Organization, Role, CASL).
- **Khách hàng (Customer)**: gom kênh theo khách — hợp cho agency.
- **Thống kê** theo kênh và theo bài.
- **Webhooks, Public API**.

### Nâng cao / có thể làm sau
- **AI agent** soạn bài, gợi ý, tạo ảnh/video (Mastra + OpenAI).
- **Autopost từ RSS**.
- **Plugs**: tự động hành động (vd: bài đạt X like → tự repost / tự trả lời).
- **Rút gọn link** (Dub, Short.io, Kutt).
- **Polotno**: trình thiết kế ảnh kiểu Canva nhúng trong app (trả phí license).
- **Clipping / tạo video** (RunPod) — cắt video dài thành clip ngắn.
- **Chrome extension**, **MCP server** cho Claude/ChatGPT.

### Nên bỏ với thị trường VN
- Marketplace mua/bán bài đăng (`Orders`, `SocialMediaAgency`, `PayoutProblems`).
- Ví crypto Solana, Farcaster, Nostr, Moltbook.
- Kênh dev/niche: Dribbble, Dev.to, Hashnode, Lemmy, Mastodon, MeWe, Skool, Whop, Kick, Twitch, VK, Tumblr, Listmonk, Beehiiv, Medium.
- Streak, GitHub stars/trending (phần còn sót từ dự án tiền thân "Gitroom").

---

## 4. 37 kênh hiện có → mức độ phù hợp VN

| Mức | Kênh | Ghi chú |
|---|---|---|
| 🔴 Bắt buộc | **Facebook Page**, **TikTok** (cá nhân + Business), **YouTube** (Shorts) | Facebook là kênh số 1 ở VN; TikTok tăng rất nhanh |
| 🟠 Nên có | Instagram, Threads, Google Business Profile (`gmb`) | IG/Threads cho thời trang, F&B; GBP cho cửa hàng địa phương |
| 🟡 Tuỳ | LinkedIn, Telegram, Pinterest, X, WordPress | B2B, cộng đồng crypto, blog |
| ⚫ Bỏ | ~20 kênh còn lại | Gần như không ai dùng ở VN |
| ➕ **Thiếu — phải tự viết** | **Zalo OA**, (sau này) **Shopee Video / TikTok Shop**, Website/blog nội bộ | Zalo là đặc thù VN, Postiz không có |

Scopes Facebook hiện dùng: `pages_show_list, business_management, pages_manage_posts, pages_manage_engagement, pages_read_engagement, read_insights` → đều cần **Meta App Review + Business Verification**.

TikTok: có 2 chế độ `DIRECT_POST` (đăng thẳng) và `UPLOAD` (đẩy vào hộp thư nháp TikTok, giới hạn 5 bài chờ/24h). App **chưa qua audit** của TikTok chỉ đăng được ở chế độ riêng tư (`SELF_ONLY`).

---

## 5. Điểm mạnh / điểm yếu nếu dùng làm nền

**Mạnh**
- Lõi đăng bài đã "trả giá" qua production: retry, pending, refresh token, rate-limit, tránh đăng trùng.
- Provider pattern sạch, dễ thêm kênh.
- Đã có bản dịch tiếng Việt cho UI.
- Preview, editor, lịch làm tốt.

**Yếu (với 1 team nhỏ ở VN)**
- Quá nhiều thứ: Temporal + Mastra + CopilotKit + LangChain + Stripe + Polotno + Solana… → chi phí server, độ khó vận hành, khó debug.
- Workflow Temporal có quy tắc khắt khe (không được sửa workflow đã chạy, phải version hoá) → nặng cho người mới.
- Thanh toán chỉ Stripe; hoá đơn, thuế theo chuẩn quốc tế.
- Không có Zalo, không có quản lý Group/Inbox kiểu Việt.
- Thiết kế hướng creator phương Tây; người dùng VN (chủ shop, KOC, agency nhỏ) cần **đơn giản, nhiều fanpage, tiếng Việt, giá rẻ**.

---

## 6. Kết luận: fork hay viết lại?

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Fork Postiz, cắt bớt, thêm Zalo** | Nhanh có sản phẩm (4–6 tuần) | **AGPL**: chạy dạng SaaS phải công khai toàn bộ mã nguồn đã sửa cho người dùng; gánh toàn bộ độ phức tạp; khó đổi thương hiệu sạch |
| **B. Viết lại "clean-room", học kiến trúc** ✅ | Sở hữu mã nguồn, nhẹ, đúng nhu cầu VN | Lâu hơn (10–14 tuần cho MVP) |
| C. Fork để dùng nội bộ, không bán | Nhanh, AGPL không ràng buộc nếu chỉ tự dùng | Không thành sản phẩm kinh doanh |

**Đề xuất: B** — dùng Postiz làm "tài liệu tham khảo kiến trúc" (provider interface, vòng đời bài đăng, xử lý lỗi từng nền tảng), **không copy code**. Có thể chạy song song phương án C để tự dùng ngay trong lúc chờ ViPost.

Chi tiết kế hoạch: `02_plan_lam_lai.md`. Lưu ý: `03_luu_y.md`.
