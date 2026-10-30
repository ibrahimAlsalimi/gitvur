import { store } from "../storage/repository";

export function normalize(item: string) {
  return store(item.trim());
}
