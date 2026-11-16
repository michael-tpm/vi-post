# 02 — Kế hoạch làm lại: ViPost

> Công cụ lên lịch & đăng bài đa kênh **cho người Việt**: chủ shop online, KOC/KOL, agency nhỏ, doanh nghiệp SME.
> Nguyên tắc: **ít kênh nhưng làm thật tốt** — Facebook Page, TikTok, Zalo OA, YouTube trước.

---

## 1. Định vị sản phẩm

**Câu chào hàng:** *"Soạn 1 lần, đăng 20 fanpage + TikTok + Zalo đúng giờ vàng — tiếng Việt, thanh toán chuyển khoản, AI viết bài giọng Việt."*

| Khách hàng | Nỗi đau | ViPost giải quyết |
|---|---|---|
| Chủ shop online | Quản lý nhiều fanpage, đăng tay mất thời gian | Đăng hàng loạt nhiều page, lịch giờ vàng |
| KOC / creator | Đăng cùng video lên TikTok, Reels, Shorts | 1 video → 3 nền tảng, caption riêng từng kênh |
| Agency nhỏ | Nhiều khách, cần khách duyệt bài | Không gian theo khách + link duyệt bài cho khách |
| SME / cửa hàng | Không có người làm content | AI viết bài tiếng Việt, mẫu theo ngành, lịch lễ Tết |

**Đối thủ cần khảo sát trước khi code** (bước 0): công cụ quản lý fanpage/inbox nội địa (Pancake, Botcake, Fchat, Ahachat…), công cụ đăng bài "tool" giá rẻ, và Buffer / Hootsuite / Meta Business Suite (miễn phí!). Câu hỏi then chốt: *vì sao khách không dùng Meta Business Suite miễn phí?* → câu trả lời chính là lý do tồn tại của ViPost (đa nền tảng, nhiều page cùng lúc, Zalo, AI tiếng Việt, duyệt bài cho agency).

---

## 2. Kiến trúc đề xuất (nhẹ hơn Postiz)

```
┌───────────── Web app (Next.js + Tailwind, tiếng Việt mặc định) ─────────────┐
│ Lịch | Soạn bài | Media | Kênh | Thống kê | Nhóm | Gói cước                  │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ REST
┌───────────────────────────────▼──────────────┐      ┌───────────────────────┐
│ API (NestJS hoặc Hono/Fastify)               │◄────►│ PostgreSQL (Prisma)   │
│  - Auth, Org, Team, Billing                  │      └───────────────────────┘
│  - Provider registry (FB, TikTok, Zalo, YT…) │      ┌───────────────────────┐
└───────────────────────────────┬──────────────┘◄────►│ Redis                 │
                                │ enqueue              └───────────────────────┘
┌───────────────────────────────▼──────────────┐      ┌───────────────────────┐
│ Worker (BullMQ)                              │◄────►│ Object storage (R2/S3)│
│  - publish-post (delay job theo publishDate) │      └───────────────────────┘
│  - poll-pending (video xử lý chậm)           │
│  - refresh-token (cron)                      │
│  - fetch-analytics (cron hằng ngày)          │
│  - media-transcode (ffmpeg)                  │
└──────────────────────────────────────────────┘
```

**Khác Postiz:**
- **BullMQ thay Temporal** cho MVP: đủ cho delay job + retry + cron, chỉ cần Redis. Khi > vài chục nghìn bài/ngày mới cân nhắc Temporal.
- **Bỏ** Mastra, CopilotKit, LangChain → gọi thẳng API LLM (Gemini / Claude / OpenAI) qua 1 lớp `AiService` mỏng.
- **Bỏ** Stripe → SePay/Casso (VietQR) + VNPay/MoMo.
- **Giữ ý tưởng** provider interface + vòng đời bài `QUEUE → PUBLISHING → PENDING → PUBLISHED | ERROR`.

**Lưu trữ/hosting:** server Singapore hoặc VN (VNG Cloud, Viettel IDC, FPT Cloud…) + Cloudflare R2 cho media. Xem mục pháp lý trong `03_luu_y.md` về lưu dữ liệu tại VN.

---

## 3. Mô hình dữ liệu tối thiểu

```
Organization ─┬─ Member (user, role: OWNER/ADMIN/EDITOR/VIEWER/CLIENT)
              ├─ Workspace/Client (agency: mỗi khách 1 workspace)
              ├─ Channel (provider, externalId, name, avatar,
              │           accessToken*, refreshToken*, expiresAt,
              │           postingSlots, status: ACTIVE/NEED_RECONNECT/DISABLED)
              ├─ Post (groupId, channelId, content, settingsJson, mediaIds,
              │        publishAt (UTC), state, externalId, externalUrl,
              │        error, approvalState, createdBy)
              ├─ Media (url, type, size, width, height, duration, thumb)
              ├─ Tag, Template, Signature
              ├─ Subscription / Invoice / Payment (VND, VAT)
              └─ AuditLog
* token mã hoá (AES-GCM, khoá ngoài DB)
```
Bài "nhóm" (`groupId`): 1 lần soạn → N bản ghi Post, mỗi kênh 1 bản → lỗi kênh này không kéo kênh khác.

---

## 4. Lộ trình

### Giai đoạn 0 — Kiểm chứng (2–3 tuần, chưa code nhiều)
- [ ] Phỏng vấn 10–15 khách tiềm năng (shop, KOC, agency) — họ đang đăng bằng gì, trả bao nhiêu.
- [ ] Bảng so sánh đối thủ + giá.
- [ ] **Đăng ký pháp nhân / hộ kinh doanh** (cần để xác minh doanh nghiệp với Meta, TikTok, Zalo, cổng thanh toán).
- [ ] Tạo app trên Meta for Developers, TikTok for Developers, Zalo for Developers, Google Cloud; **nộp xét duyệt sớm** (mất 2–8 tuần, hay bị từ chối lần đầu).
- [ ] Mua tên miền, trang landing + chính sách quyền riêng tư + điều khoản (bắt buộc cho app review).
- [ ] Trong lúc chờ: tự host Postiz bản gốc để **dùng nội bộ** và ghi lại những gì thấy thiếu/thừa.

### Giai đoạn 1 — MVP (8–10 tuần)
- [ ] Đăng nhập (email + Google), Organization, mời thành viên.
- [ ] Kết nối kênh: **Facebook Page** (nhiều page 1 lần), **TikTok**, **YouTube**, **Zalo OA**.
- [ ] Soạn bài đa kênh, tuỳ chỉnh từng kênh, preview, đếm ký tự, emoji, hashtag.
- [ ] Media: upload ảnh/video, kiểm tra định dạng/kích thước theo từng nền tảng trước khi đăng.
- [ ] Lịch tuần/tháng, kéo-thả, khung giờ vàng mặc định, múi giờ `Asia/Ho_Chi_Minh`.
- [ ] Worker đăng bài + retry + thông báo lỗi bằng tiếng Việt dễ hiểu + nút "kết nối lại".
- [ ] Bình luận đầu tiên (first comment) cho Facebook.
- [ ] Thanh toán: VietQR tự đối soát (SePay/Casso webhook), gói tháng/năm, dùng thử 14 ngày.
- [ ] Thông báo qua email + **Telegram/Zalo** khi bài lỗi.

### Giai đoạn 2 — Giữ chân & mở rộng (6–8 tuần)
- [ ] Instagram, Threads, Google Business Profile.
- [ ] **AI tiếng Việt**: viết caption theo giọng thương hiệu, viết lại cho từng kênh, gợi ý hashtag, tạo ảnh (Gemini).
- [ ] Mẫu bài theo ngành + **lịch sự kiện VN** (Tết âm lịch, rằm, 8/3, 20/10, 20/11, Black Friday, 9.9/10.10/11.11/12.12).
- [ ] Thống kê: reach, tương tác, giờ đăng hiệu quả nhất.
- [ ] Agency: workspace theo khách, **link duyệt bài** cho khách (không cần tài khoản), xuất báo cáo PDF.
- [ ] Hoá đơn điện tử (tích hợp nhà cung cấp HĐĐT).

### Giai đoạn 3 — Khác biệt (sau khi có khách trả tiền)
- [ ] Hộp thư bình luận gom nhiều page, trả lời nhanh, ẩn bình luận chứa SĐT (chống cướp khách).
- [ ] Autopost từ RSS / website / sản phẩm Shopee-TikTok Shop.
- [ ] 1 video dài → nhiều clip ngắn (AI cắt + phụ đề tiếng Việt).
- [ ] Public API, webhook, MCP cho Claude/ChatGPT.
- [ ] App mobile (hoặc PWA) — người Việt làm việc trên điện thoại rất nhiều.

---

## 5. Gói cước gợi ý (cần kiểm chứng ở giai đoạn 0)

| Gói | Giá/tháng | Kênh | Thành viên | AI |
|---|---|---|---|---|
| Miễn phí | 0đ | 3 | 1 | 20 lượt |
| Cá nhân | ~99.000đ | 10 | 1 | 300 lượt |
| Shop | ~249.000đ | 30 | 3 | 1.000 lượt |
| Agency | ~599.000đ+ | 100 | 10 | 3.000 lượt + duyệt bài |

Giảm ~20% khi trả năm. Giá đã gồm VAT hay chưa — phải ghi rõ.

---

## 6. Đội ngũ & chi phí ước lượng
- Tối thiểu: 1 fullstack + 1 người lo sản phẩm/marketing/CSKH (có thể là chủ dự án) + thiết kế thuê ngoài.
- Có Claude Code hỗ trợ: 1 dev có kinh nghiệm làm MVP giai đoạn 1 trong ~2–3 tháng là khả thi.
- Hạ tầng MVP: ~1–2 triệu đ/tháng (1 VPS 4–8GB + Postgres managed + R2) — chi phí lớn dần ở **lưu trữ video** và **token AI**.

---

## 7. Cấu trúc thư mục dự kiến khi bắt đầu code

```
1_vipost_app/
├─ docs/                  (các file phân tích này)
├─ apps/
│  ├─ web/                Next.js
│  ├─ api/                NestJS
│  └─ worker/             BullMQ workers
├─ packages/
│  ├─ db/                 Prisma schema + client
│  ├─ providers/          facebook, tiktok, zalo-oa, youtube, …
│  ├─ shared/             types, zod schemas, utils tiếng Việt
│  └─ ai/                 AiService (Gemini/Claude/OpenAI)
└─ infra/                 docker-compose, deploy
```
