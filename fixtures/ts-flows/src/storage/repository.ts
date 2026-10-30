import { commit } from "./driver";

export function store(item: string) {
  return commit(item);
}
