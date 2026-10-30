import type { EdgeProps } from "@xyflow/react";
import { memo } from "react";

import type { MapEdge } from "./types";

/** A thin vertical line from the project header down to a top-rank module. */
export const ConnectorEdge = memo(function ConnectorEdge({
  sourceY,
  targetX,
  targetY,
}: EdgeProps<MapEdge>) {
  return (
    <path
      className="gv-connector"
      d={`M ${String(targetX)} ${String(sourceY)} L ${String(targetX)} ${String(targetY)}`}
    />
  );
});
