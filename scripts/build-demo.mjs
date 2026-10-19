/** Build a silent, captioned visual walkthrough from the real dashboard captures. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "..");
const out = join(root, "website/assets/sprinty-demo.mp4");
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw new Error(`${command} is required: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout;
}
function check() {
  assert(existsSync(out), "Build the demo with: node scripts/build-demo.mjs");
  const info = JSON.parse(run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", out]));
  const video = info.streams.find(s => s.codec_type === "video");
  assert(video?.codec_name === "h264" && video.pix_fmt === "yuv420p", "Browser-compatible H.264 required");
  assert(video.width === 1920 && video.height === 1080, "Expected 1080p video");
  assert(Math.abs(Number(info.format.duration) - 45) < 0.1, "Expected 45-second demo");
  assert(Number(info.format.size) < 12 * 1024 * 1024, "Demo exceeds 12 MiB size budget");
  const captions = readFileSync(join(root, "website/assets/sprinty-demo.vtt"), "utf8");
  assert(captions.startsWith("WEBVTT") && captions.includes("00:45.000"), "Captions must cover the demo");
  console.log(`Demo verified: ${info.format.duration}s, 1920×1080 H.264, ${info.format.size} bytes; captions present.`);
}
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 1 && args[0] === "--check"), "Usage: node scripts/build-demo.mjs [--check]");
if (args[0] === "--check") { check(); } else {
  const working = mkdtempSync(join(tmpdir(), "sprinty-demo-"));
  try {
    const scenes = [["launch-overview.png", 5], ["launch-plan.png", 10], ["launch-agents.png", 10], ["launch-history.png", 10], ["launch-checks.png", 10]];
    for (const [i, [asset, seconds]] of scenes.entries()) {
      run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", join(root, "website/assets", asset),
        "-t", String(seconds), "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x10213e,setsar=1",
        "-r", "24", "-c:v", "libx264", "-preset", "fast", "-tune", "stillimage", "-crf", "22", "-pix_fmt", "yuv420p", "-color_range", "tv", "-an", "-video_track_timescale", "24000", join(working, `scene-${i}.mp4`)]);
    }
    writeFileSync(join(working, "scenes.txt"), scenes.map((_, i) => `file 'scene-${i}.mp4'`).join("\n"));
    run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-i", join(working, "scenes.txt"), "-c", "copy", "-movflags", "+faststart", out]);
    check();
  } finally { rmSync(working, { recursive: true, force: true }); }
}
