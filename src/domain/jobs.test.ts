import { describe, expect, it, test } from "vitest";
import {
  initialJobs,
  isVideoPath,
  jobsReducer,
  type ConvertResult,
  type JobsAction,
  type JobsState,
} from "./jobs";

function run(...actions: JobsAction[]): JobsState {
  return actions.reduce(jobsReducer, initialJobs);
}

const statuses = (state: JobsState) => state.jobs.map((job) => job.status.kind);
const settle = (result: ConvertResult): JobsAction => ({ type: "settle", id: 1, result });
const DONE: ConvertResult = { kind: "done", output: "a.mp3", copied: true };

describe("jobsReducer", () => {
  it("추가한 경로마다 이어지는 번호와 파일 이름을 붙이고 중복은 버린다", () => {
    const state = run(
      { type: "add", paths: ["C:\\v\\a.mp4", "/home/u/b.mkv", "C:\\v\\a.mp4"] },
      { type: "add", paths: ["/home/u/b.mkv", "c.avi"] },
    );
    expect(state).toEqual({
      nextId: 4,
      jobs: [
        { id: 1, input: "C:\\v\\a.mp4", name: "a.mp4", status: { kind: "queued" } },
        { id: 2, input: "/home/u/b.mkv", name: "b.mkv", status: { kind: "queued" } },
        { id: 3, input: "c.avi", name: "c.avi", status: { kind: "queued" } },
      ],
    });
  });

  it("지운 뒤에도 번호를 다시 쓰지 않는다", () => {
    const state = run(
      { type: "add", paths: ["a.mp4"] },
      { type: "cancel", id: 1 },
      { type: "remove", id: 1 },
      { type: "add", paths: ["a.mp4"] },
    );
    expect(state.jobs.map((j) => j.id)).toEqual([2]);
  });

  it("대기 → 변환 중 → 완료 순서로만 바뀐다", () => {
    const add: JobsAction = { type: "add", paths: ["a.mp4"] };
    expect(run(add, { type: "progress", id: 1, percent: 5, speed: 1 }).jobs[0].status).toEqual({
      kind: "queued",
    });
    expect(run(add, settle(DONE)).jobs[0].status).toEqual({ kind: "queued" });

    const started = run(add, { type: "start", id: 1 });
    expect(started.jobs[0].status).toEqual({ kind: "converting", percent: null, speed: null });
    expect(jobsReducer(started, { type: "start", id: 1 })).toEqual(started);

    const progressed = jobsReducer(started, { type: "progress", id: 1, percent: 5, speed: 2 });
    expect(progressed.jobs[0].status).toEqual({ kind: "converting", percent: 5, speed: 2 });

    const done = jobsReducer(progressed, settle(DONE));
    expect(done.jobs[0].status).toEqual({ kind: "done", output: "a.mp3", copied: true });
    expect(jobsReducer(done, settle({ kind: "failed", message: "x" }))).toEqual(done);
    expect(jobsReducer(done, settle({ kind: "canceled" }))).toEqual(done);
  });

  it("취소는 대기 항목에만, 취소 결과는 변환 중 항목에만 적용된다", () => {
    const add: JobsAction = { type: "add", paths: ["a.mp4"] };
    const start: JobsAction = { type: "start", id: 1 };
    expect(statuses(run(add, { type: "cancel", id: 1 }))).toEqual(["canceled"]);
    expect(statuses(run(add, settle({ kind: "canceled" })))).toEqual(["queued"]);
    expect(statuses(run(add, start, { type: "cancel", id: 1 }))).toEqual(["converting"]);
    expect(statuses(run(add, start, settle({ kind: "canceled" })))).toEqual(["canceled"]);
    expect(run(add, start, settle({ kind: "failed", message: "x" })).jobs[0].status).toEqual({
      kind: "failed",
      message: "x",
    });
  });

  it("제거와 완료 항목 지우기는 끝난 항목만 없앤다", () => {
    const state = run(
      { type: "add", paths: ["a.mp4", "b.mp4", "c.mp4", "d.mp4"] },
      { type: "start", id: 1 },
      settle({ kind: "done", output: "a.mp3", copied: false }),
      { type: "start", id: 2 },
      { type: "cancel", id: 3 },
    );
    expect(statuses(state)).toEqual(["done", "converting", "canceled", "queued"]);
    expect(statuses(jobsReducer(state, { type: "remove", id: 2 }))).toEqual(statuses(state));
    expect(statuses(jobsReducer(state, { type: "remove", id: 4 }))).toEqual(statuses(state));
    expect(statuses(jobsReducer(state, { type: "remove", id: 1 }))).toEqual([
      "converting",
      "canceled",
      "queued",
    ]);
    expect(jobsReducer(state, { type: "clearFinished" })).toEqual({
      nextId: 5,
      jobs: [state.jobs[1], state.jobs[3]],
    });
  });

  it("없는 번호를 가리키는 동작은 아무것도 바꾸지 않는다", () => {
    const state = run({ type: "add", paths: ["a.mp4"] });
    expect(jobsReducer(state, { type: "start", id: 9 })).toEqual(state);
  });
});

describe("isVideoPath", () => {
  test.each([
    ["C:\\v\\a.mp4", true],
    ["/home/u/A.MKV", true],
    ["clip.final.webm", true],
    ["x.3gp", true],
    [".mp4", true],
    ["C:\\v\\a.txt", false],
    ["C:\\v.mp4\\noext", false],
    ["a.mp4.part", false],
    ["", false],
  ])("%s → %s", (path, expected) => {
    expect(isVideoPath(path)).toBe(expected);
  });
});
