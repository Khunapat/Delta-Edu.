// Media from LINE, ready for the AI.
//   images: LINE sends JPEG; passed as is.
//   voice notes: LINE sends m4a (AAC in MP4), which Gemini does not list as supported,
//   so we convert to Ogg/Opus mono 16 kHz with ffmpeg (installed in the Docker image).
//   Without ffmpeg the original is sent as audio/mp4 and may be refused.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

/**
 * Run ffmpeg on `buf`, output on stdout. Resolves null if ffmpeg is missing or fails.
 * The input goes through a temp file: m4a files keep their index at the end, which
 * ffmpeg cannot read from a pipe.
 */
export async function transcode(buf, args, { timeoutMs = 60_000, bin = 'ffmpeg' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'norse-'));
  const input = join(dir, 'in');
  try {
    await writeFile(input, buf);
    return await new Promise((resolve) => {
      let p;
      try { p = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-i', input, ...args, 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return resolve(null); }
      const out = [];
      const timer = setTimeout(() => { p.kill('SIGKILL'); resolve(null); }, timeoutMs);
      p.on('error', () => { clearTimeout(timer); resolve(null); });
      p.stdout.on('data', (c) => out.push(c));
      p.on('close', (code) => { clearTimeout(timer); resolve(code === 0 && out.length ? Buffer.concat(out) : null); });
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** { mimeType, data(base64) } for the AI, from a LINE message's content. */
export async function forAi(kind, buf, opts = {}) {
  if (kind === 'image') return { mimeType: 'image/jpeg', data: buf.toString('base64') };
  if (kind === 'audio') {
    const ogg = await transcode(buf, ['-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', '-f', 'ogg'], opts);
    return ogg ? { mimeType: 'audio/ogg', data: ogg.toString('base64') } : { mimeType: 'audio/mp4', data: buf.toString('base64') };
  }
  throw new Error(`unsupported media: ${kind}`);
}
