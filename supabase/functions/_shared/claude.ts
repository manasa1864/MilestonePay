/**
 * One structured-output request to the Claude API through the official Anthropic SDK.
 * The SDK client is passed in (Deno imports it from npm; tests pass their own), so this
 * file has no SDK import of its own.
 */
import { ActionError, type Llm } from "./actions.ts";

/** The part of the Anthropic SDK client this file uses. */
export type ClaudeClient = {
  beta: { messages: { create(params: Record<string, unknown>): Promise<ClaudeMessage> } };
};
type ClaudeMessage = {
  stop_reason: string | null;
  content: Array<{ type: string; text?: string }>;
};

export type ClaudeOptions = {
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
};

/**
 * Builds the `llm` dependency used by generatePlan.
 * - Structured outputs (`output_config.format`) guarantee JSON that matches the schema.
 * - Thinking is left at the model's default (adaptive); effort is set explicitly.
 * - Server-side fallbacks ("default") let the API retry a declined request on another model.
 *   Haiku has no server-side fallback, so it is skipped there.
 */
export function claudeLlm(client: ClaudeClient, opts: ClaudeOptions): Llm {
  const fallbacks = !/haiku/i.test(opts.model);
  return async (system, user, schema) => {
    let res: ClaudeMessage;
    try {
      res = await client.beta.messages.create({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 16000,
        ...(fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
        output_config: { effort: opts.effort ?? "medium", format: { type: "json_schema", schema } },
        system,
        messages: [{ role: "user", content: user }],
      });
    } catch (e) {
      throw new ActionError(describeApiError(e), 502);
    }
    if (res.stop_reason === "refusal") throw new ActionError("Claude declined to plan this project. Try rewording the brief.", 422);
    if (res.stop_reason === "max_tokens") throw new ActionError("The plan was cut off before it finished. Try a shorter brief.", 502);
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    try {
      return JSON.parse(text);
    } catch {
      throw new ActionError("Claude's plan couldn't be read. Try again.", 502);
    }
  };
}

/** Plain-language message for an API error, based on its HTTP status. */
export function describeApiError(e: unknown): string {
  const status = (e as { status?: number })?.status;
  if (status === 401 || status === 403) return "The server's Anthropic API key was rejected. Check the ANTHROPIC_API_KEY secret.";
  if (status === 429) return "Claude is busy right now (rate limit). Wait a minute and try again.";
  if (status === 400) return `Claude couldn't take this request: ${(e as Error).message}`;
  if (status === 529 || (status && status >= 500)) return "Claude is temporarily unavailable. Try again shortly.";
  return `Couldn't reach Claude: ${e instanceof Error ? e.message : String(e)}`;
}
