import { createContext, useContext } from "react";
import type { Profile, Workspace } from "./lib/types";

export type AppCtx = {
  user: Profile;
  ws: Workspace;
  reload: () => Promise<void>;
  setUser: (p: Profile) => void;
  go: (path: string) => void;
  notify: (message: string, tone?: "success" | "error") => void;
};

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppContext");
  return ctx;
}

/** Runs an async action, reloads the workspace on success and reports errors as a toast. */
export async function act<T>(ctx: AppCtx, fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const out = await fn();
    await ctx.reload();
    if (success) ctx.notify(success, "success");
    return out;
  } catch (e) {
    ctx.notify(e instanceof Error ? e.message : String(e), "error");
    return undefined;
  }
}
