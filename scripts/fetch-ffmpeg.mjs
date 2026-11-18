// Downloads the FFmpeg binary that Tauri bundles as a sidecar for the current Rust host target.
// Usage: node scripts/fetch-ffmpeg.mjs
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const SOURCES = {
  "x86_64-pc-windows-msvc": {
    url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-win64-lgpl-8.1.zip",
    zipEntry: "ffmpeg-n8.1-latest-win64-lgpl-8.1/bin/ffmpeg.exe",
  },
  "aarch64-apple-darwin": {
    url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz",
  },
  "x86_64-apple-darwin": {
    url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-x64.gz",
  },
};

const target = process.env.TAURI_TARGET_TRIPLE ?? hostTriple();
const source = SOURCES[target];
if (!source) {
  console.error(`No FFmpeg source configured for target ${target}`);
  process.exit(1);
}

const binDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "binaries");
const ext = target.includes("windows") ? ".exe" : "";
const dest = join(binDir, `ffmpeg-${target}${ext}`);

if (existsSync(dest)) {
  console.log(`Already present: ${dest}`);
} else {
  mkdirSync(binDir, { recursive: true });
  console.log(`Downloading ${source.url}`);
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());

  if (source.zipEntry) {
    const work = mkdtempSync(join(tmpdir(), "ffmpeg-"));
    const archive = join(work, "ffmpeg.zip");
    writeFileSync(archive, bytes);
    // bsdtar ships with macOS and Windows 10+ and reads zip archives.
    execFileSync("tar", ["-xf", archive, "-C", work, source.zipEntry], { stdio: "inherit" });
    // The temp dir can be on another drive (C: vs D: on CI), where rename fails with EXDEV.
    copyFileSync(join(work, source.zipEntry), dest);
    rmSync(work, { recursive: true, force: true });
  } else {
    writeFileSync(dest, gunzipSync(bytes));
  }
  chmodSync(dest, 0o755);
  console.log(`Saved ${dest}`);
}

const encoders = execFileSync(dest, ["-hide_banner", "-encoders"], { encoding: "utf8" });
if (!encoders.includes("libmp3lame")) {
  console.error("This FFmpeg build has no libmp3lame encoder, so it cannot write MP3.");
  process.exit(1);
}
console.log("FFmpeg OK (libmp3lame available)");

function hostTriple() {
  const info = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  return info.match(/^host: (\S+)$/m)[1];
}
