// Next.js tự đọc .env, còn worker chạy bằng tsx thì phải tự nạp (phải import file này ĐẦU TIÊN)
try {
  process.loadEnvFile('.env');
} catch {
  console.warn('Không thấy file .env — dùng biến môi trường hiện có.');
}
