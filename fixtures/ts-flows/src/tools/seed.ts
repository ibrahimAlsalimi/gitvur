import { submit } from "../service/orders";

export function seed() {
  return submit("seed");
}

seed();
