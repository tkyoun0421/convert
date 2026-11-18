# VideoToMP3

A Windows desktop app that extracts the audio track from video files and saves it as MP3, M4A, FLAC, WAV, or the original codec. The UI is Tauri 2 with React, the backend is Rust, and a bundled FFmpeg does the decoding and encoding.

## Install

1. Open the latest successful **Windows build** run on the repository's **Actions** tab.
2. Download the `VideoToMP3-windows` artifact and unzip it.
3. Run `VideoToMP3_<version>_x64-setup.exe`. The `.msi` file in the same archive is an alternative installer.

The installer is not code-signed, so Windows SmartScreen warns on first run. Select **More info**, then **Run anyway**.

## Build from source

You need Rust (through [rustup](https://rustup.rs)), Node.js 22, and pnpm 8. On Windows, also install the Visual Studio Build Tools and WebView2, as listed in the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
pnpm install
node scripts/fetch-ffmpeg.mjs   # downloads FFmpeg for this platform into src-tauri/binaries/
pnpm tauri dev                  # run the app in development mode
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build                # installers land in src-tauri/target/release/bundle/
```

The tests convert real files with the downloaded FFmpeg, so run `fetch-ffmpeg.mjs` before `cargo test`.

## Structure

The React UI sends one `convert` command per file, with a channel for progress updates. The Rust side probes the input with `ffmpeg -i`, picks a plan from the output format and the source codec (copy the stream when the codecs match, encode otherwise), reserves an output name that never overwrites an existing file, and runs FFmpeg with `-progress`. Progress percentages stream back through the channel. Up to two files convert at once.

```
.
├── src/                         React UI
│   ├── App.tsx                  Layout, settings, drag and drop, queue scheduler
│   ├── JobRow.tsx               One queued file: status, actions, progress
│   ├── Waveform.tsx             Per-file waveform that doubles as the progress bar
│   ├── jobs.ts                  Job states and reducer, accepted video extensions
│   ├── api.ts                   Typed wrappers for the Rust commands
│   └── App.css                  Light and dark design tokens, styles
├── src-tauri/                   Rust backend
│   ├── src/converter.rs         Conversion core: probe, format plans, progress, cancel
│   ├── src/lib.rs               Tauri commands `convert` and `cancel`, IPC contract test
│   ├── tests/convert.rs         Integration tests against the real FFmpeg binary
│   ├── binaries/                FFmpeg sidecar, downloaded and not tracked by Git
│   ├── build.rs                 Target triple for tests, Windows manifest embedding
│   └── tauri.conf.json          App name, window, bundle settings, copyright
├── scripts/fetch-ffmpeg.mjs     Downloads FFmpeg for the current platform
└── .github/workflows/windows.yml  Windows tests and installer build
```

Copyright © 2026 관태
