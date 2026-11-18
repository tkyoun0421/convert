import { StrictMode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, test } from "vitest";
import App from "./App";
import { FakeChannel, tauri, type DragPayload } from "./test/tauri";

const SETTINGS_KEY = "videoToMp3.settings";
const VIDEO_EXTENSIONS = [
  "mp4", "mkv", "avi", "mov", "wmv", "webm", "flv", "m4v", "mpg", "mpeg", "ts", "3gp",
];
const HINTS = {
  mp3: "320 kbps가 MP3 최고 음질입니다. 128·192 kbps는 파일이 작아지는 대신 음질이 낮아집니다. 원본이 MP3면 그대로 복사합니다.",
  m4a: "320 kbps가 가장 높은 음질입니다. 128·192 kbps는 파일이 작아지는 대신 음질이 낮아집니다. 원본이 AAC면 그대로 복사합니다.",
  lossless: "무손실 형식이라 비트레이트를 쓰지 않습니다. 대신 파일이 커집니다.",
  original: "오디오를 다시 인코딩하지 않고 그대로 꺼내므로 비트레이트를 쓰지 않습니다.",
};

async function renderApp() {
  const view = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await act(async () => {});
  return view;
}

async function drag(payload: DragPayload) {
  await act(async () => tauri.drag(payload));
}

const drop = (...paths: string[]) => drag({ type: "drop", paths });

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function settle(fn: () => void) {
  await act(async () => fn());
}

const formatSelect = () => screen.getByRole("combobox", { name: "출력 형식" }) as HTMLSelectElement;
const bitrateSelect = () => screen.getByRole("combobox", { name: "음질" }) as HTMLSelectElement;
const startButton = () => screen.getByRole("button", { name: /^변환 (시작|중)/ });
const row = (name: string) => screen.getByText(name, { selector: ".job-name" }).closest("li")!;
const statusOf = (name: string) => row(name).querySelector(".job-status")!.textContent;
const speedOf = (name: string) => row(name).querySelector(".job-speed")?.textContent ?? null;
const wave = (name: string) => row(name).querySelector<HTMLElement>(".wave")!;
const bars = (name: string, selector = "") => wave(name).querySelectorAll(`.bar${selector}`);
const liveIndices = (name: string) =>
  [...bars(name)].flatMap((bar, i) => (bar.classList.contains("live") ? [i] : []));
const rowNames = () =>
  screen.queryAllByRole("listitem").map((li) => li.querySelector(".job-name")!.textContent);
const notice = () => screen.queryByRole("status")?.textContent ?? null;
const storedSettings = () => localStorage.getItem(SETTINGS_KEY);

function selectFormat(value: string) {
  fireEvent.change(formatSelect(), { target: { value } });
}

describe("설정", () => {
  it("저장된 설정이 없으면 MP3 320 kbps, 원본 폴더로 시작하고 그 값을 저장한다", async () => {
    await renderApp();
    expect(formatSelect().value).toBe("mp3");
    expect(bitrateSelect().value).toBe("320");
    expect(bitrateSelect().disabled).toBe(false);
    expect(screen.getByText("원본 영상과 같은 폴더")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "원본 폴더로" })).toBeNull();
    expect(storedSettings()).toBe('{"format":"mp3","bitrate":320,"outputDir":null}');
  });

  test.each([
    [
      "올바른 값은 그대로",
      '{"format":"flac","bitrate":192,"outputDir":"D:\\\\out"}',
      { format: "flac", bitrate: "192", outputDir: "D:\\out" },
    ],
    [
      "알 수 없는 값은 항목별로 기본값",
      '{"format":"ogg","bitrate":256,"outputDir":5}',
      { format: "mp3", bitrate: "320", outputDir: null },
    ],
    [
      "일부만 올바르면 그 항목만 유지",
      '{"format":"wav","bitrate":"128"}',
      { format: "wav", bitrate: "320", outputDir: null },
    ],
    ["JSON이 깨졌으면 전부 기본값", "not json", { format: "mp3", bitrate: "320", outputDir: null }],
    ["null이면 전부 기본값", "null", { format: "mp3", bitrate: "320", outputDir: null }],
  ])("저장된 설정 불러오기: %s", async (_, stored, expected) => {
    localStorage.setItem(SETTINGS_KEY, stored);
    await renderApp();
    expect(formatSelect().value).toBe(expected.format);
    expect(bitrateSelect().value).toBe(expected.bitrate);
    expect(screen.getByText(expected.outputDir ?? "원본 영상과 같은 폴더")).toBeTruthy();
  });

  test.each([
    ["mp3", HINTS.mp3, false],
    ["m4a", HINTS.m4a, false],
    ["flac", HINTS.lossless, true],
    ["wav", HINTS.lossless, true],
    ["original", HINTS.original, true],
  ])("형식 %s: 음질 안내와 음질 선택 가능 여부", async (format, hint, bitrateDisabled) => {
    await renderApp();
    await settle(() => selectFormat(format));
    expect(document.getElementById("bitrate-hint")!.textContent).toBe(hint);
    expect(bitrateSelect().getAttribute("aria-describedby")).toBe("bitrate-hint");
    expect(bitrateSelect().disabled).toBe(bitrateDisabled);
  });

  it("형식·음질을 바꾸면 바로 저장한다", async () => {
    await renderApp();
    await settle(() => selectFormat("m4a"));
    expect(storedSettings()).toBe('{"format":"m4a","bitrate":320,"outputDir":null}');
    await settle(() => fireEvent.change(bitrateSelect(), { target: { value: "128" } }));
    expect(storedSettings()).toBe('{"format":"m4a","bitrate":128,"outputDir":null}');
  });

  it("저장 폴더를 고르고 원본 폴더로 되돌린다", async () => {
    await renderApp();
    tauri.open.mockResolvedValueOnce("D:\\out");
    await click(screen.getByRole("button", { name: "폴더 선택…" }));
    expect(tauri.open).toHaveBeenLastCalledWith({ directory: true });
    expect(screen.getByText("D:\\out").getAttribute("title")).toBe("D:\\out");
    expect(storedSettings()).toBe('{"format":"mp3","bitrate":320,"outputDir":"D:\\\\out"}');

    await click(screen.getByRole("button", { name: "원본 폴더로" }));
    expect(screen.getByText("원본 영상과 같은 폴더").hasAttribute("title")).toBe(false);
    expect(storedSettings()).toBe('{"format":"mp3","bitrate":320,"outputDir":null}');
  });

  it("폴더 선택을 취소하면 아무것도 바뀌지 않는다", async () => {
    await renderApp();
    tauri.open.mockResolvedValueOnce(null);
    await click(screen.getByRole("button", { name: "폴더 선택…" }));
    expect(screen.getByText("원본 영상과 같은 폴더")).toBeTruthy();
  });
});

describe("파일 추가", () => {
  it("빈 목록은 빈 상자 그림과 비어 있음을 보여 주고 버튼은 비활성이다", async () => {
    const { asFragment } = await renderApp();
    const empty = screen.getByText("비어 있음").parentElement!;
    expect(empty.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("list")).toBeNull();
    expect(startButton().textContent).toBe("변환 시작 (0개)");
    expect((startButton() as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "완료 항목 지우기" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(asFragment()).toMatchSnapshot();
  });

  it("끌어다 놓는 동안 dragging 표시를 한다", async () => {
    const { container } = await renderApp();
    const app = container.querySelector(".app")!;
    await drag({ type: "enter", paths: ["C:\\a.mp4"] });
    expect(app.className).toBe("app dragging");
    await drag({ type: "over" });
    expect(app.className).toBe("app dragging");
    await drag({ type: "leave" });
    expect(app.className).toBe("app");
    await drag({ type: "over" });
    await drop("C:\\a.mp4");
    expect(app.className).toBe("app");
  });

  it("영상만 추가하고 나머지 개수를 알린다", async () => {
    await renderApp();
    await drop("C:\\videos\\a.MP4", "/home/u/b.mkv", "C:\\docs\\c.txt", "C:\\noext", ".webm");
    expect(rowNames()).toEqual(["a.MP4", "b.mkv", ".webm"]);
    expect(notice()).toBe("영상 파일이 아닌 2개 파일은 건너뛰었습니다.");
    expect(startButton().textContent).toBe("변환 시작 (3개)");
    expect(statusOf("a.MP4")).toBe("대기");
    expect(row("a.MP4").className).toBe("job job-queued");
    expect(row("a.MP4").querySelector(".job-name")!.getAttribute("title")).toBe(
      "C:\\videos\\a.MP4",
    );
  });

  it("같은 경로는 한 번만 추가하고, 모두 영상이면 알림을 지운다", async () => {
    await renderApp();
    await drop("C:\\v\\a.mp4", "C:\\x.txt");
    expect(notice()).not.toBeNull();
    await drop("C:\\v\\a.mp4", "C:\\v\\b.mp4", "C:\\v\\b.mp4");
    expect(rowNames()).toEqual(["a.mp4", "b.mp4"]);
    expect(notice()).toBeNull();
  });

  it("영상이 하나도 없으면 목록은 그대로 두고 알리기만 한다", async () => {
    await renderApp();
    await drop("C:\\x.txt");
    expect(rowNames()).toEqual([]);
    expect(notice()).toBe("영상 파일이 아닌 1개 파일은 건너뛰었습니다.");
  });

  it("파일 선택 창에서 고른 영상을 추가한다", async () => {
    await renderApp();
    tauri.open.mockResolvedValueOnce(["C:\\v\\a.mp4", "C:\\v\\b.txt"]);
    await click(screen.getByRole("button", { name: "파일 선택…" }));
    expect(tauri.open).toHaveBeenLastCalledWith({
      multiple: true,
      filters: [{ name: "영상 파일", extensions: VIDEO_EXTENSIONS }],
    });
    expect(rowNames()).toEqual(["a.mp4"]);
    expect(notice()).toBe("영상 파일이 아닌 1개 파일은 건너뛰었습니다.");
  });

  it("파일 선택을 취소하면 아무것도 바뀌지 않는다", async () => {
    await renderApp();
    await drop("C:\\x.txt");
    tauri.open.mockResolvedValueOnce(null);
    await click(screen.getByRole("button", { name: "파일 선택…" }));
    expect(rowNames()).toEqual([]);
    expect(notice()).toBe("영상 파일이 아닌 1개 파일은 건너뛰었습니다.");
  });

  it("드래그 리스너는 하나만 남고 화면을 닫으면 해제한다", async () => {
    const { unmount } = await renderApp();
    expect(tauri.dragListeners.size).toBe(1);
    unmount();
    expect(tauri.dragListeners.size).toBe(0);
  });
});

describe("변환", () => {
  async function startWith(paths: string[], stored?: object) {
    if (stored) localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
    const view = await renderApp();
    await drop(...paths);
    await click(startButton());
    return view;
  }

  it("설정을 담아 한 번에 두 개까지 Rust에 변환을 요청한다", async () => {
    await startWith(["C:\\v\\a.mp4", "C:\\v\\b.mkv", "C:\\v\\c.avi"], {
      format: "m4a",
      bitrate: 192,
      outputDir: "D:\\out",
    });
    expect(tauri.invocations("convert")).toEqual([
      {
        id: 1,
        input: "C:\\v\\a.mp4",
        outputDir: "D:\\out",
        format: "m4a",
        bitrate: 192,
        onProgress: expect.any(FakeChannel),
      },
      {
        id: 2,
        input: "C:\\v\\b.mkv",
        outputDir: "D:\\out",
        format: "m4a",
        bitrate: 192,
        onProgress: expect.any(FakeChannel),
      },
    ]);
    expect(rowNames().map(statusOf)).toEqual(["변환 중", "변환 중", "대기"]);
    expect(row("a.mp4").className).toBe("job job-converting");
    expect(startButton().textContent).toBe("변환 중…");
    expect((startButton() as HTMLButtonElement).disabled).toBe(true);
    expect(formatSelect().disabled).toBe(true);
    expect(bitrateSelect().disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "폴더 선택…" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "원본 폴더로" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("하나가 끝나면 다음 대기 항목을 시작하고, 진행 중에 추가한 파일도 이어서 변환한다", async () => {
    await startWith(["C:\\v\\a.mp4", "C:\\v\\b.mp4", "C:\\v\\c.mp4"]);
    await settle(() => tauri.converts[0].resolve({ output: "C:\\v\\a.mp3", copied: false }));
    expect(tauri.converts.map((c) => c.payload.id)).toEqual([1, 2, 3]);
    expect(rowNames().map(statusOf)).toEqual(["완료", "변환 중", "변환 중"]);

    await drop("C:\\v\\d.mp4");
    expect(statusOf("d.mp4")).toBe("대기");
    await settle(() => tauri.converts[1].reject({ kind: "failed", message: "x" }));
    expect(tauri.converts.map((c) => c.payload.id)).toEqual([1, 2, 3, 4]);
    expect(statusOf("d.mp4")).toBe("변환 중");
  });

  it("모든 변환이 끝나면 설정을 다시 바꿀 수 있고 새로 추가한 파일을 기다린다", async () => {
    await startWith(["C:\\v\\a.mp4"]);
    await settle(() => tauri.converts[0].resolve({ output: "C:\\v\\a.mp3", copied: false }));
    expect(startButton().textContent).toBe("변환 시작 (0개)");
    expect((startButton() as HTMLButtonElement).disabled).toBe(true);
    expect(formatSelect().disabled).toBe(false);

    await drop("C:\\v\\b.mp4");
    expect(statusOf("b.mp4")).toBe("대기");
    expect(tauri.converts).toHaveLength(1);
    expect(startButton().textContent).toBe("변환 시작 (1개)");
    expect((startButton() as HTMLButtonElement).disabled).toBe(false);
  });

  test.each([
    [{ percent: 42.7, speed: 1.53 }, "42%", "1.5배속", "42.7"],
    [{ percent: 99.99, speed: 9.96 }, "99%", "10.0배속", "99.99"],
    [{ percent: 0, speed: 10 }, "0%", "10배속", "0"],
    [{ percent: null, speed: 52.5 }, "변환 중", "53배속", null],
    [{ percent: 50, speed: null }, "50%", null, "50"],
  ])("진행 보고 %o", async (progress, status, speed, valueNow) => {
    await startWith(["C:\\v\\a.mp4"]);
    await settle(() => tauri.converts[0].progress(progress));
    expect(statusOf("a.mp4")).toBe(status);
    expect(speedOf("a.mp4")).toBe(speed);
    const bar = screen.getByRole("progressbar", { name: "a.mp4 변환 진행률" });
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(bar.getAttribute("aria-valuenow")).toBe(valueNow);
  });

  test.each([
    [50, 40, [34, 35, 36, 37, 38, 39, 40, 41]],
    [42.7, 34, [28, 29, 30, 31, 32, 33, 34, 35]],
    [0, 0, [0, 1]],
    [100, 80, [74, 75, 76, 77, 78, 79]],
  ])("파형: %d%%면 %d개를 채우고 경계 근처 막대만 뛴다", async (percent, filled, live) => {
    await startWith(["C:\\v\\a.mp4"]);
    await settle(() => tauri.converts[0].progress({ percent, speed: 3 }));
    expect(bars("a.mp4")).toHaveLength(80);
    expect(bars("a.mp4", ".on")).toHaveLength(filled);
    expect(liveIndices("a.mp4")).toEqual(live);
    expect(wave("a.mp4").className).toBe("wave wave-converting");
    expect(wave("a.mp4").getAttribute("aria-hidden")).toBe("true");
  });

  it("파형: 길이를 모르면 모든 막대가 뛴다", async () => {
    await startWith(["C:\\v\\a.mp4"]);
    await settle(() => tauri.converts[0].progress({ percent: null, speed: 3 }));
    expect(bars("a.mp4", ".on")).toHaveLength(0);
    expect(liveIndices("a.mp4")).toHaveLength(80);
  });

  test.each([
    [null, "0.72s"],
    [0.5, "1s"],
    [2, "1s"],
    [2.01, "0.72s"],
    [8, "0.72s"],
    [30, "0.52s"],
    [100, "0.38s"],
    [100.5, "0.27s"],
  ])("파형 박자: %s배속이면 %s", async (speed, beat) => {
    await startWith(["C:\\v\\a.mp4"]);
    await settle(() => tauri.converts[0].progress({ percent: 10, speed }));
    expect(wave("a.mp4").style.getPropertyValue("--beat")).toBe(beat);
    expect(wave("a.mp4").style.getPropertyValue("--bars")).toBe("80");
  });

  it("같은 파일은 언제나 같은 파형 모양이다", async () => {
    await renderApp();
    await drop("C:\\v\\a.mp4", "C:\\v\\b.mp4");
    const heights = (name: string) =>
      [...bars(name)].map((b) => (b as HTMLElement).style.getPropertyValue("--h"));
    const first = heights("a.mp4");
    expect(first).not.toEqual(heights("b.mp4"));
    for (const h of first) expect(Number(h)).toBeGreaterThanOrEqual(0.1);
    for (const h of first) expect(Number(h)).toBeLessThanOrEqual(1);
    expect(wave("a.mp4").className).toBe("wave wave-queued");
    expect(wave("a.mp4").style.getPropertyValue("--beat")).toBe("0.72s");
    expect(row("a.mp4").querySelector(".job-wave")!.hasAttribute("role")).toBe(false);
  });

  test.each([
    [true, "무손실 복사 완료"],
    [false, "완료"],
  ])("완료: copied=%s면 %s", async (copied, status) => {
    await startWith(["C:\\v\\a.mp4"]);
    await settle(() => tauri.converts[0].resolve({ output: "D:\\out\\a.m4a", copied }));
    expect(statusOf("a.mp4")).toBe(status);
    expect(row("a.mp4").className).toBe("job job-done");
    expect(bars("a.mp4", ".on")).toHaveLength(80);
    expect(bars("a.mp4", ".live")).toHaveLength(0);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("완료 항목은 폴더에서 보기와 목록에서 제거를 제공한다", async () => {
    await startWith(["C:\\v\\a.mp4"]);
    await settle(() => tauri.converts[0].resolve({ output: "D:\\out\\a.mp3", copied: false }));
    const actions = within(row("a.mp4"));
    expect(actions.queryByRole("button", { name: "취소" })).toBeNull();

    await click(actions.getByRole("button", { name: "폴더에서 보기" }));
    expect(tauri.revealItemInDir).toHaveBeenCalledWith("D:\\out\\a.mp3");
    expect(notice()).toBeNull();

    tauri.revealItemInDir.mockRejectedValueOnce("denied");
    await click(actions.getByRole("button", { name: "폴더에서 보기" }));
    expect(notice()).toBe("폴더를 열 수 없습니다: denied");

    await click(actions.getByRole("button", { name: "목록에서 제거" }));
    expect(rowNames()).toEqual([]);
    expect(screen.getByText("비어 있음")).toBeTruthy();
  });

  test.each([
    [{ kind: "noAudioStream" }, "오디오 트랙이 없는 영상입니다"],
    [{ kind: "failed", message: "Invalid data found" }, "Invalid data found"],
    ["ffmpeg crashed", "ffmpeg crashed"],
    [{ message: "no kind" }, "[object Object]"],
  ])("실패 %o는 메시지 %s를 보여 준다", async (error, message) => {
    await startWith(["C:\\v\\a.mp4"]);
    await settle(() => tauri.converts[0].reject(error));
    expect(statusOf("a.mp4")).toBe("실패");
    expect(row("a.mp4").className).toBe("job job-failed");
    expect(row("a.mp4").querySelector(".job-error")!.textContent).toBe(message);
    expect(bars("a.mp4", ".on")).toHaveLength(0);
  });

  it("대기 중인 항목 취소는 Rust를 부르지 않는다", async () => {
    await startWith(["C:\\v\\a.mp4", "C:\\v\\b.mp4", "C:\\v\\c.mp4"]);
    await click(within(row("c.mp4")).getByRole("button", { name: "취소" }));
    expect(statusOf("c.mp4")).toBe("취소됨");
    expect(row("c.mp4").className).toBe("job job-canceled");
    expect(tauri.invocations("cancel")).toEqual([]);

    await settle(() => tauri.converts[0].resolve({ output: "C:\\v\\a.mp3", copied: false }));
    expect(tauri.converts).toHaveLength(2);
  });

  it("변환 중인 항목 취소는 Rust에 알리고, 취소 결과가 오면 취소됨으로 바꾼다", async () => {
    await startWith(["C:\\v\\a.mp4", "C:\\v\\b.mp4", "C:\\v\\c.mp4"]);
    await click(within(row("b.mp4")).getByRole("button", { name: "취소" }));
    expect(tauri.invocations("cancel")).toEqual([{ id: 2 }]);
    expect(statusOf("b.mp4")).toBe("변환 중");

    await settle(() => tauri.converts[1].reject({ kind: "canceled" }));
    expect(statusOf("b.mp4")).toBe("취소됨");
    expect(row("b.mp4").querySelector(".job-error")).toBeNull();
    expect(tauri.converts.map((c) => c.payload.id)).toEqual([1, 2, 3]);
  });

  it("완료 항목 지우기는 끝난 항목만 지운다", async () => {
    await startWith(["C:\\v\\a.mp4", "C:\\v\\b.mp4", "C:\\v\\c.mp4", "C:\\v\\d.mp4"]);
    await click(within(row("d.mp4")).getByRole("button", { name: "취소" }));
    await settle(() => tauri.converts[0].reject({ kind: "failed", message: "x" }));
    expect(rowNames().map(statusOf)).toEqual(["실패", "변환 중", "변환 중", "취소됨"]);
    expect(within(row("b.mp4")).queryByRole("button", { name: "목록에서 제거" })).toBeNull();

    await click(screen.getByRole("button", { name: "완료 항목 지우기" }));
    expect(rowNames()).toEqual(["b.mp4", "c.mp4"]);
    expect(
      (screen.getByRole("button", { name: "완료 항목 지우기" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("화면 전체: 진행 중 상태", async () => {
    const { asFragment } = await startWith(
      ["C:\\v\\a.mp4", "C:\\v\\b.mp4", "C:\\v\\c.mp4", "C:\\v\\note.txt"],
      { format: "flac", bitrate: 128, outputDir: "D:\\out" },
    );
    await settle(() => tauri.converts[0].progress({ percent: 42.7, speed: 1.53 }));
    await settle(() => tauri.converts[1].progress({ percent: null, speed: 52.5 }));
    await drag({ type: "enter", paths: [] });
    expect(asFragment()).toMatchSnapshot();
  });

  it("화면 전체: 끝난 상태", async () => {
    const { asFragment } = await startWith([
      "C:\\v\\a.mp4",
      "C:\\v\\b.mp4",
      "C:\\v\\c.mp4",
      "C:\\v\\d.mp4",
    ]);
    await settle(() => tauri.converts[0].resolve({ output: "C:\\v\\a.mp3", copied: true }));
    await settle(() => tauri.converts[1].reject({ kind: "noAudioStream" }));
    await settle(() => tauri.converts[2].resolve({ output: "C:\\v\\c.mp3", copied: false }));
    await settle(() => tauri.converts[3].reject({ kind: "canceled" }));
    expect(asFragment()).toMatchSnapshot();
  });
});
