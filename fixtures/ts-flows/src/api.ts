import { submit } from "./service/orders";

export function handle(item: string) {
  return submit(item);
}

export const routes = { "POST /orders": handle };
