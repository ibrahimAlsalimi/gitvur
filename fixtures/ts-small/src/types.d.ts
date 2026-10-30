export interface User {
  id: string;
  name: string;
}

export declare function hashPassword(password: string): string;

export declare class AuditLog {
  record(event: string): void;
}
