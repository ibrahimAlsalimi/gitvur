/** True when the user asked the OS for reduced motion. */
const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Camera animation length in ms: `ms`, or none with reduced motion. */
export const cameraDuration = (ms: number) => (reducedMotion() ? 0 : ms);
