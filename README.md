# VideoToMP3

English | [한국어](README.ko.md)

A Windows desktop app that extracts the audio track from video files and saves it as MP3, M4A, FLAC, WAV, or the original codec. The UI is Tauri 2 with React, the backend is Rust, and a bundled FFmpeg does the decoding and encoding.

## Install

Download [VideoToMP3_0.1.1_x64-setup.exe](https://github.com/tkyoun0421/convert/releases/download/v0.1.1/VideoToMP3_0.1.1_x64-setup.exe) (about 253 MB) and run it. Other versions are on the [Releases](https://github.com/tkyoun0421/convert/releases) page.

The installer includes FFmpeg and the WebView2 runtime, so it works on a PC without an internet connection. If WebView2 is already installed, the installer skips it.

The installer is not code-signed, so Windows SmartScreen warns on first run. Select **More info**, then **Run anyway**.

## Build from source

You need Rust (through [rustup](https://rustup.rs)), Node.js 22, and pnpm 8. On Windows, also install the Visual Studio Build Tools and WebView2, as listed in the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
pnpm install
node scripts/fetch-ffmpeg.mjs   # downloads FFmpeg for this platform into src-tauri/binaries/
pnpm tauri dev                  # run the app in development mode
pnpm test                       # UI tests with Vitest and fake Tauri modules
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build                # installers land in src-tauri/target/release/bundle/
```

The Rust tests convert real files with the downloaded FFmpeg, so run `fetch-ffmpeg.mjs` before `cargo test`.

## Structure

The React UI sends one `convert` command per file, with a channel for progress updates. The Rust side probes the input with `ffmpeg -i`, picks a plan from the output format and the source codec (copy the stream when the codecs match, encode otherwise), reserves an output name that never overwrites an existing file, and runs FFmpeg with `-progress`. Progress percentages stream back through the channel. Up to two files convert at once.

```
.
├── src/                         React UI
│   ├── App.tsx                  Wires the services, hooks and components together
│   ├── domain/                  Pure logic with no React or Tauri: job states and reducer, formats, settings, waveform, labels
│   ├── services/                Interfaces for the outside world, with Tauri and localStorage implementations
│   ├── hooks/                   React state: settings, the conversion queue, drag and drop
│   ├── components/              Display only: props in, markup out
│   ├── test/                    Fake Tauri modules for the UI tests
│   └── App.css                  Light and dark design tokens, styles
├── src-tauri/                   Rust backend
│   ├── src/converter/           Conversion core, one file per concern
│   │   ├── mod.rs               Public types and `convert`: probe, plan, run, report
│   │   ├── probe.rs             Reads the `ffmpeg -i` banner: length and audio codec
│   │   ├── plan.rs              Output format and source codec to FFmpeg arguments
│   │   ├── progress.rs          `-progress` lines to progress reports
│   │   ├── ffmpeg.rs            Starting FFmpeg, reading its output, stderr to errors
│   │   └── registry.rs          Running conversions and cancel
│   ├── src/lib.rs               Tauri commands `convert` and `cancel`, IPC contract test
│   ├── tests/convert.rs         Integration tests against the real FFmpeg binary
│   ├── binaries/                FFmpeg sidecar, downloaded and not tracked by Git
│   ├── build.rs                 Target triple for tests, Windows manifest embedding
│   └── tauri.conf.json          App name, window, bundle settings, copyright
├── scripts/fetch-ffmpeg.mjs     Downloads FFmpeg for the current platform
└── .github/workflows/windows.yml  Windows tests and installer build
```

Copyright © 2026 관태
