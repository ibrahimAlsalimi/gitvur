import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
export type ArchitectureEdge = Edge<{ offset: number }, "architectureRelationship">;
/** Separate parallel facts so imports, calls and enriched labels never overprint each other. */
export function RelationshipEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  label,
  markerEnd,
  style,
  selected,
}: EdgeProps<ArchitectureEdge>) {
  const offset = data?.offset ?? 0;
  const bend = Math.max(60, Math.abs(targetX - sourceX) / 3);
  const path = `M ${String(sourceX)} ${String(sourceY)} C ${String(sourceX + bend)} ${String(sourceY + offset)}, ${String(targetX - bend)} ${String(targetY + offset)}, ${String(targetX)} ${String(targetY)}`;
  return (
    <>
      <BaseEdge
        path={path}
        {...(markerEnd ? { markerEnd } : {})}
        {...(style ? { style } : {})}
        interactionWidth={24}
      />
      <EdgeLabelRenderer>
        <div
          className="gv-architecture-edge-label"
          data-selected={selected}
          style={{
            transform: `translate(-50%, -50%) translate(${String((sourceX + targetX) / 2)}px, ${String((sourceY + targetY) / 2 + offset * 0.75)}px)`,
          }}
        >
          {label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
