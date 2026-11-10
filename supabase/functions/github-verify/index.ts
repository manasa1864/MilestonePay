// Server-side GitHub checks for MilestonePay submissions.
// Secret: GITHUB_TOKEN (a fine-grained token with read-only access is enough).
// Actions: check (preview results), submit (re-run checks and record the submission).
import { githubActions } from "../_shared/actions.ts";
import { serve } from "../_shared/serve.ts";

const githubToken = Deno.env.get("GITHUB_TOKEN") || undefined;

serve(githubActions, () => ({ githubToken }));
