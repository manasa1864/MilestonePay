import type { CriterionDraft, CriterionType, MilestoneDraft } from "./types";

export const criterionLabels: Record<CriterionType, { label: string; hint: string }> = {
  CI_PASSES: { label: "CI passes", hint: "All GitHub check runs on the latest commit succeed." },
  FILE_EXISTS: { label: "File exists", hint: "A specific file exists in the repository." },
  PR_MERGED: { label: "PR merged", hint: "At least one pull request is merged into the default branch." },
  MANUAL_REVIEW: { label: "Client review", hint: "You judge this yourself when reviewing the submission." },
};

export function newCriterion(type: CriterionType, weight = 0): CriterionDraft {
  const description = {
    CI_PASSES: "Continuous integration passes on the submitted commit",
    FILE_EXISTS: "Required file is present in the repository",
    PR_MERGED: "Work is merged to the default branch through a pull request",
    MANUAL_REVIEW: "Implementation meets the quality expectations in the brief",
  }[type];
  return { type, description, weight, config: type === "FILE_EXISTS" ? { path: "README.md" } : {} };
}

type Phase = { title: string; description: string; criteria: CriterionDraft[] };

const middle = (title: string, description: string, file?: string): Phase => ({
  title,
  description,
  criteria: [
    newCriterion("CI_PASSES", file ? 30 : 40),
    newCriterion("PR_MERGED", 30),
    ...(file ? [{ ...newCriterion("FILE_EXISTS", 10), description: `${file} is included`, config: { path: file } }] : []),
    newCriterion("MANUAL_REVIEW", 30),
  ],
});

/**
 * Suggests a 2–5 milestone plan from the brief using keyword detection.
 * It is a starting point; every field stays editable before funding.
 */
export function suggestPlan(brief: string): MilestoneDraft[] {
  const t = brief.toLowerCase();
  const has = (...words: string[]) => words.some((w) => new RegExp(`\\b${w}`).test(t));

  const phases: Phase[] = [{
    title: "Project foundation & setup",
    description: "Repository structure, tooling, continuous integration and a README describing how to run the project.",
    criteria: [
      { ...newCriterion("CI_PASSES", 50), description: "A CI workflow runs and passes on the default branch" },
      { ...newCriterion("FILE_EXISTS", 50), description: "README with setup instructions exists", config: { path: "README.md" } },
    ],
  }];

  if (has("api", "backend", "server", "database", "endpoint", "rest", "graphql", "postgres", "sql"))
    phases.push(middle("Core API & data model", "Data model, persistence and the core endpoints described in the brief.", has("openapi", "swagger") ? "openapi.yaml" : undefined));
  if (has("frontend", "ui", "react", "interface", "dashboard", "website", "web app", "page", "screen", "mobile"))
    phases.push(middle("User interface", "Screens and interactions described in the brief, wired to real data."));
  if (has("auth", "login", "sign", "payment", "checkout", "stripe", "paypal", "integration", "oauth", "webhook"))
    phases.push(middle("Authentication & integrations", "Sign-in, third-party integrations and payment flows from the brief."));
  if (phases.length === 1) phases.push(middle("Core implementation", "The main functionality described in the brief."));

  phases.splice(4);
  phases.push({
    title: "Testing, documentation & handover",
    description: "Automated tests, final documentation and a clean, merged default branch ready for handover.",
    criteria: [newCriterion("CI_PASSES", 40), newCriterion("PR_MERGED", 30), { ...newCriterion("MANUAL_REVIEW", 30), description: "Documentation and tests are sufficient for handover" }],
  });

  const n = phases.length;
  const edge = n === 2 ? 50 : 20;
  const mid = n - 2;
  const midEach = mid ? Math.floor((100 - edge * 2) / mid) : 0;
  const midRemainder = mid ? 100 - edge * 2 - midEach * mid : 0;
  return phases.map((p, i) => ({
    ...p,
    dueDate: "",
    percent: i === 0 || i === n - 1 ? edge : midEach + (i === n - 2 ? midRemainder : 0),
  }));
}

export function rebalanceWeights(criteria: CriterionDraft[]): CriterionDraft[] {
  if (!criteria.length) return criteria;
  const each = Math.floor(100 / criteria.length);
  return criteria.map((c, i) => ({ ...c, weight: i === criteria.length - 1 ? 100 - each * (criteria.length - 1) : each }));
}
