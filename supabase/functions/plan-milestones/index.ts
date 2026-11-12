// AI milestone planning for MilestonePay, using Claude.
// Secrets: ANTHROPIC_API_KEY (required); PLAN_MODEL (optional, default claude-opus-5-5);
//          PLAN_EFFORT (optional: low | medium | high, default medium).
// Action: generate { title, brief, budgetCents } -> { summary, milestones[], source: "claude" }.
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { claudeLlm, type ClaudeClient } from "../_shared/claude.ts";
import { planActions } from "../_shared/plan.ts";
import { serve } from "../_shared/serve.ts";

const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
const effort = (Deno.env.get("PLAN_EFFORT") || "medium") as "low" | "medium" | "high";
const llm = apiKey
  ? claudeLlm(new Anthropic({ apiKey, timeout: 110_000, maxRetries: 1 }) as unknown as ClaudeClient, {
      model: Deno.env.get("PLAN_MODEL") || "claude-opus-5-5",
      effort,
    })
  : undefined;

serve(planActions, () => ({ llm }));
