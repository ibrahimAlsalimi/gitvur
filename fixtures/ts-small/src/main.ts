import Repo from "./db/repo";
import { login } from "./auth";
import { handler as handle } from "./handlers";
import { pad } from "./util";

export function main(): void {
  const repo = new Repo([{ id: "u1", name: "ada" }]);
  const greeting = login(repo, "u1");
  console.log(pad(greeting, 20));
  console.log(handle({ ok: true }));
}

main();
