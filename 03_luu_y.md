# 03 — Các lưu ý khi làm ViPost

> Xếp theo mức độ: 🔴 có thể làm hỏng cả dự án · 🟠 tốn nhiều thời gian/tiền nếu bỏ qua · 🟡 nên làm để khác biệt.
> Các mục pháp lý chỉ là định hướng — **cần luật sư/kế toán xác nhận** trước khi bán.

---

## 🔴 1. Giấy phép AGPL-3.0 của Postiz
- AGPL bắt buộc: nếu bạn **sửa code Postiz và cho người khác dùng qua mạng (SaaS)**, phải công khai toàn bộ mã nguồn đã sửa cho người dùng, theo cùng giấy phép AGPL.
- Copy từng đoạn code (kể cả "sửa nhẹ") vào ViPost = ViPost cũng thành AGPL.
- Cách an toàn: **viết lại sạch (clean-room)** — đọc để hiểu cách làm, đóng file lại, tự viết. Không copy-paste, không để AI "chuyển thể" từng file Postiz.
- Tên "Postiz", logo, giao diện đặc trưng là thương hiệu của họ — không dùng.
- Được phép: tự host Postiz nguyên bản để **dùng nội bộ**.

## 🔴 2. Phụ thuộc vào xét duyệt của nền tảng (rủi ro lớn nhất)
Sản phẩm chỉ sống được khi Meta / TikTok / Zalo / Google **duyệt app**. Nộp sớm, nộp song song.
- **Meta (Facebook/Instagram/Threads):** cần *Business Verification* (giấy phép kinh doanh, tên miền xác thực, hoá đơn/điện nước trùng tên công ty) + *App Review* cho từng quyền (`pages_manage_posts`, `pages_read_engagement`, `instagram_content_publish`…) kèm **video quay màn hình** minh hoạ từng quyền. Thường bị từ chối 1–3 lần.
- **TikTok:** app chưa qua *audit* chỉ đăng được bài **riêng tư (SELF_ONLY)**, tài khoản TikTok phải để riêng tư, và tối đa **5 người dùng/24 giờ** → không bán được. Kể cả đã duyệt, mỗi tài khoản chỉ đăng qua API được khoảng 15 bài/ngày. Access token TikTok sống 2 giờ, refresh token 180 ngày và **đổi mới sau mỗi lần làm mới** (phải lưu lại token mới). Audit yêu cầu tuân thủ UX guidelines của họ (hiện avatar, chọn quyền riêng tư, tắt/bật duet/stitch, nhãn nội dung thương mại…).
- **Zalo OA:** cần OA đã xác thực; API có giới hạn và **một số tính năng tính phí** (gửi tin broadcast, ZNS). Access token Zalo hết hạn nhanh → phải có cron làm mới token chắc chắn.
- **YouTube:** mặc định mỗi project chỉ được **100 lần tải video/ngày** (nhóm quota riêng của `videos.insert`, reset 0h giờ Thái Bình Dương ≈ 14–15h giờ VN) → bán cho nhiều khách thì phải xin tăng quota sớm. App OAuth chưa xác minh sẽ hiện cảnh báo "Google chưa xác minh" và để ở trạng thái *Testing* thì refresh token chỉ sống 7 ngày. (Cập nhật 16/11/2026 theo tài liệu Google: video tải từ project chưa xác minh **không** còn bị khoá ở chế độ riêng tư.)
- Chính sách thay đổi liên tục → mỗi provider phải tách riêng, có test, có người theo dõi changelog API.

## 🔴 3. Đừng làm "tool" đăng Group / trang cá nhân bằng cookie
- Thị trường VN rất chuộng "đăng hàng loạt vào group, tường cá nhân". **Meta đã khoá API đăng Group (4/2024)** và không cho đăng trang cá nhân qua API từ 2018.
- Làm bằng cách giả lập trình duyệt / lưu cookie khách: vi phạm điều khoản Meta → **khách bị khoá nick**, app bị khoá, và bạn đang giữ cookie đăng nhập của khách (rủi ro bảo mật + pháp lý cực lớn).
- Nếu khách đòi: định vị rõ "ViPost chỉ dùng API chính thức — an toàn cho tài khoản" → biến điểm yếu thành điểm bán.

## 🔴 4. Bảo mật token
- Mỗi token = quyền đăng bài lên fanpage của khách. Lộ DB = lộ hàng trăm fanpage.
- Mã hoá token (AES-GCM), khoá để ngoài DB (KMS hoặc biến môi trường riêng); **không bao giờ** trả token ra API/frontend/log.
- Phân quyền chặt: thành viên agency chỉ thấy kênh của workspace được giao.
- Ghi audit log: ai kết nối/xoá kênh, ai đăng/xoá bài.
- Bật 2FA cho tài khoản quản trị; sao lưu DB hằng ngày, thử khôi phục định kỳ.

## 🟠 5. Pháp lý Việt Nam
- **Bảo vệ dữ liệu cá nhân:** Nghị định 13/2023/NĐ-CP và **Luật Bảo vệ dữ liệu cá nhân 2025 (hiệu lực 1/1/2026)** — cần chính sách quyền riêng tư tiếng Việt, xin đồng ý rõ ràng, cho phép xoá dữ liệu, đánh giá tác động xử lý dữ liệu, thông báo khi rò rỉ. Nếu chuyển dữ liệu ra server nước ngoài (Singapore, Mỹ, API AI) → có thể cần hồ sơ đánh giá chuyển dữ liệu ra nước ngoài.
- **An ninh mạng:** Luật An ninh mạng 2018 + Nghị định 53/2022 (một số trường hợp phải lưu dữ liệu tại VN) — hỏi luật sư ViPost có thuộc diện không; an toàn nhất là đặt DB tại VN hoặc có phương án di chuyển.
- **Hoá đơn điện tử:** bán SaaS cho doanh nghiệp VN phải xuất HĐĐT (Nghị định 123/2020, sửa đổi bởi Nghị định 70/2025) → tích hợp nhà cung cấp HĐĐT; giá niêm yết ghi rõ đã/chưa VAT.
- **Pháp nhân:** cần công ty (không chỉ cá nhân) để xác minh với Meta/TikTok, mở cổng VNPay/MoMo, xuất hoá đơn.
- **Thương hiệu:** tra cứu "ViPost" trên cơ sở dữ liệu nhãn hiệu của Cục Sở hữu trí tuệ + tên miền + trùng tên app trước khi in ấn/marketing.
- **Nội dung khách đăng:** điều khoản sử dụng phải nêu khách chịu trách nhiệm nội dung (quảng cáo thuốc, TPCN, mỹ phẩm, tài chính… có quy định riêng; Luật Quảng cáo sửa đổi có nghĩa vụ ghi nhãn quảng cáo với người có ảnh hưởng). ViPost có thể cảnh báo, không thay khách xin phép.

## 🟠 6. Thanh toán kiểu Việt
- Khách VN quen **chuyển khoản / quét VietQR**, ít thẻ quốc tế → dùng SePay/Casso (tự nhận biến động số dư qua webhook) + VNPay/MoMo/ZaloPay.
- Mỗi đơn có **mã nội dung chuyển khoản riêng** để đối soát tự động; xử lý chuyển thiếu/thừa/sai nội dung.
- Webhook thanh toán **không được ném lỗi giữa chừng**, phải idempotent (nhận trùng 2 lần không cộng 2 lần) — đây cũng là bài học Postiz ghi rõ trong CLAUDE.md của họ.
- Không có "tự động gia hạn thẻ" → nhắc gia hạn trước 7 ngày / 3 ngày / 1 ngày qua email + Zalo; cho gia hạn thời gian ân hạn.

## 🟠 7. Tiếng Việt trong code
- **Unicode NFC vs NFD:** chữ copy từ macOS/một số app ra dạng tổ hợp (NFD) → đếm ký tự sai, tìm kiếm không ra, hashtag lỗi. Luôn `normalize('NFC')` khi lưu.
- Đếm ký tự theo quy tắc từng nền tảng (X đếm emoji/URL khác), không dùng `string.length` thô.
- Tìm kiếm không dấu ("ao thun" ra "áo thun") → `unaccent` trong Postgres hoặc cột không dấu.
- Hashtag tiếng Việt: gợi ý cả bản có dấu và không dấu (#aothun phổ biến hơn #áothun).
- Font hỗ trợ đủ dấu (Be Vietnam Pro, Inter…) cho UI và ảnh tạo bằng AI.
- Ngày `dd/mm/yyyy`, giờ 24h, tiền `1.250.000 ₫` (dấu chấm nghìn, không số lẻ).
- Lưu thời gian **UTC** trong DB, hiển thị `Asia/Ho_Chi_Minh`; xử lý khách ở nước ngoài.

## 🟠 8. Đăng hàng loạt nhiều fanpage — tránh bị coi là spam
- Đăng y hệt 1 nội dung lên 20 page cùng 1 phút dễ bị Meta giảm reach hoặc gắn cờ.
- Giải pháp: **giãn cách ngẫu nhiên** (vd 3–15 phút/page), AI viết biến thể caption cho từng page, xoay ảnh bìa.
- Tôn trọng rate limit từng nền tảng; hàng đợi theo từng kênh, không để 1 kênh lỗi chặn cả nhóm.

## 🟠 9. Video
- Video là phần tốn tiền nhất: lưu trữ, băng thông, chuyển mã (ffmpeg).
- Kiểm tra trước khi đăng: tỉ lệ 9:16, thời lượng, dung lượng, codec theo từng nền tảng → báo lỗi ngay lúc soạn, đừng để đến giờ đăng mới lỗi.
- Tự xoá file media cũ (vd sau 30–90 ngày kể từ khi đăng) theo gói cước; ghi rõ trong điều khoản.
- Nhiều nền tảng tải video từ URL công khai của bạn → URL phải truy cập được từ nước ngoài, có HTTPS, không chặn bot.

## 🟡 10. Trải nghiệm người dùng Việt
- Mặc định tiếng Việt, câu chữ thân thiện, **thông báo lỗi dễ hiểu** + hướng dẫn sửa ("Fanpage X mất kết nối vì bạn đổi mật khẩu Facebook → bấm Kết nối lại").
- Không bao giờ hiện lỗi kỹ thuật thô cho khách (stack trace, mã lỗi API).
- **Ưu tiên mobile**: rất nhiều chủ shop thao tác trên điện thoại.
- Hỗ trợ qua **Zalo** (nhóm/OA), video hướng dẫn ngắn, gọi điện onboarding cho khách trả tiền đầu tiên.
- Lịch có sẵn ngày lễ âm lịch + mùa sale; gợi ý giờ vàng (trưa 11–13h, tối 19–22h — nên tính lại theo dữ liệu từng page).
- Cho khách mời thêm người, phân quyền đơn giản (Chủ / Quản lý / Biên tập / Khách duyệt).

## 🟡 11. AI
- Chi phí token tăng theo người dùng → giới hạn lượt AI theo gói, cache kết quả, dùng model rẻ cho tác vụ đơn giản.
- Prompt riêng cho văn phong Việt (bán hàng, thân thiện, teen, sang trọng…), cho phép khách lưu "giọng thương hiệu".
- Ảnh AI: xoá logo/watermark & metadata trước khi đăng là vùng xám về điều khoản nhà cung cấp và quy định ghi nhãn nội dung AI (TikTok/Meta yêu cầu gắn nhãn "AI-generated") → cho tuỳ chọn gắn nhãn AI theo nền tảng.
- Không gửi dữ liệu nhạy cảm của khách sang API AI nếu không có đồng ý (liên quan Luật BVDLCN).

## 🟡 12. Kỹ thuật & vận hành
- **Bắt đầu đơn giản**: Postgres + Redis + BullMQ; chỉ thêm Temporal/microservice khi thật sự cần.
- Mỗi provider có test giả lập (mock API) + 1 tài khoản test thật; chạy kiểm tra định kỳ (canary) đăng bài vào page test mỗi ngày để phát hiện API đổi.
- Theo dõi lỗi (Sentry), cảnh báo khi tỉ lệ đăng lỗi > X% qua Telegram.
- Học từ Postiz: trạng thái `pending` cho video, chống đăng trùng khi retry, làm mới token chủ động trước khi hết hạn, đánh dấu kênh "cần kết nối lại" thay vì im lặng thất bại.
- Đăng nhầm giờ / đăng trùng là lỗi khách không tha thứ → ưu tiên độ tin cậy hơn tính năng mới.

## 🟡 13. Kinh doanh
- Khách VN nhạy giá và đã có Meta Business Suite miễn phí → phải chứng minh tiết kiệm thời gian rõ ràng (nhiều page, đa nền tảng, Zalo, AI tiếng Việt, duyệt bài agency).
- Có gói miễn phí/dùng thử để vào phễu; bán gói năm để có dòng tiền.
- Kênh bán: chương trình cộng tác viên/affiliate, hợp tác khoá học bán hàng online, cộng đồng chủ shop, agency làm đại lý.
- Dùng chính ViPost để chạy marketing của ViPost (dogfooding).
