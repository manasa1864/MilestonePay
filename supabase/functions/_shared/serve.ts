// Deno-only wrapper: CORS, caller authentication and action dispatch for the Edge Functions.
import { createClient } from "npm:@supabase/supabase-js@2";
import { ActionError, type Deps } from "./actions.ts";

type Action = (d: Deps, body: Record<string, unknown>) => Promise<unknown>;

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export function serve(actions: Record<string, Action>, extraDeps: () => Partial<Deps>) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: who, error: authError } = await admin.auth.getUser(jwt);
      if (authError || !who.user) return json({ error: "Log in again." }, 401);

      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const action = actions[String(body.action ?? "")];
      if (!action) return json({ error: `Unknown action "${body.action}"` }, 400);

      const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
        const { data, error } = await admin.rpc(fn, args);
        if (error) throw new ActionError(error.message, 400);
        return data as T;
      };
      return json(await action({ rpc, actor: who.user.id, ...extraDeps() }, body));
    } catch (e) {
      const status = e instanceof ActionError ? e.status : 500;
      console.error(e);
      return json({ error: e instanceof Error ? e.message : String(e) }, status);
    }
  });
}
