# 인수인계: VideoToMP3

작성일 2026-11-18. 다음 작업자가 이 파일 하나만 읽고 바로 이어서 일할 수 있게 정리했습니다. 설치 방법과 폴더 구조는 `README.md`(영어)와 `README.ko.md`(한국어)에 있습니다.

## 목표

Windows에서 영상 파일의 오디오 트랙을 꺼내 MP3 등으로 저장하는 데스크톱 앱입니다. Tauri 2와 Rust로 만들고, 화면은 React와 TypeScript입니다. 확장자만 바꾸는 방식으로는 MP3가 되지 않아서 FFmpeg로 실제 변환합니다.

사용자가 정한 요구사항은 다음과 같습니다.

- 변환 엔진은 앱에 FFmpeg를 함께 넣는 방식(Tauri sidecar)
- 드래그 앤 드롭과 여러 파일 일괄 변환, 파일별 진행률과 취소, 저장 폴더 지정
- 음질이 떨어지지 않을 것. 기본 320 kbps, 같은 코덱이면 다시 인코딩하지 않고 복사
- 출력 형식 선택: MP3(기본), M4A, FLAC, WAV, 원본 형식 그대로
- 제작자 표시: `Copyright © 2026 관태`
- 디자인: 파형 모양 진행률. 진행 경계 근처 막대가 처리 속도(배속)에 맞춘 박자로 뜀. 색은 "숲속 벽돌집" 느낌(흰 바탕, 벽돌 갈색, 숲 초록, 네이비 글자). 다크 모드는 필요 없음
- Windows 설치 파일은 GitHub Actions에서 빌드 (개발 기기는 macOS arm64)

## 현재 상태

모든 작업은 `feat/audio-converter` 브랜치에 커밋해서 push했고, PR은 https://github.com/tkyoun0421/convert/pull/1 입니다. 아직 병합하지 않았습니다. `main`에는 초기 커밋만 있습니다.

Windows CI(`.github/workflows/windows.yml`)는 커밋 `25f9691`에서 처음 성공했습니다.

- Windows용 FFmpeg 8.1로 `cargo test` 29개가 모두 통과했습니다. 단위 테스트 14개, 화면↔Rust 호출 계약 테스트 1개, 실제 FFmpeg로 변환하는 통합 테스트 14개입니다.
- 설치 파일이 두 개 만들어졌습니다. `VideoToMP3_0.1.0_x64-setup.exe`(NSIS, 40.63 MiB)와 `VideoToMP3_0.1.0_x64_ko-KR.msi`(54.18 MiB)입니다. 아티팩트 이름은 `VideoToMP3-windows`입니다.
- 벽돌 팔레트를 반영한 커밋 `82f20c1`의 CI도 성공했습니다. 그 뒤 박자 기능 커밋의 CI는 이 문서를 쓰는 시점에 돌고 있었습니다.

이 Mac에서 확인한 것은 다음과 같습니다.

- `cargo test`, `cargo clippy --all-targets`(경고 0), `cargo fmt --check`, `pnpm build`가 모두 통과합니다.
- 계약 테스트(`src-tauri/src/lib.rs`의 `frontend_payloads_round_trip_through_the_commands`)는 `src/api.ts`가 보내는 것과 같은 JSON으로 `convert`, `cancel` 명령을 부릅니다. 인자 이름 `outputDir`를 일부러 틀리게 바꾸면 실패하는 것까지 확인했습니다.
- 화면은 두 가지로 확인했습니다. 하나는 실제 Tauri 창을 띄워 찍은 스크린샷(빈 목록 상태)입니다. 다른 하나는 Tauri API만 가짜로 바꾼 임시 미리보기 페이지를 headless Chrome으로 찍은 것입니다. 이 페이지는 실제 화면 코드에 드롭 이벤트와 진행률·완료·실패를 흘려 넣습니다. 미리보기 파일은 확인 후 지웠습니다.

확인하지 못한 것은 다음과 같습니다.

- **실제 앱에서 파일을 골라 끝까지 변환하는 과정.** macOS 파일 선택 창은 별도 프로세스라 자동 클릭이 사이드바에만 먹혔습니다. Windows 실기기에서도 아직 설치해 보지 않았습니다.
- **최종 색상과 박자 움직임의 실제 Tauri 창 모습.** 둘 다 가짜 Tauri API를 쓴 미리보기·데모 페이지로만 확인했습니다. 사용자는 데모에서 "재생 위치만 뜀(B)"을 골랐습니다.

## 설계 결정과 이유

| 결정 | 이유 |
| --- | --- |
| FFmpeg를 sidecar로 동봉. Windows는 BtbN `n8.1` LGPL 정적 빌드, Mac 개발용은 eugeneware `b6.1.1` | 거의 모든 영상 형식을 지원하고 사용자가 따로 설치할 필요가 없음. LGPL 빌드에도 `libmp3lame`이 있음 |
| 변환 로직은 `converter.rs`에 두고 tauri에 의존하지 않음. `lib.rs`는 얇은 어댑터 | 프레임워크 없이 실제 FFmpeg로 테스트하기 위해 |
| 변환 전에 `ffmpeg -i`로 probe해서 오디오 코덱과 길이를 읽음 | 같은 코덱이면 복사(무손실), 오디오가 없으면 파일을 만들기 전에 바로 실패, 진행률 분모로 길이 사용 |
| 형식별 동작은 표 하나(`plan`)에서 결정 | 형식이 늘어도 분기가 흩어지지 않음. 형식별 단위 테스트가 있음 |
| `-ar`, `-ac` 옵션을 쓰지 않음 | 샘플레이트와 채널을 원본대로 유지. MP3는 형식 한계로 최대 48kHz·스테레오로 바뀜 |
| 출력 파일 이름은 `create_new`로 먼저 예약하고 `이름 (1).mp3` 식으로 피함 | 동시에 도는 `a.mp4`, `a.mkv`가 같은 `a.mp3`를 덮어쓰지 않게, 사용자 파일도 덮어쓰지 않게 |
| 취소는 레지스트리 락을 쥔 채로 kill, wait, 파일 삭제까지 끝냄 | `Canceled`가 반환될 때 부분 파일이 이미 지워진 상태를 보장 |
| 앱 종료 시 `cancel_all` | Windows는 부모가 죽어도 자식 프로세스를 정리하지 않음 |
| Windows에서 `CREATE_NO_WINDOW` | 변환할 때마다 콘솔 창이 깜빡이지 않게 |
| 동시 변환 2개 (`src/App.tsx`의 `MAX_PARALLEL`) | LAME 인코딩은 단일 스레드라 약간의 병렬이 이득 |
| WiX 언어 `ko-KR` | MSI 기본 언어(en-US, 코드페이지 1252)는 한글 제작자명 `관태`를 담지 못함. CI에서 MSI 생성 성공 |
| `build.rs`에서 MSVC 대상이면 매니페스트를 링커(`/MANIFEST:EMBED`)로 넣음 | tauri-build는 매니페스트를 앱 실행 파일에만 넣음. 테스트 실행 파일은 `TaskDialogIndirect`가 없는 공용 컨트롤 v5를 불러 `STATUS_ENTRYPOINT_NOT_FOUND`로 죽었음 |
| `fetch-ffmpeg.mjs`는 압축 해제한 파일을 `rename` 대신 복사 | CI 러너는 임시 폴더(C:)와 저장소(D:)가 달라 `EXDEV`로 실패했음 |
| 파형은 파일 경로를 시드로 만든 고정 모양(`src/Waveform.tsx`) | 파일마다 고유한 모양이라 목록에서 구분이 쉬움. 진행률만큼 왼쪽부터 초록으로 채움 |
| 진행 경계 근처 막대만 뛰고, 박자는 FFmpeg `speed=` 값을 구간 표(`TEMPO`)로 바꿔 정함 | 진행률이 잘 읽힘. 연속 값 대신 구간을 쓰는 이유는 실행 중인 CSS 애니메이션 길이를 바꾸면 막대가 튀기 때문. 길이를 모르는 영상은 막대 전체가 뜀 |
| 글꼴은 IBM Plex Sans KR 400·600을 앱에 내장(`@fontsource`) | 오프라인에서도 같은 모양. 숫자 폭이 고정이라 %가 흔들리지 않음. `dist`가 약 5MB 늘어남 |
| 권한은 `opener:allow-reveal-item-in-dir`, `dialog:allow-open`만 허용 | 필요한 최소 권한 |

## 위험과 미확인 항목

1. **libopus 유무.** Windows LGPL 빌드에 `libopus`가 없으면 Opus 테스트는 통과로 끝나되 실제로는 건너뜁니다. 테스트 출력이 캡처되어서 CI 로그로는 어느 쪽인지 알 수 없습니다. `cargo test -- --nocapture`로 확인할 수 있습니다.
2. **코드 서명 없음.** 처음 실행할 때 SmartScreen 경고가 뜹니다.
3. **취소 경쟁 구간.** 취소 요청이 FFmpeg 프로세스 등록보다 먼저 도착하면 무시되고 변환이 끝까지 진행됩니다. 몇 밀리초 수준이라 그대로 두었습니다.
4. **배포 시 라이선스.** 외부에 배포하려면 FFmpeg LGPL 고지와 라이선스 전문을 함께 넣어야 합니다. 아직 넣지 않았습니다.
5. **CI 중복 실행.** 연달아 push하면 실행이 겹쳐 돕니다(한 번에 약 10분). 워크플로에 `concurrency`를 넣으면 이전 실행이 자동 취소됩니다.

## 다음 할 일

순서대로 진행하면 됩니다.

1. PR #1의 최신 커밋 CI가 성공했는지 확인합니다.
2. 최신 실행의 `VideoToMP3-windows` 아티팩트를 받아 Windows PC에 설치합니다. 영상을 끌어다 놓아 변환, 파형 진행률, 취소, **폴더에서 보기**, 출력 형식별 결과를 직접 확인합니다.
3. 문제가 없으면 사용자 승인을 받아 PR #1을 병합합니다.
4. 남은 후보입니다. 일괄 변환 전체 진행률(예: 3/10개 완료)은 아직 없습니다.

## 알아둘 점

- Rust는 이번 작업 중 rustup으로 설치했습니다. 새 터미널이 아니면 `source "$HOME/.cargo/env"`를 먼저 실행합니다.
- 로컬 pnpm은 8.15.2이고 `package.json`의 `packageManager`도 같은 버전입니다. lockfile 형식이 바뀌지 않게 같은 버전을 씁니다.
- `src-tauri/binaries/`는 Git에 올라가지 않습니다. 새로 clone하면 `node scripts/fetch-ffmpeg.mjs`부터 실행합니다.
- 진행 정보는 `Progress { percent, speed }`로 채널에 실려 옵니다. `percent`는 FFmpeg `-progress`의 `out_time_us`를 probe한 길이로 나눈 값이고, `speed`는 `speed=52.3x`의 배속입니다. 길이를 모르는 영상이면 `percent`가 `null`이고 "변환 중"을 보여 줍니다.
- 디자인 작업에는 Anthropic 공식 `frontend-design` 스킬(`anthropics/skills`)을 받아 `~/.claude/skills/frontend-design`에 설치해서 썼습니다.
- 제작자 이름은 사용자가 쓴 그대로 `관태`로 넣었습니다. Git 사용자 이름은 `태관`이라 다릅니다. 둘 중 무엇이 맞는지 사용자에게 확인하세요.
- `todo.md`는 작업용 체크리스트이고 `.git/info/exclude`로 Git에서 제외했습니다.
