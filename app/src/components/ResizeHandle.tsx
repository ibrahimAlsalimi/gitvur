import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";

/** Keyboard step in pixels. */
const STEP = 16;

interface ResizeHandleProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** +1 when dragging right grows the pane (explorer), -1 when it shrinks it (inspector). */
  direction: 1 | -1;
  onChange: (value: number) => void;
}

/** A focusable vertical separator: drag it, or use ←/→ (16px steps), Home and End. */
export function ResizeHandle({ label, value, min, max, direction, onChange }: ResizeHandleProps) {
  const start = useRef<{ x: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, value };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    onChange(start.current.value + (e.clientX - start.current.x) * direction);
  };
  const onPointerUp = () => {
    start.current = null;
    setDragging(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = { ArrowLeft: -STEP, ArrowRight: STEP }[e.key];
    if (delta !== undefined) {
      e.preventDefault();
      onChange(value + delta * direction);
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(min);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(max);
    }
  };

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-side={direction === 1 ? "start" : "end"}
      data-dragging={dragging}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}
