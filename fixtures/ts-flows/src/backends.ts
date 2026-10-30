export class Cache {
  save(item: string) { return item; }
}

export class Disk {
  save(item: string) { return item; }
}

export function persistUnknown(backend: Cache | Disk, item: string) {
  return backend.save(item);
}

export function countdown(n: number): number {
  if (n <= 0) return 0;
  return countdown(n - 1);
}

const sink = new Cache();
sink.save("example");
