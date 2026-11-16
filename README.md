# ViPost — App lên lịch & đăng bài đa kênh cho thị trường Việt Nam

Làm lại từ ý tưởng của [Postiz](https://github.com/gitroomhq/postiz-app) (mã nguồn mở, AGPL-3.0), tinh gọn và bản địa hoá cho người Việt.

| File | Nội dung |
|---|---|
| [01_phan_tich_postiz.md](01_phan_tich_postiz.md) | Postiz làm gì, kiến trúc, tính năng, kênh nào hợp VN, fork hay viết lại |
| [02_plan_lam_lai.md](02_plan_lam_lai.md) | Định vị, kiến trúc mới, mô hình dữ liệu, lộ trình 0→3, gói cước |
| [03_luu_y.md](03_luu_y.md) | Các lưu ý: giấy phép, duyệt app nền tảng, pháp lý VN, thanh toán, tiếng Việt, bảo mật |
| [04_review_ket_qua.md](04_review_ket_qua.md) | Kết quả review 16/11/2026: sai lệch so với tài liệu TikTok/Google, bug đã sửa, việc còn lại |
| [app/](app/README.md) | **Bản chạy local đầu tiên: TikTok video + YouTube** (Next.js + SQLite + worker) — xem README trong đó |

## Tóm tắt quyết định
- **Viết lại sạch (clean-room)**, không fork — tránh ràng buộc AGPL khi bán SaaS.
- Kênh ưu tiên: **Facebook Page, TikTok, Zalo OA, YouTube** → sau đó Instagram, Threads, Google Business.
- Stack nhẹ: Next.js + NestJS + Postgres + Redis/BullMQ + R2 (bỏ Temporal, Mastra, Stripe).
- Thanh toán: VietQR (SePay/Casso), VNPay/MoMo; có hoá đơn điện tử.
- Việc cần làm ngay: phỏng vấn khách, lập pháp nhân, **nộp xét duyệt app Meta/TikTok/Zalo sớm**.
