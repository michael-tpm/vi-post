import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractPublicPostId, tiktokChunkPlan, tiktokChunkRange, validateTikTokSettings } from '../src/lib/providers/tiktok';
import { nextOffset, validateYouTube } from '../src/lib/providers/youtube';

const MB = 1_000_000; // TikTok tính MB theo hệ thập phân

test('TikTok: file nhỏ gửi 1 khúc', () => {
  assert.deepEqual(tiktokChunkPlan(3 * MB), { chunkSize: 3 * MB, totalChunkCount: 1 });
  assert.deepEqual(tiktokChunkPlan(64 * MB), { chunkSize: 64 * MB, totalChunkCount: 1 });
});

test('TikTok: file lớn chia 10MB, khúc cuối gánh phần dư', () => {
  const size = 105 * MB + 123;
  const plan = tiktokChunkPlan(size);
  assert.equal(plan.chunkSize, 10 * MB);
  assert.equal(plan.totalChunkCount, 10);
  const last = tiktokChunkRange(9, plan, size);
  assert.equal(last.start, 90 * MB);
  assert.equal(last.end, size - 1);
  // phủ kín file, không chồng/không hở
  let covered = 0;
  for (let i = 0; i < plan.totalChunkCount; i++) {
    const r = tiktokChunkRange(i, plan, size);
    assert.equal(r.start, covered);
    covered = r.end + 1;
  }
  assert.equal(covered, size);
});

test('TikTok: lấy post id int64 không bị làm tròn', () => {
  const raw = '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7412345678901234567]},"error":{"code":"ok"}}';
  assert.equal(extractPublicPostId(raw), '7412345678901234567');
  assert.notEqual(String(JSON.parse(raw).data.publicaly_available_post_id[0]), '7412345678901234567');
});

test('TikTok: bắt buộc tự chọn quyền riêng tư, branded content không được Chỉ mình tôi', () => {
  const info = { privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'] as any, max_video_post_duration_sec: 60 };
  assert.match(validateTikTokSettings({ mode: 'direct' }, info)!, /chọn ai được xem/);
  assert.equal(validateTikTokSettings({ mode: 'inbox' }, info), null);
  assert.match(validateTikTokSettings({ mode: 'direct', privacyLevel: 'SELF_ONLY', commercial: true, brandedContent: true }, info)!, /Chỉ mình tôi/);
  assert.match(validateTikTokSettings({ mode: 'direct', privacyLevel: 'PUBLIC_TO_EVERYONE' }, info, 90)!, /vượt giới hạn/);
  assert.equal(validateTikTokSettings({ mode: 'direct', privacyLevel: 'PUBLIC_TO_EVERYONE' }, info, 30), null);
});

test('YouTube: đọc header Range để tải tiếp', () => {
  assert.equal(nextOffset('bytes=0-8388607'), 8388608);
  assert.equal(nextOffset(null), 0);
});

test('YouTube: kiểm tra tiêu đề, mô tả, trẻ em', () => {
  const ok = { privacy: 'public' as const, madeForKids: false };
  assert.equal(validateYouTube('Tiêu đề', 'mô tả', ok), null);
  assert.match(validateYouTube('', '', ok)!, /tiêu đề/);
  assert.match(validateYouTube('a'.repeat(101), '', ok)!, /100/);
  assert.match(validateYouTube('a <b>', '', ok)!, /< hoặc >/);
  assert.match(validateYouTube('ok', '', { privacy: 'public', madeForKids: undefined as any })!, /trẻ em/);
});

test('TikTok: đúng ví dụ trong tài liệu (50.000.123 byte → 5 khúc, khúc cuối 10.000.123 byte)', () => {
  const size = 50_000_123;
  // ≤ 64MB được gửi 1 lần; ép chia khúc để so với ví dụ của TikTok
  const plan = { chunkSize: 10_000_000, totalChunkCount: Math.floor(size / 10_000_000) };
  assert.equal(plan.totalChunkCount, 5);
  const last = tiktokChunkRange(4, plan, size);
  assert.equal(last.end - last.start + 1, 10_000_123);
});

test('TikTok: file vừa quá 64MB (thập phân) phải chia khúc', () => {
  const plan = tiktokChunkPlan(64_000_001);
  assert.equal(plan.chunkSize, 10_000_000);
  assert.equal(plan.totalChunkCount, 6);
  assert.ok(plan.totalChunkCount <= 1000);
  // 4GB vẫn ≤ 1000 khúc
  assert.ok(tiktokChunkPlan(4_000_000_000).totalChunkCount <= 1000);
});
