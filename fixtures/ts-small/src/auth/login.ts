import Repo from "../db/repo";
import { capitalize as cap } from "../util";

export function login(repo: Repo, id: string): string {
  const user = repo.findById(id);
  if (!user) {
    throw new Error("unknown user " + id);
  }
  return greet(user.name);
}

function greet(name: string): string {
  return "Welcome, " + cap(name);
}
