export class JsonView {
  render(data: unknown): string {
    return JSON.stringify(data);
  }
}

export class TextView {
  render(data: unknown): string {
    return format(String(data));
  }
}

export function format(value: string): string;
export function format(value: number, digits: number): string;
export function format(value: string | number, digits = 2): string {
  return typeof value === "number" ? value.toFixed(digits) : value.trim();
}
