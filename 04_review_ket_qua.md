# 04 — Kết quả review ViPost local (16/11/2026)

Phạm vi: app trong `app/` (TikTok video + YouTube).
Cách review:
- đối chiếu code với tài liệu chính thức của TikTok và Google (đọc lại ngày 16/11/2026);
- một bản review code độc lập, không xem trước kết luận của mình;
- chạy thử giao diện trên desktop và điện thoại (375px).

## Kết quả kiểm tra sau khi sửa
- 17/17 test đạt (trước khi sửa có 6 test).
- `tsc` sạch, `next build` thành công.
- Chạy thử trên trình duyệt với kênh Demo:
  - hẹn 19:30 ngày 17/11 được lưu đúng `12:30Z`;
  - "Đăng ngay" chạy đủ các bước Chờ đăng → Đang xử lý → Đã đăng.
- Kiểm tra bằng curl:
  - yêu cầu từ trang web lạ bị chặn (403);
  - file tải lên bị cụt bị từ chối (400) và không được lưu;
  - gỡ một kênh không tồn tại trả 404, không còn lỗi 500.
- Chạy worker thứ hai thì bị chặn lại.
- **Chưa thử với TikTok và YouTube thật** vì chưa có khoá API.

## Sai lệch so với tài liệu (đã sửa)
| # | Vấn đề | Sửa |
|---|---|---|
| D1 | **YouTube quota**: đã ghi "~1.600 đơn vị/video, ~6 video/ngày". Tài liệu mới: `videos.insert` có quota riêng, **100 lần/ngày**, mỗi lần 1 đơn vị | Sửa thông báo lỗi, giao diện, README, 03_luu_y |
| D2 | **YouTube khoá riêng tư**: đã ghi project chưa xác minh thì video bị khoá. Tài liệu mới: *"not restricted to private viewing mode"* | Sửa README, cảnh báo trong app |
| D3 | TikTok tính "MB" theo hệ thập phân (ví dụ `chunk_size` = 10.000.000), code đang dùng 1024² → file 64,0–67,1MB bị gửi 1 khúc quá giới hạn | Đổi sang 10⁶; thêm test theo đúng ví dụ trong tài liệu |
| D4 | Trạng thái FAILED với `fail_reason: internal` là lỗi thử lại được, code lại coi là lỗi chết | Tự đăng lại từ đầu (bài chắc chắn chưa lên) |
| D5 | Refresh token TikTok **đổi mới mỗi lần làm mới** (sống 180 ngày). Web và worker cùng làm mới thì bên chậm hơn bị từ chối, kênh bị báo "kết nối lại" oan | Bị từ chối thì đọc lại token mới bên kia vừa lưu |
| D6 | Hướng dẫn UX TikTok: phải khoá nút đăng khi thiếu lựa chọn bắt buộc; phải hiện nhãn "Nội dung quảng cáo" / "Hợp tác trả phí" | Thêm danh sách lỗi và khoá nút; hiện nhãn đúng theo lựa chọn |
| D7 | Chế độ hộp nháp TikTok không nhận caption, nhưng giao diện vẫn bắt nhập | Ẩn ô caption, ghi chú dán caption trong app TikTok |
| D8 | Google: lỗi 5xx phải chờ tăng dần (exponential backoff) rồi mới thử lại | Thêm backoff khi tải YouTube |

## Bug code (đã sửa)
| Mức | Bug | Hậu quả nếu không sửa |
|---|---|---|
| 🔴 | Máy chủ token TikTok/Google lỗi tạm thời (5xx, trả HTML) | Kênh bị đánh dấu "kết nối lại" vĩnh viễn, mọi bài sau đều lỗi |
| 🔴 | Khúc cuối gửi lên TikTok mất phản hồi, app xoá `publish_id` rồi tải lại | **Đăng trùng video** |
| 🔴 | Bấm "Thử lại" xoá `publish_id` / phiên upload | **Đăng trùng video**. Nay "Thử lại" hỏi nền tảng trước khi tải lại |
| 🔴 | Kênh mất kết nối khi bài đang được TikTok xử lý, bài bị chuyển sang "Lỗi" | Khách bấm Thử lại thì đăng trùng. Nay bài giữ ở "Đang xử lý" và tự theo dõi tiếp sau khi kết nối lại |
| 🟠 | Upload YouTube dài hơn ~1 giờ: token hết hạn lần thứ hai | Bài lỗi và kênh bị khoá. Nay tự làm mới token và tải tiếp |
| 🟠 | Lưu token mới vào DB bị lỗi | Kênh bị khoá oan. Nay ghi lại vài lần, không khoá kênh |
| 🟠 | Giờ hẹn hiểu theo múi giờ của máy, trang tổng quan lại hiện giờ VN | Máy đặt múi giờ khác thì đăng lệch giờ. Nay luôn hiểu là giờ Việt Nam |
| 🟠 | Bấm "Lên lịch" 2 lần khi trang đang chuyển | Lên lịch trùng 2 bài |
| 🟠 | Chọn video thứ hai khi video đầu chưa tải xong | Đăng nhầm video |
| 🟠 | Mật khẩu có dấu tiếng Việt | Không bao giờ đăng nhập được (giải mã sai UTF-8) |
| 🟠 | Không chặn yêu cầu từ trang web khác (CSRF) | Trang lạ có thể huỷ/đăng ngay bài thay bạn |
| 🟡 | Mất kết nối giữa chừng nhưng file tải lên vẫn được lưu | Lưu video cụt. Nay so với dung lượng khai báo và dừng ngay khi vượt 4GB |
| 🟡 | Chạy 2 worker cùng lúc | Hai worker giẫm upload của nhau. Nay có khoá `.worker.lock` |
| 🟡 | App sập lặp lại ở cùng 1 bài | Thử lại vô hạn. Nay dừng sau 3 lần |
| 🟡 | Gọi `creator_info` trùng | Tốn hạn mức 20 lần/phút của TikTok |
| 🟡 | Tải lại trang callback OAuth / gỡ kênh không tồn tại / gỡ kênh đúng lúc worker nhận bài | Lỗi 500 hoặc xoá bài đang tải |
| 🟡 | Server không lọc kênh trùng và `tags` sai kiểu | Đăng 2 lần trên cùng kênh; lỗi 500 |
| 🟡 | YouTube `rateLimitExceeded` bị coi là lỗi chết; `forbidden` lại khoá kênh | Nay thử lại; chỉ báo lỗi, không khoá kênh |

## Giao diện (đã sửa)
- Điện thoại 375px: thẻ kênh tràn ngang (trang rộng 521px), mất nút "Gỡ" và "Kết nối lại". Nay vừa khung, các nút xuống dòng.
- Thông báo kênh mất kết nối bị cắt cụt. Nay hiện thành ô đỏ riêng, đọc đủ.
- Ảnh đại diện TikTok là link chỉ sống khoảng 2 giờ, hết hạn thì ảnh vỡ. Nay tự đổi sang icon nền tảng.
- Trang soạn bài:
  - báo "Có N kênh cần kết nối lại" thay vì im lặng ẩn kênh;
  - liệt kê đủ các lỗi còn thiếu trước khi cho đăng.

## Còn lại / chưa làm
- Chưa thử với TikTok và YouTube thật, cần khoá API (xem `app/README.md`).
- Video đã tải lên nhưng không dùng đến chưa tự xoá, thư mục `uploads/` sẽ lớn dần.
- Trang chuyển hướng TikTok đang ghi cứng `http://localhost:3000`. Chạy app ở cổng khác thì sửa biến `TARGET` trong file.
