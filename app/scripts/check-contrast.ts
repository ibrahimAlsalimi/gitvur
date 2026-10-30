/**
 * Checks the colour rules of src/styles/tokens.css in both themes:
 *  - text tokens ≥ 4.5:1 on every surface they sit on;
 *  - kind, status, provenance, diff and module colours ≥ 3:1 against --gv-bg-surface;
 *  - module colours distinguishable from each other (OKLab distance) and clear of the
 *    status and diff hues;
 *  - the two copies of the dark theme (media query and [data-theme="dark"]) are identical.
 * Run: `pnpm check:contrast`. Exits 1 on any failure.
 */
import { readFileSync } from "node:fs";

type Tokens = Map<string, string>;

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function block(selector: string): Tokens {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (; end < css.length; end++) {
    if (css[end] === "{") depth++;
    if (css[end] === "}" && --depth === 0) break;
  }
  const tokens: Tokens = new Map();
  for (const m of css.slice(open + 1, end).matchAll(/(--gv-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens.set(m[1] as string, (m[2] as string).toLowerCase());
  }
  return tokens;
}

const light = block(":root {");
const darkMedia = block(':root:not([data-theme="light"])');
const darkForced = block(':root[data-theme="dark"]');
const dark: Tokens = new Map([...light, ...darkForced]);

// ---- colour maths ------------------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map(linear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const chroma = (hex: string) => Math.hypot(oklab(hex)[1], oklab(hex)[2]);
const hue = (hex: string) =>
  ((Math.atan2(oklab(hex)[2], oklab(hex)[1]) * 180) / Math.PI + 360) % 360;
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const distance = (a: string, b: string) => {
  const [p, q] = [oklab(a), oklab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

// ---- rules -------------------------------------------------------------------------

const TEXT = ["--gv-text-primary", "--gv-text-secondary", "--gv-text-tertiary"];
const SURFACES = ["--gv-bg-canvas", "--gv-bg-surface", "--gv-bg-surface-raised", "--gv-bg-sunken"];
const MODULES = Array.from({ length: 8 }, (_, i) => `--gv-module-${String(i + 1)}`);
const MEANING = [
  ...["project", "module", "file", "class", "function"].map((k) => `--gv-kind-${k}`),
  ...["documented", "stale", "undocumented", "error"].map((s) => `--gv-status-${s}`),
  ...["syntactic", "semantic", "ai"].map((p) => `--gv-prov-${p}`),
  ...["added", "removed", "modified", "moved"].map((d) => `--gv-diff-${d}`),
  ...MODULES,
];
const RESERVED_HUES = [
  ...["documented", "stale", "error"].map((s) => `--gv-status-${s}`),
  ...["added", "removed", "modified", "moved"].map((d) => `--gv-diff-${d}`),
];
const MIN_TEXT = 4.5;
const MIN_MEANING = 3;
const MIN_MODULE_DISTANCE = 0.06;
const MIN_HUE_GAP = 15;

const failures: string[] = [];
let checks = 0;
const get = (t: Tokens, name: string) => {
  const v = t.get(name);
  if (v === undefined) throw new Error(`missing token ${name}`);
  return v;
};
const fmt = (n: number) => n.toFixed(2);

for (const [name, tokens] of [
  ["light", light],
  ["dark", dark],
] as const) {
  for (const text of TEXT) {
    for (const surface of SURFACES) {
      checks++;
      const c = contrast(get(tokens, text), get(tokens, surface));
      if (c < MIN_TEXT)
        failures.push(`${name}: ${text} on ${surface} = ${fmt(c)}:1 (< ${String(MIN_TEXT)})`);
    }
  }
  checks++;
  const onAccent = contrast(get(tokens, "--gv-text-on-accent"), get(tokens, "--gv-accent"));
  if (onAccent < MIN_TEXT)
    failures.push(`${name}: --gv-text-on-accent on --gv-accent = ${fmt(onAccent)}:1`);

  for (const token of MEANING) {
    checks++;
    const c = contrast(get(tokens, token), get(tokens, "--gv-bg-surface"));
    if (c < MIN_MEANING)
      failures.push(
        `${name}: ${token} on --gv-bg-surface = ${fmt(c)}:1 (< ${String(MIN_MEANING)})`,
      );
  }

  for (let i = 0; i < MODULES.length; i++) {
    const a = MODULES[i] as string;
    for (const b of MODULES.slice(i + 1)) {
      checks++;
      const d = distance(get(tokens, a), get(tokens, b));
      if (d < MIN_MODULE_DISTANCE)
        failures.push(`${name}: ${a} vs ${b} too similar (ΔOK ${d.toFixed(3)})`);
    }
    for (const reserved of RESERVED_HUES) {
      const r = get(tokens, reserved);
      if (chroma(r) < 0.04) continue;
      checks++;
      const gap = hueGap(hue(get(tokens, a)), hue(r));
      if (gap < MIN_HUE_GAP)
        failures.push(`${name}: ${a} reuses the hue of ${reserved} (${gap.toFixed(0)}° apart)`);
    }
  }
}

checks++;
for (const [k, v] of darkForced) {
  if (darkMedia.get(k) !== v)
    failures.push(`dark theme copies differ at ${k}: ${String(darkMedia.get(k))} vs ${v}`);
}
for (const k of darkMedia.keys())
  if (!darkForced.has(k)) failures.push(`dark media block has extra ${k}`);

if (process.argv.includes("--report")) {
  for (const [name, tokens] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    console.log(`\n${name}`);
    for (const t of [...MEANING, ...TEXT]) {
      const v = get(tokens, t);
      console.log(
        `  ${t.padEnd(28)} ${v}  ${fmt(contrast(v, get(tokens, "--gv-bg-surface")))}:1  hue ${hue(v).toFixed(0).padStart(3)}  C ${chroma(v).toFixed(3)}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`check:contrast — ${String(failures.length)} of ${String(checks)} checks failed:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`check:contrast — all ${String(checks)} checks passed (light and dark).`);
