/**
 * Arrow markers for relationship lines, referenced as url(#gv-arrow-<provenance>), or
 * url(#gv-arrow-added|removed) for changed lines in the Changes lens.
 */
export function EdgeMarkers() {
  return (
    <svg className="gv-markers" aria-hidden="true" width="0" height="0">
      <defs>
        {(["syntactic", "semantic", "added", "removed"] as const).map((p) => (
          <marker
            key={p}
            id={`gv-arrow-${p}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className={`gv-marker gv-marker-${p}`} />
          </marker>
        ))}
        <marker
          id="gv-arrow-ai"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 1 1 L 9 5 L 1 9" className="gv-marker gv-marker-ai" />
        </marker>
      </defs>
    </svg>
  );
}
