import { Panel } from "@xyflow/react";
import { useEffect, useState } from "react";

import { usePerf } from "./perf";

const fmt = (ms: number | null) => (ms === null ? "—" : `${ms.toFixed(1)} ms`);

/** Dev overlay (`?perf=1`, or Ctrl+Shift+P): FPS, rendered nodes, layout timings. */
export function PerfOverlay() {
  const perf = usePerf();
  const [fps, setFps] = useState(0);
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      frames += 1;
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        setVisible(document.querySelectorAll(".react-flow__node").length);
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <Panel position="top-right" className="gv-perf" aria-label="Performance">
      <div>{fps} fps</div>
      <div>{visible} nodes rendered</div>
      <div>first layout {fmt(perf.firstLayoutMs)}</div>
      <div>last layout {fmt(perf.lastLayoutMs)}</div>
      <div>last settle {fmt(perf.lastSettleMs)}</div>
    </Panel>
  );
}
