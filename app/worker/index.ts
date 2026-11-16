import './env';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { processDuePosts, processPendingPosts, recoverInterrupted } from '../src/lib/publisher';

const TICK_MS = 5_000;
let stopping = false;

/** Chỉ cho chạy 1 worker: 2 worker cùng lúc sẽ coi upload của nhau là "bị gián đoạn" và làm hỏng bài */
function acquireLock() {
  const lock = path.resolve('.worker.lock');
  try {
    const pid = Number(readFileSync(lock, 'utf8'));
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0); // tiến trình còn sống?
        console.error(`⛔ Đã có worker khác đang chạy (pid ${pid}). Tắt nó trước, hoặc xoá file .worker.lock nếu chắc chắn không còn.`);
        process.exit(1);
      } catch {
        // pid cũ đã chết → chiếm khoá
      }
    }
  } catch {}
  writeFileSync(lock, String(process.pid));
  process.on('exit', () => {
    try {
      if (readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock);
    } catch {}
  });
}

async function main() {
  acquireLock();
  if (!process.env.APP_PASSWORD) console.warn('⚠ Chưa đặt APP_PASSWORD — đừng mở tunnel ra internet khi chưa có mật khẩu.');
  // WAL: cho web và worker cùng đọc/ghi SQLite mà ít bị khoá
  await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL;');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout=5000;');
  await recoverInterrupted(true);
  console.log(`🚀 Worker ViPost đang chạy — kiểm tra bài mỗi ${TICK_MS / 1000}s. Đừng tắt cửa sổ này nếu có bài hẹn giờ.`);

  while (!stopping) {
    try {
      await recoverInterrupted(false);
      await processDuePosts();
      await processPendingPosts();
    } catch (err) {
      console.error('Lỗi vòng lặp worker:', err);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
  await prisma.$disconnect();
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1);
    setTimeout(() => process.exit(0), 15_000).unref(); // đợi tối đa 15s cho vòng hiện tại
    stopping = true;
    console.log('Đang dừng worker (bấm lần nữa để thoát ngay)…');
  });
}

main();
