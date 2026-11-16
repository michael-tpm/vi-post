import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const ALLOWED_VIDEO: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

/** Đọc thời lượng + kích thước khung hình bằng ffprobe (nếu máy có cài) */
export async function probeVideo(file: string): Promise<{ duration?: number; width?: number; height?: number }> {
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      file,
    ]);
    const j = JSON.parse(stdout);
    return {
      duration: j?.format?.duration ? Number(j.format.duration) : undefined,
      width: j?.streams?.[0]?.width,
      height: j?.streams?.[0]?.height,
    };
  } catch {
    return {};
  }
}
