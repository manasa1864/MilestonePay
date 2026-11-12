import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { verifyRepository } from "./github";
import { draftsFromPlan, suggestPlan } from "./plan";
import type {
  Activity, AppSettings, Backend, CheckOutcome, CriterionType, GeneratedPlan, Criterion, FreelancerMatch, FreelancerStats, Milestone, Payment, Profile, ProfileInput, Project, ProjectDraft,
  ResumeChange, ResumeRef, Review, Revision, SignUpInput, SignUpResult, Submission, SubmissionInput, Verification, Workspace,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const RESUME_BUCKET = "resumes";

function fail(error: { message: string } | null | undefined, fallback = "Something went wrong"): never {
  throw new Error(error?.message || fallback);
}

function toProfile(r: Row, email = ""): Profile {
  return {
    id: r.id,
    role: r.role,
    fullName: r.full_name ?? "",
    email: r.email ?? email,
    company: r.company ?? "",
    headline: r.headline ?? "",
    bio: r.bio ?? "",
    skills: r.skills ?? [],
    portfolioUrl: r.portfolio_url ?? "",
    githubUsername: r.github_username ?? "",
    paypalEmail: r.paypal_email ?? "",
    resumeText: r.resume_text ?? "",
    resume: r.resume_path ? { path: r.resume_path, name: r.resume_name ?? "resume", size: r.resume_size ?? 0 } : null,
    createdAt: r.created_at,
  };
}
const toProject = (r: Row): Project => ({
  id: r.id, clientId: r.client_id, freelancerId: r.freelancer_id, title: r.title, brief: r.brief,
  budgetCents: Number(r.budget_cents), status: r.status, authorizationRef: r.paypal_authorization_id,
  latePenaltyPerDay: Number(r.late_penalty_per_day ?? 0), latePenaltyCap: Number(r.late_penalty_cap ?? 0),
  paymentMode: r.payment_mode ?? "simulated", authorizationExpiresAt: r.authorization_expires_at ?? null,
  authorizedAt: r.authorized_at, completedAt: r.completed_at, createdAt: r.created_at,
});
const toMilestone = (r: Row): Milestone => ({
  id: r.id, projectId: r.project_id, position: r.position, title: r.title, description: r.description,
  percent: Number(r.percent), amountCents: Number(r.amount_cents), capturedCents: Number(r.captured_cents),
  status: r.status, dueDate: r.due_date, approvedAt: r.approved_at,
});
const toCriterion = (r: Row): Criterion => ({
  id: r.id, milestoneId: r.milestone_id, position: r.position, type: r.type, description: r.description,
  weight: r.weight, config: r.config ?? {},
});
const toSubmission = (r: Row): Submission => ({
  id: r.id, milestoneId: r.milestone_id, freelancerId: r.freelancer_id, repoUrl: r.repo_url,
  commitSha: r.commit_sha, notes: r.notes, checkedBy: r.checked_by ?? "browser", createdAt: r.created_at,
});
const toVerification = (r: Row): Verification => ({
  id: r.id, submissionId: r.submission_id, milestoneId: r.milestone_id, scorePercent: Number(r.score_percent),
  baseCents: Number(r.base_cents ?? r.proposed_cents), daysLate: Number(r.days_late ?? 0), penaltyPercent: Number(r.penalty_percent ?? 0),
  proposedCents: Number(r.proposed_cents), status: r.status, createdAt: r.created_at, decidedAt: r.decided_at,
  results: (r.verification_results ?? []).map((x: Row) => ({ criterionId: x.criterion_id, passed: x.passed, evidence: x.evidence, source: x.source })),
});
const toRevision = (r: Row): Revision => ({
  id: r.id, milestoneId: r.milestone_id, verificationId: r.verification_id, message: r.message,
  createdAt: r.created_at, resolvedAt: r.resolved_at,
});
const toPayment = (r: Row): Payment => ({
  id: r.id, projectId: r.project_id, milestoneId: r.milestone_id, kind: r.kind,
  amountCents: Number(r.amount_cents), reference: r.reference, note: r.note ?? "", createdAt: r.created_at,
});
const toReview = (r: Row): Review => ({
  id: r.id, projectId: r.project_id, clientId: r.client_id, freelancerId: r.freelancer_id,
  rating: r.rating, body: r.body, createdAt: r.created_at,
});
const toActivity = (r: Row): Activity => ({
  id: r.id, projectId: r.project_id, actorId: r.actor_id, kind: r.kind, message: r.message, createdAt: r.created_at,
});
const toStats = (r: Row | undefined): FreelancerStats => ({
  verifiedMilestones: Number(r?.verified_milestones ?? 0),
  completedProjects: Number(r?.completed_projects ?? 0),
  passRate: r?.pass_rate == null ? null : Number(r.pass_rate),
  avgRating: r?.avg_rating == null ? null : Number(r.avg_rating),
  reviewCount: Number(r?.review_count ?? 0),
});

function profileColumns(p: ProfileInput) {
  return {
    full_name: p.fullName, company: p.company, headline: p.headline, bio: p.bio, skills: p.skills,
    portfolio_url: p.portfolioUrl, github_username: p.githubUsername, paypal_email: p.paypalEmail.toLowerCase(),
  };
}

export class SupabaseBackend implements Backend {
  readonly kind = "supabase" as const;
  private sb: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  }

  private async uid(): Promise<string> {
    const { data } = await this.sb.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new Error("Your session has expired. Log in again.");
    return id;
  }

  /** Calls an Edge Function and turns its JSON error into a readable Error. */
  private async edge<T>(name: "paypal" | "github-verify" | "plan-milestones", body: Row): Promise<T> {
    const { data, error } = await this.sb.functions.invoke(name, { body });
    if (error) {
      let message = error.message;
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try { message = (await ctx.json()).error ?? message; } catch { /* keep default */ }
      }
      if (/Failed to send a request|not found/i.test(message)) message = `The "${name}" Edge Function isn't deployed yet. See README → PayPal and GitHub.`;
      throw new Error(message);
    }
    return data as T;
  }

  private settingsCache: { at: number; value: AppSettings } | null = null;

  async settings(): Promise<AppSettings> {
    if (this.settingsCache && Date.now() - this.settingsCache.at < 60_000) return this.settingsCache.value;
    const { data } = await this.sb.from("app_settings").select("*").maybeSingle();
    const paypalClientId = (import.meta.env.VITE_PAYPAL_CLIENT_ID ?? "").trim();
    const value: AppSettings = {
      paypalEnabled: !!data?.paypal_enabled && paypalClientId.length > 10,
      paypalClientId,
      currency: data?.currency ?? "USD",
      serverGithubChecks: !!data?.server_github_checks,
      aiPlans: !!data?.ai_plans_enabled,
    };
    this.settingsCache = { at: Date.now(), value };
    return value;
  }

  async generatePlan(input: { title: string; brief: string; budgetCents: number }): Promise<GeneratedPlan> {
    const builtin = (note?: string): GeneratedPlan => ({ milestones: suggestPlan(input), summary: "", source: "builtin", note });
    if (!(await this.settings()).aiPlans) return builtin();
    try {
      type Out = { summary: string; milestones: { title: string; description: string; percent: number; dueInDays: number; criteria: { type: CriterionType; description: string; weight: number; config: { path?: string } }[] }[] };
      const out = await this.edge<Out>("plan-milestones", { action: "generate", ...input });
      return { milestones: draftsFromPlan(out.milestones), summary: out.summary, source: "claude" };
    } catch (e) {
      // Never leave the client without a plan: fall back to the built-in planner and say why.
      return builtin(e instanceof Error ? e.message : String(e));
    }
  }

  async runChecks(milestoneId: string, repoUrl: string, criteria: Criterion[], onProgress?: (m: string) => void): Promise<CheckOutcome> {
    if ((await this.settings()).serverGithubChecks) {
      onProgress?.("Running checks on the MilestonePay server");
      return this.edge<CheckOutcome>("github-verify", { action: "check", milestoneId, repoUrl });
    }
    return verifyRepository(repoUrl, criteria, { onProgress });
  }

  async paypalCreateOrder(projectId: string) {
    return (await this.edge<{ orderId: string }>("paypal", { action: "create_order", projectId })).orderId;
  }
  async paypalAuthorize(projectId: string, orderId: string) {
    return (await this.edge<{ authorizationId: string }>("paypal", { action: "authorize_order", projectId, orderId })).authorizationId;
  }
  async retryPayout(milestoneId: string) {
    await this.edge("paypal", { action: "retry_payout", milestoneId });
  }

  private async rpc<T>(fn: string, args: Row): Promise<T> {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) fail(error);
    return data as T;
  }

  async currentProfile(): Promise<Profile | null> {
    const { data } = await this.sb.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    const { data: row, error } = await this.sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (error) fail(error);
    return row ? toProfile(row, user.email ?? "") : null;
  }

  onAuthChange(cb: () => void) {
    const { data } = this.sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") cb();
    });
    return () => data.subscription.unsubscribe();
  }

  async signUp(input: SignUpInput): Promise<SignUpResult> {
    const { data, error } = await this.sb.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          role: input.role, full_name: input.fullName, company: input.company, headline: input.headline,
          bio: input.bio, skills: input.skills, portfolio_url: input.portfolioUrl, github_username: input.githubUsername,
          paypal_email: input.paypalEmail,
        },
      },
    });
    if (error) fail(error);
    let session = data.session;
    if (!session) {
      // No session means Supabase's "Confirm email" setting is on. Try logging straight in;
      // if that is refused, explain the one setting to change.
      const res = await this.sb.auth.signInWithPassword({ email: input.email, password: input.password });
      if (res.error || !res.data.session) {
        throw new Error("Account created, but Supabase requires email confirmation. Turn off Authentication → Sign In / Providers → Email → “Confirm email” in your Supabase dashboard, then log in.");
      }
      session = res.data.session;
    }
    if (input.resumeFile) {
      try {
        await this.uploadResume(session.user.id, input.resumeFile, null);
        if (input.resumeText) await this.sb.from("profiles").update({ resume_text: input.resumeText }).eq("id", session.user.id);
      } catch { /* resume can be added later in settings */ }
    }
    return { profile: await this.currentProfile() };
  }

  async signIn(email: string, password: string): Promise<Profile> {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) fail(error, "Incorrect email or password.");
    const p = await this.currentProfile();
    if (!p) throw new Error("Your profile could not be found. Make sure supabase/schema.sql has been run.");
    return p;
  }

  async signOut() {
    await this.sb.auth.signOut();
  }

  private async uploadResume(uid: string, file: File, previous: ResumeRef | null) {
    const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
    const path = `${uid}/${Date.now()}-${safe}`;
    const { error } = await this.sb.storage.from(RESUME_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) fail(error, "Resume upload failed.");
    const { error: e2 } = await this.sb.from("profiles").update({ resume_path: path, resume_name: file.name, resume_size: file.size }).eq("id", uid);
    if (e2) fail(e2);
    if (previous) await this.sb.storage.from(RESUME_BUCKET).remove([previous.path]);
  }

  async updateProfile(input: ProfileInput, resume: ResumeChange, resumeText?: string): Promise<Profile> {
    const uid = await this.uid();
    const current = await this.currentProfile();
    const columns: Row = profileColumns(input);
    if (resume === null) columns.resume_text = "";
    else if (resumeText !== undefined) columns.resume_text = resumeText.slice(0, 20_000);
    const { error } = await this.sb.from("profiles").update(columns).eq("id", uid);
    if (error) fail(error);
    if (resume instanceof File) await this.uploadResume(uid, resume, current?.resume ?? null);
    else if (resume === null && current?.resume) {
      await this.sb.storage.from(RESUME_BUCKET).remove([current.resume.path]);
      const { error: e2 } = await this.sb.from("profiles").update({ resume_path: null, resume_name: null, resume_size: null }).eq("id", uid);
      if (e2) fail(e2);
    }
    const p = await this.currentProfile();
    if (!p) throw new Error("Profile not found");
    return p;
  }

  async resumeUrl(resume: ResumeRef): Promise<string> {
    const { data, error } = await this.sb.storage.from(RESUME_BUCKET).createSignedUrl(resume.path, 600, { download: resume.name });
    if (error || !data) fail(error, "Could not open the resume.");
    return data.signedUrl;
  }

  async listFreelancers() {
    const [{ data: people, error }, { data: stats, error: e2 }] = await Promise.all([
      this.sb.from("public_profiles").select("*").eq("role", "freelancer").order("created_at", { ascending: false }),
      this.sb.from("freelancer_stats").select("*"),
    ]);
    if (error) fail(error);
    if (e2) fail(e2);
    const byId = new Map((stats ?? []).map((s: Row) => [s.freelancer_id, s]));
    return (people ?? []).map((r: Row) => ({ profile: toProfile(r), stats: toStats(byId.get(r.id)) }));
  }

  async searchFreelancers(query: string, skills: string[]): Promise<FreelancerMatch[]> {
    const { data, error } = await this.sb.rpc("search_freelancers", { p_query: query, p_skills: skills });
    if (error) fail(error);
    return ((data as Row[] | null) ?? []).map((r) => ({ id: r.freelancer_id, score: Number(r.score), matchedIn: r.matched_in, snippet: r.snippet ?? "" }));
  }

  async freelancerReviews(freelancerId: string) {
    const { data, error } = await this.sb.from("reviews").select("*").eq("freelancer_id", freelancerId).order("created_at", { ascending: false });
    if (error) fail(error);
    return (data ?? []).map(toReview);
  }

  async loadWorkspace(): Promise<Workspace> {
    const me = await this.currentProfile();
    const q = await Promise.all([
      this.sb.from("projects").select("*").order("created_at", { ascending: false }),
      this.sb.from("milestones").select("*").order("position"),
      this.sb.from("criteria").select("*").order("position"),
      this.sb.from("submissions").select("*").order("created_at", { ascending: false }),
      this.sb.from("verifications").select("*, verification_results(*)").order("created_at", { ascending: false }),
      this.sb.from("revisions").select("*").order("created_at", { ascending: false }),
      this.sb.from("payments").select("*").order("created_at", { ascending: false }),
      this.sb.from("activity").select("*").order("created_at", { ascending: false }).limit(300),
    ]);
    for (const r of q) if (r.error) fail(r.error);
    const [projects, milestones, criteria, submissions, verifications, revisions, payments, activity] = q.map((r) => r.data ?? []);
    const projectIds = projects.map((p: Row) => p.id);
    const peopleIds = Array.from(new Set(projects.flatMap((p: Row) => [p.client_id, p.freelancer_id]).filter(Boolean)));
    const [{ data: reviews, error: e1 }, { data: people, error: e2 }, { data: contacts }] = await Promise.all([
      projectIds.length ? this.sb.from("reviews").select("*").in("project_id", projectIds) : Promise.resolve({ data: [], error: null }),
      peopleIds.length ? this.sb.from("public_profiles").select("*").in("id", peopleIds) : Promise.resolve({ data: [], error: null }),
      projectIds.length ? this.sb.rpc("project_contacts") : Promise.resolve({ data: [], error: null }),
    ]);
    if (e1) fail(e1);
    if (e2) fail(e2);
    const emails = new Map<string, string>(((contacts as Row[] | null) ?? []).map((c) => [c.user_id, c.email]));
    const map: Record<string, Profile> = {};
    for (const r of people ?? []) map[r.id] = toProfile(r, emails.get(r.id) ?? "");
    if (me) map[me.id] = me;
    return {
      projects: projects.map(toProject),
      milestones: milestones.map(toMilestone),
      criteria: criteria.map(toCriterion),
      submissions: submissions.map(toSubmission),
      verifications: verifications.map(toVerification),
      revisions: revisions.map(toRevision),
      payments: payments.map(toPayment),
      activity: activity.map(toActivity),
      reviews: (reviews ?? []).map(toReview),
      people: map,
    };
  }

  private planArgs(d: ProjectDraft) {
    return {
      p_title: d.title, p_brief: d.brief, p_budget_cents: d.budgetCents, p_freelancer_id: d.freelancerId,
      p_late_penalty_per_day: d.latePenaltyPerDay, p_late_penalty_cap: d.latePenaltyCap,
      p_milestones: d.milestones.map((m) => ({
        title: m.title, description: m.description, percent: m.percent, due_date: m.dueDate || null,
        criteria: m.criteria.map((c) => ({ type: c.type, description: c.description, weight: c.weight, config: c.config })),
      })),
    };
  }
  createProject(d: ProjectDraft) { return this.rpc<string>("create_project", this.planArgs(d)); }
  async updateDraftProject(projectId: string, d: ProjectDraft) {
    await this.rpc("update_draft_project", { p_project_id: projectId, ...this.planArgs(d) });
  }
  authorizeProject(projectId: string) { return this.rpc<string>("authorize_project", { p_project_id: projectId }); }
  async cancelProject(projectId: string, viaPayPal: boolean) {
    if (viaPayPal) await this.edge("paypal", { action: "cancel_project", projectId });
    else await this.rpc("cancel_project", { p_project_id: projectId });
  }
  async submitMilestone(i: SubmissionInput) {
    if ((await this.settings()).serverGithubChecks) {
      // The server re-runs the checks itself; browser results are never trusted in this mode.
      return (await this.edge<{ verificationId: string }>("github-verify", { action: "submit", milestoneId: i.milestoneId, repoUrl: i.repoUrl, notes: i.notes })).verificationId;
    }
    return this.rpc<string>("submit_milestone", {
      p_milestone_id: i.milestoneId, p_repo_url: i.repoUrl, p_commit_sha: i.commitSha ?? "", p_notes: i.notes,
      p_results: i.results.map((r) => ({ criterion_id: r.criterionId, passed: r.passed, evidence: r.evidence })),
    });
  }
  async setManualResult(verificationId: string, criterionId: string, passed: boolean, note: string) {
    await this.rpc("set_manual_result", { p_verification_id: verificationId, p_criterion_id: criterionId, p_passed: passed, p_note: note });
  }
  async approveRelease(verificationId: string, viaPayPal: boolean) {
    if (viaPayPal) return (await this.edge<{ captureId: string }>("paypal", { action: "capture_release", verificationId })).captureId;
    return this.rpc<string>("approve_release", { p_verification_id: verificationId });
  }
  async requestRevision(verificationId: string, message: string) {
    await this.rpc("request_revision", { p_verification_id: verificationId, p_message: message });
  }
  async submitReview(projectId: string, rating: number, body: string) {
    await this.rpc("submit_review", { p_project_id: projectId, p_rating: rating, p_body: body });
  }
}
