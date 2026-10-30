import { Panel, type ReactFlowState, useReactFlow, useStore } from "@xyflow/react";
import { type MouseEvent, memo } from "react";

import type { MinimapRect } from "./minimapRects";
import { cameraDuration } from "./motion";

const MAX_WIDTH = 200;
const MAX_HEIGHT = 140;

interface MinimapProps {
  rects: MinimapRect[];
  width: number;
  height: number;
}

/**
 * Overview: modules in their identity colours, files as grey blocks, the viewport as an
 * accent rectangle. Unlike React Flow's MiniMap it never draws rows, and it redraws its
 * shapes only when the layout changes; panning updates just the viewport rectangle.
 * Click to centre the map there.
 */
export function Minimap({ rects, width, height }: MinimapProps) {
  const scale = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
  const rf = useReactFlow();
  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    void rf.setCenter((e.clientX - box.left) / scale, (e.clientY - box.top) / scale, {
      zoom: rf.getZoom(),
      duration: cameraDuration(180),
    });
  };
  return (
    <Panel position="bottom-right" className="gv-minimap">
      <svg
        width={Math.ceil(width * scale)}
        height={Math.ceil(height * scale)}
        role="img"
        aria-label="Minimap"
        onClick={onClick}
      >
        <Shapes rects={rects} scale={scale} />
        <Viewport scale={scale} />
      </svg>
    </Panel>
  );
}

const Shapes = memo(function Shapes({ rects, scale }: { rects: MinimapRect[]; scale: number }) {
  return (
    <g transform={`scale(${String(scale)})`}>
      {rects.map((r) =>
        r.color !== undefined ? (
          <rect
            key={r.id}
            className="gv-mm-module"
            x={r.x}
            y={r.y}
            width={r.width}
            height={r.height}
            rx={12}
            style={{ fill: r.color }}
          />
        ) : (
          <rect
            key={r.id}
            className="gv-mm-file"
            x={r.x}
            y={r.y}
            width={r.width}
            height={r.height}
            rx={6}
          />
        ),
      )}
    </g>
  );
});

interface ViewportBox {
  x: number;
  y: number;
  zoom: number;
  w: number;
  h: number;
}

const viewportSelector = (s: ReactFlowState): ViewportBox => ({
  x: s.transform[0],
  y: s.transform[1],
  zoom: s.transform[2],
  w: s.width,
  h: s.height,
});
const sameViewport = (a: ViewportBox, b: ViewportBox) =>
  a.x === b.x && a.y === b.y && a.zoom === b.zoom && a.w === b.w && a.h === b.h;

function Viewport({ scale }: { scale: number }) {
  const v = useStore(viewportSelector, sameViewport);
  return (
    <rect
      className="gv-mm-viewport"
      x={(-v.x / v.zoom) * scale}
      y={(-v.y / v.zoom) * scale}
      width={(v.w / v.zoom) * scale}
      height={(v.h / v.zoom) * scale}
    />
  );
}
