import { normalize } from "./text";

export function validate(item: string) {
  return normalize(item);
}
