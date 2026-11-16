# ViPost local — Lên lịch video TikTok & YouTube

App chạy trên máy của bạn: tải video lên, soạn nội dung, hẹn giờ, rồi tự đăng lên **TikTok (video)** và **YouTube (video/Shorts)**.
Viết lại từ đầu, học cách làm của Postiz (không copy code, vì Postiz dùng giấy phép AGPL).

## Chạy thử trong 3 phút (chưa cần khoá TikTok/YouTube)

Cần **Node 22 trở lên**. Nên có **ffmpeg** để đọc thời lượng video (`brew install ffmpeg`).

```bash
cd app
```
```bash
npm install
```
```bash
cp .env.example .env
```
Mở `.env`, điền `ENCRYPTION_KEY` bằng kết quả lệnh dưới đây và đổi `APP_PASSWORD`:
```bash
openssl rand -hex 32
```
```bash
npx prisma db push
```
```bash
npm run start:all
```
Mở http://localhost:3000. Đăng nhập bằng tên bất kỳ và mật khẩu `APP_PASSWORD`.
Bấm **Kết nối Demo**, rồi **Soạn bài mới** để thử toàn bộ luồng. Viết `#loi` trong nội dung để xem một bài bị lỗi trông thế nào.

> `npm run start:all` chạy 2 phần cùng lúc: **web** (giao diện) và **worker** (tự đăng bài đúng giờ).
> Bài hẹn giờ chỉ được đăng khi máy đang bật và cửa sổ này đang chạy.

---

## Lấy khoá YouTube

1. Vào https://console.cloud.google.com, tạo **Project** mới.
2. Mục **APIs & Services → Library**: bật **YouTube Data API v3**.
3. Mục **OAuth consent screen** (Google Auth Platform):
   - Kiểu **External**, điền tên app và email.
   - **Scopes**: thêm `youtube.upload` và `youtube.readonly`.
   - **Test users**: thêm Gmail sở hữu kênh YouTube.
   - ⚠️ Nếu để trạng thái **Testing**, quyền chỉ sống **7 ngày** (tuần nào cũng phải kết nối lại). Bấm **Publish app → In production** để hết bị như vậy. Khi chưa xác minh, Google sẽ hiện cảnh báo "Google chưa xác minh ứng dụng này": bấm *Nâng cao → Tiếp tục*. Dùng cá nhân thì không sao.
4. Mục **Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:3000/api/auth/youtube/callback`
5. Chép **Client ID** và **Client secret** vào `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), rồi khởi động lại app.

**Hai giới hạn quan trọng:**
- **Quota**: mặc định mỗi project được **100 lần tải video/ngày** (nhóm quota riêng của `videos.insert`), reset lúc 0h giờ Thái Bình Dương (≈14–15h giờ VN). Muốn nhiều hơn thì xin tăng trong trang Quotas của Google Cloud.
- **Quyền riêng tư**: theo tài liệu Google (kiểm tra ngày 16/11/2026), video tải từ project chưa xác minh **không còn** bị khoá ở chế độ riêng tư. Một số kênh vẫn có thể mặc định để riêng tư theo cài đặt của kênh, khi đó ViPost sẽ hiện cảnh báo.

## Lấy khoá TikTok

1. Vào https://developers.tiktok.com → **Manage apps → Connect an app**.
2. Điền thông tin app (icon, mô tả, link điều khoản và chính sách quyền riêng tư; trang tạm cũng được).
3. **Add products**: thêm **Login Kit** và **Content Posting API**. Trong Content Posting API, bật **Direct Post**.
4. **Scopes**: tick `user.info.basic`, `video.upload`, `video.publish`.
5. **Redirect URI**: TikTok **bắt buộc https và không nhận localhost**. Chọn 1 trong 2 cách:
   - **Cách A (khuyên dùng):** host file [`tiktok-redirect/index.html`](tiktok-redirect/index.html) trên GitHub Pages hoặc Cloudflare Pages, ví dụ `https://<ten-ban>.github.io/vipost-tiktok/`. Khai báo đúng địa chỉ đó trong TikTok và trong `TIKTOK_REDIRECT_URI`. Trang này chỉ chuyển `code` về `http://localhost:3000` (đổi biến `TARGET` trong file nếu bạn chạy app ở cổng/địa chỉ khác).
   - **Cách B:** dùng tunnel (`cloudflared tunnel --url http://localhost:3000`) rồi khai báo `https://xxx.trycloudflare.com/api/auth/tiktok/callback`. Nhược điểm: địa chỉ đổi mỗi lần chạy. Khi mở tunnel, **bắt buộc đặt `APP_PASSWORD`**.
6. Tab **Sandbox**: thêm tài khoản TikTok của bạn vào *Target users* để thử khi app chưa được duyệt.
7. Chép **Client key** và **Client secret** vào `.env` (`TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`), rồi khởi động lại app.

**Giới hạn khi app chưa qua kiểm duyệt (audit) của TikTok:**
- *Đăng thẳng* chỉ đăng được khi **tài khoản TikTok để chế độ riêng tư** và bài để "Chỉ mình tôi"; tối đa **5 người dùng/24 giờ**.
- Kể cả đã duyệt: mỗi tài khoản đăng qua API được khoảng **15 bài/ngày**; video tối đa 10 phút, 4GB, 23–60 fps.
- Ở chế độ hộp nháp, TikTok **không nhận caption** từ app — bạn dán caption khi bấm đăng trên điện thoại.
- Token TikTok: access token sống 2 giờ, refresh token 180 ngày và đổi mới mỗi lần làm mới (ViPost tự lưu).
- Muốn bài **công khai** khi chưa được duyệt: chọn **"Đẩy vào hộp nháp"**. Video vào mục Hộp thư của app TikTok, bạn mở điện thoại và bấm đăng (tối đa 5 video chờ trong 24 giờ).
- Giao diện soạn bài đã làm theo **hướng dẫn UX của TikTok**, là điều kiện để được duyệt:
  - hiện tài khoản nhận bài;
  - quyền riêng tư không chọn sẵn, chỉ hiện các lựa chọn TikTok cho phép;
  - bình luận/duet/stitch mặc định tắt và mờ đi nếu tài khoản đã tắt;
  - phần tiết lộ nội dung thương mại;
  - dòng đồng ý chính sách âm nhạc;
  - kiểm tra thời lượng tối đa.
  
  Khi nộp audit cần quay video màn hình toàn bộ luồng này.

---

## Cấu trúc code

```
app/
├─ prisma/schema.prisma        Channel, Media, Post (+ OAuthState) — SQLite
├─ src/lib/providers/
│  ├─ types.ts                 Giao diện chung mỗi nền tảng phải có (học từ Postiz)
│  ├─ tiktok.ts                OAuth, creator_info, FILE_UPLOAD chia khúc, theo dõi trạng thái
│  ├─ youtube.ts               OAuth, resumable upload (đứt mạng thì tải tiếp)
│  └─ demo.ts                  Kênh giả lập để thử
├─ src/lib/publisher.ts        Vòng đời bài: QUEUE → PUBLISHING → PENDING → PUBLISHED / ERROR
├─ src/lib/channels.ts         Lưu token (mã hoá AES-GCM), tự làm mới token
├─ worker/index.ts             Vòng lặp 5 giây: đăng bài đến giờ, hỏi trạng thái, cứu bài bị gián đoạn
├─ src/app/                    Giao diện (Next.js) + API
└─ tests/                      npm test
```

**Những điểm học từ Postiz và đã áp dụng:**
- Mỗi nền tảng là một provider riêng. Code chung không có `if (tiktok)`.
- Lưu `publish_id` / phiên upload **ngay khi có**: app tắt giữa chừng thì không đăng trùng; YouTube tải tiếp từ byte đang dở.
- Phân loại lỗi: *làm mới token* / *kết nối lại* / *thử lại sau* / *lỗi nội dung*, kèm thông báo tiếng Việt dễ hiểu.
- TikTok trả mã video dạng số 64-bit: đọc từ chuỗi gốc để không bị làm tròn sai.
- Trước khi đăng TikTok luôn gọi lại `creator_info` để kiểm tra quyền riêng tư và thời lượng.

## Lệnh hữu ích

| Lệnh | Việc |
|---|---|
| `npm run start:all` | Chạy web + worker |
| `npm run dev` / `npm run worker` | Chạy riêng từng phần |
| `npm test` | Chạy test |
| `npm run typecheck` | Kiểm tra kiểu TypeScript |
| `npx prisma studio` | Xem/sửa dữ liệu trong trình duyệt |

## Bảo mật
- **Không gửi file `.env` cho ai**, không đưa lên Git (đã có trong `.gitignore`).
- Token TikTok/YouTube được mã hoá bằng `ENCRYPTION_KEY`. Mất khoá này thì phải kết nối lại các kênh.
- Đặt `APP_PASSWORD`, nhất là khi mở tunnel ra internet.

## Chưa có (làm sau)
Lịch dạng tháng/tuần · thống kê lượt xem · nhiều người dùng/phân quyền · tự xoá video cũ · TikTok dạng ảnh (cần tên miền đã xác minh) · ảnh bìa YouTube tuỳ chỉnh · AI viết caption tiếng Việt · đưa lên server.
