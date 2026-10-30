import type { User } from "../types";

export default class Repo {
  private readonly users = new Map<string, User>();

  constructor(seed: User[] = []) {
    seed.forEach((user) => this.save(user));
  }

  findById(id: string): User | undefined {
    return this.users.get(id);
  }

  save(user: User): void {
    this.users.set(user.id, user);
  }
}
