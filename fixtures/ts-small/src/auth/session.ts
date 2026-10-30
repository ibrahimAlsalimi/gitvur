export class Session {
  constructor(readonly userId: string) {}

  describe(): string {
    return "session for " + this.userId;
  }
}
