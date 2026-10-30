import { EventEmitter } from "node:events";
import { validate } from "../domain/rules";
import { onSaved } from "../storage/events";

const bus = new EventEmitter();

export function submit(item: string) {
  const value = validate(item);
  bus.on("saved", onSaved);
  return value;
}
