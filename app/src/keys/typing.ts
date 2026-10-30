/** Keys typed into a field, or inside an open dialog, are not app shortcuts. */
export function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return el?.closest("input, textarea, select, [contenteditable='true'], dialog[open]") != null;
}
