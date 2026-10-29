import * as views from "./views";
import { Session } from "./auth";

export const handler = (data: unknown): string => {
  const view = pickView(data);
  return view.render(data);
};

const pickView = (data: unknown): views.JsonView | views.TextView =>
  typeof data === "string" ? new views.TextView() : new views.JsonView();

export const openSession = (userId: string): Session => new Session(userId);
