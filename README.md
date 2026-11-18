# 영상 → MP3 변환기

영상 파일에서 오디오 트랙을 꺼내 MP3로 저장하는 Windows 데스크톱 앱입니다. 화면은 Tauri 2와 React, 변환 로직은 Rust로 만들었고, 실제 디코딩·인코딩은 앱에 함께 들어 있는 FFmpeg가 맡습니다.

확장자만 `.mp3`로 바꾸면 안의 데이터는 그대로 영상 컨테이너라서 MP3 파일이 되지 않습니다. 이 앱은 오디오를 디코딩한 뒤 LAME 인코더로 다시 압축합니다.

음질은 이렇게 지킵니다. 원본 오디오가 MP3면 스트림을 그대로 복사해서 손실이 전혀 없습니다. AAC처럼 다른 형식이면 MP3 최고 비트레이트인 320 kbps와 LAME의 최고 품질 알고리즘(`-compression_level 0`)으로 인코딩하고, 샘플레이트와 채널 수는 MP3가 허용하는 범위(최대 48kHz, 스테레오) 안에서 원본을 유지합니다. 다만 손실 압축 형식끼리 변환하면 이론상 약간의 손실은 피할 수 없습니다. 320 kbps에서는 보통 귀로 구분하기 어려운 수준입니다.

손실이 전혀 없어야 하면 MP3 대신 다른 형식을 고릅니다.

- **원본 형식 그대로.** 원본 오디오를 복사만 합니다. AAC는 `.m4a`, Opus는 `.opus`, AC-3는 `.ac3`로 저장하고, 표에 없는 코덱은 `.mka`(Matroska 오디오)로 저장합니다.
- **FLAC.** 원본을 디코딩한 소리를 무손실로 압축합니다. 5.1채널과 96kHz도 그대로 유지합니다.
- **WAV.** 압축하지 않은 24비트 PCM으로 저장합니다. 4GB가 넘으면 RF64 형식으로 저장합니다.

## 기능

- 영상 여러 개를 창에 끌어다 놓거나 파일 선택 창에서 골라 한 번에 변환
- 출력 형식 선택: MP3(기본), M4A(AAC), FLAC, WAV, 원본 형식 그대로
- MP3·M4A 음질 선택: 128, 192, 320 kbps (기본 320)
- 원본 오디오가 고른 형식과 같은 코덱이면 다시 인코딩하지 않고 그대로 꺼냄(무손실). 예를 들어 대부분의 MP4는 오디오가 AAC라서 M4A로 고르면 그대로 복사됩니다.
- 파일별 진행률 표시와 변환 취소
- 저장 폴더 지정. 지정하지 않으면 원본 영상과 같은 폴더에 저장
- 같은 이름의 파일이 이미 있으면 덮어쓰지 않고 `이름 (1).mp3`처럼 새 이름으로 저장

지원 확장자는 `mp4`, `mkv`, `avi`, `mov`, `wmv`, `webm`, `flv`, `m4v`, `mpg`, `mpeg`, `ts`, `3gp`입니다.

## 개발 환경 준비

macOS와 Windows 모두 아래 순서로 준비합니다.

1. [Tauri 사전 준비 문서](https://v2.tauri.app/start/prerequisites/)대로 Rust와 OS별 도구를 설치합니다. Windows는 Visual Studio Build Tools와 WebView2가 필요합니다.
2. Node.js 22와 pnpm 8을 설치합니다.
3. 의존성을 설치합니다.

   ```sh
   pnpm install
   ```

4. 현재 OS에 맞는 FFmpeg를 받습니다. 파일은 `src-tauri/binaries/`에 저장되고 Git에는 올라가지 않습니다.

   ```sh
   node scripts/fetch-ffmpeg.mjs
   ```

## 개발 모드로 실행하기

```sh
pnpm tauri dev
```

Rust 테스트는 실제 FFmpeg로 짧은 영상을 만들어 변환해 봅니다. 그래서 4단계에서 FFmpeg를 먼저 받아 두어야 합니다.

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

## Windows 설치 파일 만들기

GitHub에 push하면 `.github/workflows/windows.yml`이 Windows 서버에서 테스트와 빌드를 돌립니다. 끝나면 해당 실행 기록의 **Artifacts**에서 설치 파일을 받을 수 있습니다.

- `VideoToMP3_<버전>_x64-setup.exe`: NSIS 설치 파일
- `VideoToMP3_<버전>_x64_en-US.msi`: MSI 설치 파일

Windows PC에서 직접 빌드하려면 개발 환경을 준비한 뒤 `pnpm tauri build`를 실행합니다. 결과물은 `src-tauri/target/release/bundle/`에 생깁니다.

코드 서명을 하지 않은 설치 파일은 처음 실행할 때 Windows SmartScreen 경고가 뜹니다. 개인용이면 **추가 정보 → 실행**으로 넘어가면 됩니다.

## FFmpeg와 라이선스

Windows 빌드에는 [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)의 FFmpeg 8.1 LGPL 정적 빌드가 들어갑니다. macOS 개발용 FFmpeg는 [eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) b6.1.1을 씁니다.

앱을 다른 사람에게 배포한다면 FFmpeg가 LGPL이라는 사실과 라이선스 전문, 소스 코드를 구할 수 있는 위치를 함께 알려야 합니다.

## 만든 사람

Copyright © 2026 관태

저작권 표시는 앱 화면 아래쪽과 Windows 실행 파일 속성(**자세히** 탭의 저작권, 회사)에 들어갑니다. 설정 위치는 `src-tauri/tauri.conf.json`의 `bundle.copyright`, `bundle.publisher`입니다.
