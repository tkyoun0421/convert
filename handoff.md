# 인수인계: 영상 → 오디오 변환기

작성일 2026-11-18. 다음 작업자가 이 파일 하나만 읽고 바로 이어서 일할 수 있게 정리했습니다. 실행 방법과 기능 설명은 `README.md`에 있습니다.

## 목표

Windows에서 영상 파일의 오디오 트랙을 꺼내 MP3 등으로 저장하는 데스크톱 앱입니다. Tauri 2와 Rust로 만들고, 화면은 React와 TypeScript입니다. 확장자만 바꾸는 방식으로는 MP3가 되지 않아서 FFmpeg로 실제 변환합니다.

사용자가 정한 요구사항은 다음과 같습니다.

- 변환 엔진은 앱에 FFmpeg를 함께 넣는 방식(Tauri sidecar)
- 드래그 앤 드롭과 여러 파일 일괄 변환, 파일별 진행률과 취소, 저장 폴더 지정
- 음질이 떨어지지 않을 것. 기본 320 kbps, 같은 코덱이면 다시 인코딩하지 않고 복사
- 출력 형식 선택: MP3(기본), M4A, FLAC, WAV, 원본 형식 그대로
- 제작자 표시: `Copyright © 2026 관태`
- Windows 설치 파일은 GitHub Actions에서 빌드 (개발 기기는 macOS arm64)

## 현재 상태

기능 구현은 끝났고, 아직 커밋하지 않았습니다. 모든 파일이 `git status`에서 untracked로 나옵니다. GitHub 원격 저장소도 아직 없습니다.

이 Mac에서 확인한 것은 다음과 같습니다.

- `cargo test --manifest-path src-tauri/Cargo.toml`: 29개 통과. 단위 테스트 14개, 화면↔Rust 호출 계약 테스트 1개, 실제 FFmpeg로 변환하는 통합 테스트 14개입니다.
- 계약 테스트(`src-tauri/src/lib.rs`의 `frontend_payloads_round_trip_through_the_commands`)는 `src/api.ts`가 보내는 것과 같은 JSON으로 `convert`, `cancel` 명령을 부릅니다. 인자 이름 `outputDir`를 일부러 틀리게 바꾸면 실패하는 것까지 확인했습니다.
- `cargo clippy --all-targets` 경고 0개, `cargo fmt --check` 통과, `pnpm build` 통과.
- `pnpm tauri dev`로 앱을 띄워 화면과 하단 저작권 문구가 나오는 것을 스크린샷으로 확인했습니다.

확인하지 못한 것은 다음과 같습니다.

- **앱 화면에서 파일을 골라 끝까지 변환하는 과정.** macOS 파일 선택 창은 별도 프로세스라 자동 클릭이 사이드바에만 먹히고 파일 목록에는 먹히지 않았습니다. 진행률 막대가 실제로 움직이는 모습도 화면으로는 보지 못했습니다. Rust 테스트는 진행률 값이 0~100 사이로 전달되는지만 확인합니다.
- **Windows 빌드 전체.** CI가 한 번도 돌지 않았습니다. 아래 위험 항목을 보세요.

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
| WiX 언어 `ko-KR` | MSI 기본 언어(en-US, 코드페이지 1252)는 한글 제작자명 `관태`를 담지 못함 |
| 권한은 `opener:allow-reveal-item-in-dir`, `dialog:allow-open`만 허용 | 필요한 최소 권한 |

## 위험과 미확인 항목

1. **MSI 빌드의 한글 처리.** `bundle.publisher`가 MSI의 Manufacturer로 들어갑니다. `ko-KR` 지정으로 해결될 것으로 보지만 실행해 보지 않았습니다. CI에서 `LGHT0311` 같은 코드페이지 오류가 나면 `publisher`를 영문으로 바꾸거나 `bundle.targets`를 `["nsis"]`로 줄이면 됩니다.
2. **Windows용 FFmpeg 8.1과 Mac용 6.0의 차이.** 통합 테스트는 Mac의 6.0으로만 돌았습니다. CI의 `cargo test`가 8.1로 같은 테스트를 돌리므로 첫 CI 실행 결과를 꼭 확인해야 합니다.
3. **libopus 유무.** Windows LGPL 빌드에 `libopus`가 없으면 Opus 테스트는 이유를 출력하고 건너뜁니다. 실패로 나오지 않으니 로그를 보고 판단해야 합니다.
4. **설치 파일 크기.** FFmpeg 정적 빌드가 커서 설치 파일이 수십 MB가 될 것으로 예상합니다(측정 안 함).
5. **코드 서명 없음.** 처음 실행할 때 SmartScreen 경고가 뜹니다.
6. **취소 경쟁 구간.** 취소 요청이 FFmpeg 프로세스 등록보다 먼저 도착하면 무시되고 변환이 끝까지 진행됩니다. 몇 밀리초 수준이라 그대로 두었습니다.
7. **배포 시 라이선스.** 외부에 배포하려면 FFmpeg LGPL 고지와 라이선스 전문을 함께 넣어야 합니다. 아직 넣지 않았습니다.

## 다음 할 일

순서대로 진행하면 됩니다.

1. 사용자 승인을 받아 커밋합니다. 기본 브랜치가 `main`이므로 브랜치를 먼저 만드는 것이 좋습니다.
2. GitHub 저장소를 만들고 push합니다(사용자 승인 필요). `gh`는 이 Mac에 로그인되어 있습니다.
3. Actions의 **Windows build** 결과를 확인합니다. `cargo test` 로그에서 Opus 테스트가 건너뛰어졌는지, `pnpm tauri build`에서 MSI가 만들어졌는지 봅니다.
4. Artifacts에서 설치 파일을 받아 Windows PC에 설치하고, 영상을 끌어다 놓아 변환, 진행률 막대, 취소, **폴더에서 보기**를 직접 확인합니다.
5. 필요하면 다듬습니다. 사용자에게 언급만 하고 답을 받지 못한 후보는 창 제목과 앱 이름 변경입니다. 형식이 늘었는데 아직 "MP3 변환기"입니다. 일괄 변환 전체 진행률(예: 3/10개 완료)은 아직 없습니다.

## 파일 지도

- `src-tauri/src/converter.rs`: probe, 형식별 plan 표, 진행률 파싱, 출력 이름 예약, 실행 중 작업 레지스트리, convert, cancel
- `src-tauri/src/lib.rs`: Tauri 명령 `convert`, `cancel`, 플러그인 등록, 종료 처리, 호출 계약 테스트
- `src-tauri/tests/convert.rs`: 실제 FFmpeg를 쓰는 통합 테스트
- `src-tauri/build.rs`: 테스트가 FFmpeg 파일을 찾도록 `TARGET_TRIPLE` 환경 변수를 내보냄
- `src-tauri/tauri.conf.json`: 앱 이름, 창, `externalBin`, 제작자·저작권, WiX 언어
- `src-tauri/capabilities/default.json`: 화면이 쓸 수 있는 권한
- `src/api.ts`: Rust 명령 호출 래퍼, 형식과 비트레이트 목록, 오류 메시지
- `src/jobs.ts`: 작업 상태 타입과 reducer, 영상 확장자 목록
- `src/App.tsx`, `src/App.css`: 화면, 동시 2개 스케줄러, 드래그 앤 드롭, 설정 저장(localStorage)
- `scripts/fetch-ffmpeg.mjs`: 현재 플랫폼용 FFmpeg를 `src-tauri/binaries/`에 받고 `libmp3lame` 유무를 검사
- `.github/workflows/windows.yml`: Windows 테스트와 설치 파일 빌드

## 알아둘 점

- Rust는 이번 작업 중 rustup으로 설치했습니다. 새 터미널이 아니면 `source "$HOME/.cargo/env"`를 먼저 실행합니다.
- 로컬 pnpm은 8.15.2이고 `package.json`의 `packageManager`도 같은 버전입니다. lockfile 형식이 바뀌지 않게 같은 버전을 씁니다.
- `src-tauri/binaries/`는 Git에 올라가지 않습니다. 새로 clone하면 `node scripts/fetch-ffmpeg.mjs`부터 실행합니다. 이 파일이 없으면 테스트와 빌드가 실패합니다.
- 진행률은 FFmpeg `-progress`의 `out_time_us`를 probe한 길이로 나눈 값입니다. 길이를 모르는 영상이면 진행률 없이 움직이는 막대와 "변환 중…"을 보여 줍니다.
- 제작자 이름은 사용자가 쓴 그대로 `관태`로 넣었습니다. Git 사용자 이름은 `태관`이라 다릅니다. 둘 중 무엇이 맞는지 사용자에게 확인하세요.
- `todo.md`는 작업용 체크리스트이고 `.git/info/exclude`로 Git에서 제외했습니다.
