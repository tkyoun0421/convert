import type { JobStatus } from "./jobs";

export function statusText(status: JobStatus): string {
  switch (status.kind) {
    case "queued":
      return "대기";
    case "converting":
      return status.percent === null ? "변환 중" : `${Math.floor(status.percent)}%`;
    case "done":
      return status.copied ? "무손실 복사 완료" : "완료";
    case "failed":
      return "실패";
    case "canceled":
      return "취소됨";
  }
}

export function formatSpeed(speed: number): string {
  return `${speed < 10 ? speed.toFixed(1) : Math.round(speed)}배속`;
}

export function skippedNotice(skipped: number): string | null {
  return skipped > 0 ? `영상 파일이 아닌 ${skipped}개 파일은 건너뛰었습니다.` : null;
}
