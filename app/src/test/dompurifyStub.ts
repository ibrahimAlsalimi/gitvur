/**
 * Test-only stand-in for DOMPurify, which needs a DOM that Vitest's Node environment lacks.
 * Mermaid uses it only to sanitise label text, so a pass-through lets the real flowchart
 * grammar run in `src/flows/mermaid.test.ts`. Never bundled into the app.
 */
const purify = {
  addHook: () => undefined,
  removeHook: () => undefined,
  removeHooks: () => undefined,
  removeAllHooks: () => undefined,
  sanitize: (text: string) => text,
  isSupported: true,
};

export default Object.assign(() => purify, purify);
