export function DropZone({ onPickFiles }: { onPickFiles: () => void }) {
  return (
    <section className="drop" aria-label="영상 추가">
      <span className="drop-glyph" aria-hidden>
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <div className="drop-text">
        <p className="drop-title">영상 파일을 여기로 끌어다 놓으세요</p>
        <p className="drop-formats">mp4, mkv, avi, mov, webm 등</p>
      </div>
      <button type="button" onClick={onPickFiles}>
        파일 선택…
      </button>
    </section>
  );
}
