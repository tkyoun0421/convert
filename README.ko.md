# VideoToMP3

[English](README.md) | 한국어

영상 파일에서 오디오 트랙을 꺼내 MP3, M4A, FLAC, WAV 또는 원본 코덱 그대로 저장하는 Windows 데스크톱 앱입니다. 화면은 Tauri 2와 React, 백엔드는 Rust로 만들었고, 디코딩과 인코딩은 앱에 함께 들어 있는 FFmpeg가 맡습니다.

## 설치

1. 저장소의 **Actions** 탭에서 가장 최근에 성공한 **Windows build** 실행 기록을 엽니다.
2. `VideoToMP3-windows` 아티팩트를 받아 압축을 풉니다.
3. `VideoToMP3_<버전>_x64-setup.exe`를 실행합니다. 같은 압축 파일에 든 `.msi`로 설치해도 됩니다.

설치 파일에 코드 서명이 없어서 처음 실행할 때 Windows SmartScreen 경고가 뜹니다. **추가 정보**를 누른 뒤 **실행**을 누릅니다.

## 소스에서 빌드하기

Rust([rustup](https://rustup.rs)으로 설치), Node.js 22, pnpm 8이 필요합니다. Windows에서는 [Tauri 사전 준비 문서](https://v2.tauri.app/start/prerequisites/)에 나온 Visual Studio Build Tools와 WebView2도 설치합니다.

```sh
pnpm install
node scripts/fetch-ffmpeg.mjs   # 현재 플랫폼용 FFmpeg를 src-tauri/binaries/에 받음
pnpm tauri dev                  # 개발 모드로 앱 실행
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build                # 설치 파일은 src-tauri/target/release/bundle/에 생김
```

테스트는 받아 둔 FFmpeg로 실제 파일을 변환합니다. 그래서 `cargo test` 전에 `fetch-ffmpeg.mjs`를 먼저 실행해야 합니다.

## 구조

React 화면은 파일마다 `convert` 명령을 한 번씩 보내고, 진행률은 채널로 돌려받습니다. Rust 쪽은 `ffmpeg -i`로 입력을 확인한 뒤 출력 형식과 원본 코덱을 보고 처리 방식을 고릅니다. 코덱이 같으면 스트림을 그대로 복사하고, 다르면 인코딩합니다. 출력 파일 이름은 기존 파일을 덮어쓰지 않게 먼저 예약해 두고, FFmpeg를 `-progress` 옵션으로 실행해 진행률을 채널로 흘려보냅니다. 동시에 최대 두 파일까지 변환합니다.

```
.
├── src/                         React 화면
│   ├── App.tsx                  배치, 설정, 드래그 앤 드롭, 변환 대기열 관리
│   ├── JobRow.tsx               목록의 파일 한 줄: 상태, 버튼, 진행률
│   ├── Waveform.tsx             진행률 막대 역할을 하는 파일별 파형
│   ├── jobs.ts                  작업 상태와 reducer, 받는 영상 확장자 목록
│   ├── api.ts                   Rust 명령을 부르는 타입 래퍼
│   └── App.css                  라이트·다크 디자인 토큰과 스타일
├── src-tauri/                   Rust 백엔드
│   ├── src/converter.rs         변환 핵심: 입력 확인, 형식별 처리 방식, 진행률, 취소
│   ├── src/lib.rs               Tauri 명령 `convert`·`cancel`, 화면↔Rust 호출 계약 테스트
│   ├── tests/convert.rs         실제 FFmpeg로 돌리는 통합 테스트
│   ├── binaries/                FFmpeg sidecar. 받아서 쓰며 Git에는 올리지 않음
│   ├── build.rs                 테스트용 target triple, Windows 매니페스트 삽입
│   └── tauri.conf.json          앱 이름, 창, 번들 설정, 저작권
├── scripts/fetch-ffmpeg.mjs     현재 플랫폼용 FFmpeg를 받는 스크립트
└── .github/workflows/windows.yml  Windows 테스트와 설치 파일 빌드
```

Copyright © 2026 관태
