// The checks live in one shared module so the browser and the github-verify Edge Function
// run exactly the same logic.
export { parseRepoUrl, verifyRepository } from "../../supabase/functions/_shared/github-checks.ts";
export type { CheckResult, RepoRef, VerifyOutcome } from "../../supabase/functions/_shared/github-checks.ts";
