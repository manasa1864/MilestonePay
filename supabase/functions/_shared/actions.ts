/**
 * Business logic for the Edge Functions, with dependencies injected so it can be
 * tested outside Deno. `rpc` calls a svc_* database function with the service-role key.
 */
import { verifyRepository, type CheckCriterion, type VerifyOutcome } from "./github-checks.ts";
import { PayPalClient, PayPalError, toValue } from "./paypal.ts";

export type Rpc = <T = unknown>(fn: string, args: Record<string, unknown>) => Promise<T>;
/** Asks the model for JSON that matches `schema`. Supplied by the plan-milestones function. */
export type Llm = (system: string, user: string, schema: Record<string, unknown>) => Promise<unknown>;
export type Deps = { rpc: Rpc; actor: string; paypal?: PayPalClient; githubToken?: string; fetchImpl?: typeof fetch; llm?: Llm };

export class ActionError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const need = (v: unknown, name: string) => {
  if (typeof v !== "string" || !v.trim()) throw new ActionError(`Missing ${name}`);
  return v.trim();
};
const money = (cents: number, currency: string) => `${currency} ${toValue(cents)}`;

function paypalOf(d: Deps) {
  if (!d.paypal) throw new ActionError("PayPal is not configured on the server. Set PAYPAL_CLIENT_ID and PAYPAL_SECRET.", 500);
  return d.paypal;
}

// ----------------------------------------------------------------------------- PayPal

export async function createOrder(d: Deps, body: Record<string, unknown>) {
  const projectId = need(body.projectId, "projectId");
  const [p] = await d.rpc<{ budget_cents: number; currency: string; title: string }[]>("svc_paypal_prepare_order", { p_actor: d.actor, p_project_id: projectId });
  const orderId = await paypalOf(d).createAuthorizeOrder({ projectId, title: p.title, cents: Number(p.budget_cents), currency: p.currency });
  await d.rpc("svc_paypal_set_order", { p_actor: d.actor, p_project_id: projectId, p_order_id: orderId });
  return { orderId };
}

export async function authorizeOrder(d: Deps, body: Record<string, unknown>) {
  const projectId = need(body.projectId, "projectId");
  const orderId = need(body.orderId, "orderId");
  const auth = await paypalOf(d).authorizeOrder(orderId);
  if (auth.customId && auth.customId !== projectId) throw new ActionError("This PayPal order belongs to a different project.");
  await d.rpc("svc_paypal_mark_authorized", {
    p_actor: d.actor, p_project_id: projectId, p_order_id: orderId, p_authorization_id: auth.authorizationId,
    p_amount_cents: auth.cents, p_expires_at: auth.expiresAt,
  });
  return { authorizationId: auth.authorizationId, expiresAt: auth.expiresAt };
}

type ReleaseRow = {
  authorization_id: string; amount_cents: number; currency: string; is_final: boolean; payee_email: string;
  project_id: string; milestone_id: string; milestone_position: number; project_title: string;
};

async function sendPayout(d: Deps, info: { projectId: string; milestoneId: string; position: number; title: string; cents: number; currency: string; email: string }) {
  if (!info.email) {
    await d.rpc("svc_record_payout", {
      p_actor: d.actor, p_project_id: info.projectId, p_milestone_id: info.milestoneId, p_amount_cents: info.cents, p_reference: null,
      p_note: `Payout of ${money(info.cents, info.currency)} for milestone ${info.position} is waiting: the freelancer has no PayPal email on their profile.`,
    });
    return { status: "waiting_for_email" as const };
  }
  try {
    const out = await paypalOf(d).payout({
      batchId: `mp-${info.milestoneId}`, email: info.email, cents: info.cents, currency: info.currency,
      subject: `MilestonePay payment for ${info.title}`, note: `Milestone ${info.position} of "${info.title}" was approved.`,
    });
    await d.rpc("svc_record_payout", {
      p_actor: d.actor, p_project_id: info.projectId, p_milestone_id: info.milestoneId, p_amount_cents: info.cents, p_reference: out.batchId,
      p_note: `Paid out ${money(info.cents, info.currency)} to the freelancer's PayPal (${out.status.toLowerCase()}).`,
    });
    return { status: "sent" as const, batchId: out.batchId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await d.rpc("svc_record_payout", {
      p_actor: d.actor, p_project_id: info.projectId, p_milestone_id: info.milestoneId, p_amount_cents: info.cents, p_reference: null,
      p_note: `Payout for milestone ${info.position} failed: ${msg}`.slice(0, 300),
    });
    return { status: "failed" as const, error: msg };
  }
}

export async function captureRelease(d: Deps, body: Record<string, unknown>) {
  const verificationId = need(body.verificationId, "verificationId");
  const [r] = await d.rpc<ReleaseRow[]>("svc_paypal_begin_release", { p_actor: d.actor, p_verification_id: verificationId });
  const cents = Number(r.amount_cents);
  let captureId: string;
  try {
    const out = await paypalOf(d).capture({
      authorizationId: r.authorization_id, cents, currency: r.currency, finalCapture: r.is_final,
      invoiceId: `MP-${verificationId}`, note: `Milestone ${r.milestone_position}: ${r.project_title}`,
      requestId: `capture-${verificationId}`,
    });
    captureId = out.captureId;
  } catch (e) {
    // Definite failures unlock the verification; network/5xx errors keep it locked so a retry resumes safely.
    if (!(e instanceof PayPalError) || !e.retryable) await d.rpc("svc_paypal_abort_release", { p_verification_id: verificationId });
    const hint = e instanceof PayPalError && e.issue === "AUTHORIZATION_EXPIRED"
      ? " The PayPal authorization has expired (they last 29 days). Cancel the project and fund a new one." : "";
    throw new ActionError(`${e instanceof Error ? e.message : String(e)}${hint}`, 502);
  }
  await d.rpc("svc_paypal_finish_release", { p_actor: d.actor, p_verification_id: verificationId, p_capture_id: captureId });
  const payout = await sendPayout(d, {
    projectId: r.project_id, milestoneId: r.milestone_id, position: r.milestone_position, title: r.project_title,
    cents, currency: r.currency, email: r.payee_email,
  });
  return { captureId, payout };
}

export async function retryPayout(d: Deps, body: Record<string, unknown>) {
  const milestoneId = need(body.milestoneId, "milestoneId");
  const [r] = await d.rpc<{ project_id: string; amount_cents: number; currency: string; payee_email: string; milestone_position: number; project_title: string }[]>(
    "svc_payout_info", { p_actor: d.actor, p_milestone_id: milestoneId });
  const payout = await sendPayout(d, {
    projectId: r.project_id, milestoneId, position: r.milestone_position, title: r.project_title,
    cents: Number(r.amount_cents), currency: r.currency, email: r.payee_email,
  });
  if (payout.status === "waiting_for_email") throw new ActionError("The freelancer hasn't added a PayPal email to their profile yet.");
  if (payout.status === "failed") throw new ActionError(`Payout failed: ${payout.error}`, 502);
  return payout;
}

export async function cancelProject(d: Deps, body: Record<string, unknown>) {
  const projectId = need(body.projectId, "projectId");
  const [p] = await d.rpc<{ authorization_id: string | null; status: string; payment_mode: string }[]>(
    "svc_paypal_begin_cancel", { p_actor: d.actor, p_project_id: projectId });
  let ref = "NO-AUTHORIZATION";
  if (p.status === "in_progress" && p.payment_mode === "paypal" && p.authorization_id) {
    try {
      await paypalOf(d).void(p.authorization_id);
      ref = `VOID-${p.authorization_id}`;
    } catch (e) {
      // Already voided, fully captured or expired: nothing left to release at PayPal.
      if (e instanceof PayPalError && !e.retryable) ref = `VOID-SKIPPED-${e.issue ?? e.status}`;
      else throw new ActionError(e instanceof Error ? e.message : String(e), 502);
    }
  }
  await d.rpc("svc_paypal_finish_cancel", { p_actor: d.actor, p_project_id: projectId, p_void_ref: ref });
  return { reference: ref };
}

// ----------------------------------------------------------------------------- GitHub

type ContextRow = { criterion_id: string; type: string; description: string; weight: number; config: { path?: string } | null };

async function runChecksFor(d: Deps, milestoneId: string, repoUrl: string): Promise<VerifyOutcome> {
  const rows = await d.rpc<ContextRow[]>("svc_github_context", { p_actor: d.actor, p_milestone_id: milestoneId });
  const criteria: CheckCriterion[] = rows.map((r) => ({ id: r.criterion_id, type: r.type, description: r.description, config: r.config ?? {} }));
  try {
    return await verifyRepository(repoUrl, criteria, { token: d.githubToken, fetchImpl: d.fetchImpl });
  } catch (e) {
    throw new ActionError(e instanceof Error ? e.message : String(e), 422);
  }
}

export async function githubCheck(d: Deps, body: Record<string, unknown>) {
  return runChecksFor(d, need(body.milestoneId, "milestoneId"), need(body.repoUrl, "repoUrl"));
}

export async function githubSubmit(d: Deps, body: Record<string, unknown>) {
  const milestoneId = need(body.milestoneId, "milestoneId");
  const repoUrl = need(body.repoUrl, "repoUrl").replace(/\/+$/, "");
  const outcome = await runChecksFor(d, milestoneId, repoUrl);
  const verificationId = await d.rpc<string>("svc_github_submit", {
    p_actor: d.actor, p_milestone_id: milestoneId, p_repo_url: repoUrl, p_commit_sha: outcome.commitSha,
    p_notes: typeof body.notes === "string" ? body.notes.slice(0, 2000) : "",
    p_results: outcome.results.map((r) => ({ criterion_id: r.criterionId, passed: r.passed, evidence: r.evidence })),
  });
  return { verificationId, outcome };
}

export const paypalActions = { create_order: createOrder, authorize_order: authorizeOrder, capture_release: captureRelease, retry_payout: retryPayout, cancel_project: cancelProject };
export const githubActions = { check: githubCheck, submit: githubSubmit };
