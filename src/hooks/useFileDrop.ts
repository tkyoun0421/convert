import { useEffect, useState } from "react";
import type { Desktop } from "../services/ports";

/** Whether files are being dragged over the window; dropped paths go to `onDrop`. */
export function useFileDrop(desktop: Desktop, onDrop: (paths: string[]) => void): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(
    () =>
      desktop.onFileDrag((drag) => {
        setDragging(drag.kind === "hover");
        if (drag.kind === "drop") onDrop(drag.paths);
      }),
    [desktop, onDrop],
  );

  return dragging;
}
