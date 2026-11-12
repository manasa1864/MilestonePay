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

type Phase = { key: string; order: number; effort: number; days: number; title: string; description: string; criteria: CriterionDraft[] };
type Topic = { words: RegExp; phases: Phase[] };

const crit = (type: CriterionType, weight: number, description?: string, path?: string): CriterionDraft => ({
  ...newCriterion(type, weight),
  ...(description ? { description } : {}),
  ...(path ? { config: { path } } : {}),
});
const standard = (manual: string, file?: { what: string; path: string }): CriterionDraft[] =>
  file
    ? [crit("CI_PASSES", 30), crit("PR_MERGED", 20), crit("FILE_EXISTS", 20, file.what, file.path), crit("MANUAL_REVIEW", 30, manual)]
    : [crit("CI_PASSES", 40), crit("PR_MERGED", 30), crit("MANUAL_REVIEW", 30, manual)];
const phase = (key: string, order: number, effort: number, days: number, title: string, description: string, criteria: CriterionDraft[]): Phase =>
  ({ key, order, effort, days, title, description, criteria });

/** Project types the built-in planner recognises, with the milestones each one adds. */
const TOPICS: Topic[] = [
  { words: /\b(shop|store|e-?commerce|cart|checkout|marketplace|product catalog|inventory)/, phases: [
    phase("catalog", 20, 3, 6, "Product catalog & data", "Products, categories and inventory stored in the database, with the listing and detail views from the brief.", standard("Products, categories and search behave as described in the brief")),
    phase("checkout", 40, 3, 6, "Cart & checkout", "Cart, checkout flow and order records, including order confirmation.", standard("A test order can be placed end to end")),
  ] },
  { words: /\b(mobile|ios|android|react native|flutter|app store|play store)/, phases: [
    phase("screens", 30, 3, 7, "Core app screens", "The main screens and navigation from the brief, running on a device or emulator.", standard("Screens match the brief and work on a phone-sized device")),
    phase("device", 45, 2, 5, "Device features & release build", "Device features from the brief (notifications, camera, offline, etc.) and a signed release build.", standard("Release build installs and the device features work")),
  ] },
  { words: /\b(api|backend|server|database|endpoint|rest|graphql|postgres|mysql|mongo|sql)\b/, phases: [
    phase("api", 20, 3, 6, "Data model & API", "Database schema and the API endpoints the brief needs, with validation and error handling.", standard("Endpoints return correct data and clear errors")),
  ] },
  { words: /\b(website|web ?app|landing|frontend|front-end|react|vue|angular|svelte|next\.?js|ui|interface|portal|page)/, phases: [
    phase("ui", 30, 3, 6, "User interface", "The pages and interactions from the brief, responsive and wired to real data.", standard("Pages match the brief on desktop and mobile widths")),
  ] },
  { words: /\b(dashboard|analytics|reports?|charts?|metrics|kpi|admin panel)/, phases: [
    phase("reports", 35, 2, 5, "Dashboards & reporting", "The dashboards, charts and reports described in the brief, using real data.", standard("Numbers and charts are correct for sample data")),
  ] },
  { words: /\b(auth|log ?in|sign ?up|accounts?|roles?|permissions|oauth|sso)/, phases: [
    phase("auth", 25, 2, 4, "Accounts & access", "Sign-up, sign-in and the roles or permissions the brief describes.", standard("Each role can only see and do what the brief allows")),
  ] },
  { words: /\b(payments?|stripe|paypal|subscriptions?|billing|invoices?|razorpay)/, phases: [
    phase("payments", 40, 2, 5, "Payments integration", "Payment provider integration in test mode, including webhooks and receipts.", standard("A test payment succeeds and is recorded")),
  ] },
  { words: /\b(machine learning|ml|model|ai|llm|gpt|claude|prediction|classif|nlp|recommend|computer vision)/, phases: [
    phase("data", 20, 2, 5, "Data pipeline", "Collecting, cleaning and storing the data the model or AI feature needs.", standard("Data is cleaned and reproducible from the repository")),
    phase("model", 35, 3, 7, "Model / AI feature", "The model or AI feature from the brief, with an evaluation of how well it works.", standard("Results on sample inputs meet the brief's expectations")),
  ] },
  { words: /\b(scrap|crawl|bot|automat|cron|telegram|discord|slack bot|workflow)/, phases: [
    phase("automation", 30, 3, 6, "Automation & integrations", "The scraping, bot or automated workflow from the brief, with logging and retries.", standard("Runs on a schedule or trigger and handles failures")),
  ] },
  { words: /\b(game|unity|godot|unreal|multiplayer|level)/, phases: [
    phase("gameplay", 30, 4, 8, "Core gameplay", "The main game loop, controls and the first playable level.", standard("The playable build matches the brief's core mechanics")),
  ] },
  { words: /\b(chrome extension|browser extension|cli|command line|vs ?code extension|plugin)/, phases: [
    phase("extension", 30, 3, 6, "Extension / tool features", "The commands or extension features described in the brief, packaged for installation.", standard("Installs cleanly and each feature works as described")),
  ] },
  { words: /\b(blockchain|smart contracts?|solidity|web3|nft|token)/, phases: [
    phase("contracts", 25, 3, 7, "Smart contracts", "Contracts from the brief with tests, deployed to a test network.", standard("Contracts behave correctly on a test network")),
  ] },
  { words: /\b(chat|real-?time|websocket|messaging|notifications?)/, phases: [
    phase("realtime", 35, 2, 5, "Real-time features", "Live updates, messaging or notifications from the brief.", standard("Updates arrive instantly for two users at once")),
  ] },
  { words: /\b(deploy|docker|kubernetes|ci\/cd|infrastructure|terraform|aws|azure|gcp|hosting)/, phases: [
    phase("deploy", 50, 2, 4, "Deployment & infrastructure", "Containerised build, environment configuration and a deployed instance.", standard("The app runs at a public URL with the documented setup", { what: "Dockerfile for the deployed build", path: "Dockerfile" })),
  ] },
];

const FOUNDATION: Phase = phase("foundation", 0, 1, 4, "Project setup & foundation",
  "Repository structure, tooling, continuous integration and a README describing how to run the project.",
  [crit("CI_PASSES", 50, "A CI workflow runs and passes on the default branch"), crit("FILE_EXISTS", 50, "README with setup instructions exists", "README.md")]);
const CORE: Phase = phase("core", 30, 3, 7, "Core implementation", "The main functionality described in the brief.", standard("The main features work as described in the brief"));
const HANDOVER: Phase = phase("handover", 90, 1, 4, "Testing, documentation & handover",
  "Automated tests, final documentation and a clean, merged default branch ready for handover.",
  [crit("CI_PASSES", 40), crit("PR_MERGED", 30), crit("MANUAL_REVIEW", 30, "Documentation and tests are good enough to hand over")]);

/** Whole numbers, each at least 1, adding up to `total`, in proportion to `weights`. */
function allocate(weights: number[], total: number): number[] {
  const n = weights.length;
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const exact = weights.map((w) => (w / sum) * (total - n));
  const out = exact.map((x) => 1 + Math.floor(x));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) out[order[k].i]++;
  return out;
}

/** "YYYY-MM-DD" for today + `days`, in the user's own time zone. */
export function dateInDays(days: number, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Converts a plan with "due in N days" into editable milestone drafts with real dates. */
export function draftsFromPlan(plan: { title: string; description: string; percent: number; dueInDays: number; criteria: CriterionDraft[] }[], from = new Date()): MilestoneDraft[] {
  return plan.map((m) => ({ title: m.title, description: m.description, percent: m.percent, dueDate: dateInDays(m.dueInDays, from), criteria: m.criteria.map((c) => ({ ...c, config: { ...c.config } })) }));
}

/**
 * Built-in planner (no AI): recognises the type of project from the title and brief, sizes the
 * plan to the budget, and spreads due dates over at most 28 days (PayPal's authorization window).
 * Used when AI planning is off or unavailable. Every field stays editable before funding.
 */
export function suggestPlan(input: { title: string; brief: string; budgetCents?: number }, from = new Date()): MilestoneDraft[] {
  const text = `${input.title} ${input.brief}`.toLowerCase();
  const budget = (input.budgetCents ?? 0) / 100;
  const middleSlots = budget > 0 && budget < 300 ? 1 : budget > 0 && budget < 1500 ? 2 : 3;

  // Score each matched topic by how many of its words appear, keep the strongest.
  const matched = TOPICS
    .map((t) => ({ t, hits: (text.match(new RegExp(t.words.source, "g")) ?? []).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  const picked: Phase[] = [];
  // Copies, so tweaks below never change the shared templates.
  const copy = (p: Phase): Phase => ({ ...p, criteria: p.criteria.map((c) => ({ ...c, config: { ...c.config } })) });
  for (const { t } of matched) for (const p of t.phases) if (picked.length < middleSlots && !picked.some((q) => q.key === p.key)) picked.push(copy(p));
  if (!picked.length) picked.push(copy(CORE));
  if (/openapi|swagger/.test(text)) {
    const api = picked.find((p) => p.key === "api");
    if (api) api.criteria = standard("Endpoints return correct data and clear errors", { what: "OpenAPI specification is included", path: "docs/openapi.yaml" });
  }

  const phases = [copy(FOUNDATION), ...picked.sort((a, b) => a.order - b.order), copy(HANDOVER)];
  // Small budgets: setup + one delivery milestone is enough.
  const final = budget > 0 && budget < 150 ? [phases[0], phases[1]] : phases;

  const percents = allocate(final.map((p) => p.effort * 10), 100);
  let days = final.map((p) => p.days);
  if (days.reduce((a, b) => a + b, 0) > 28) days = allocate(days, 28);
  let running = 0;
  return draftsFromPlan(final.map((p, i) => ({
    title: p.title, description: p.description, percent: percents[i], dueInDays: (running += days[i]),
    criteria: p.criteria,
  })), from);
}

export function rebalanceWeights(criteria: CriterionDraft[]): CriterionDraft[] {
  if (!criteria.length) return criteria;
  const each = Math.floor(100 / criteria.length);
  return criteria.map((c, i) => ({ ...c, weight: i === criteria.length - 1 ? 100 - each * (criteria.length - 1) : each }));
}
