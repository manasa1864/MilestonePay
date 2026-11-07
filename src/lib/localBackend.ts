/**
 * Browser-only backend used when Supabase is not configured.
 * It mirrors the rules enforced by supabase/schema.sql so the app behaves the
 * same either way. Data lives in localStorage on this device only.
 */
import type {
  Activity, Backend, Criterion, FreelancerStats, Milestone, Payment, Profile, ProfileInput, Project, ProjectDraft,
  ResumeChange, ResumeRef, Review, Revision, SignUpInput, SignUpResult, Submission, SubmissionInput, Verification, Workspace,
} from "./types";

const DB_KEY = "mp-db";
const LEGACY_ACCOUNTS_KEY = "mp-accounts";
const MAX_RESUME_BYTES = 1_572_864;

type StoredUser = Profile & { passHash: string };
type DB = {
  version: 1;
  sessionUserId: string | null;
  users: StoredUser[];
  projects: Project[];
  milestones: Milestone[];
  criteria: Criterion[];
  submissions: Submission[];
  verifications: Verification[];
  revisions: Revision[];
  payments: Payment[];
  reviews: Review[];
  activity: Activity[];
};

const now = () => new Date().toISOString();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const ref = (prefix: string) => `${prefix}-${Array.from(crypto.getRandomValues(new Uint8Array(5))).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function emptyDb(): DB {
  return { version: 1, sessionUserId: null, users: [], projects: [], milestones: [], criteria: [], submissions: [], verifications: [], revisions: [], payments: [], reviews: [], activity: [] };
}

function migrateLegacy(db: DB) {
  try {
    const raw = JSON.parse(localStorage.getItem(LEGACY_ACCOUNTS_KEY) || "[]");
    if (!Array.isArray(raw)) return;
    for (const a of raw) {
      if (!a?.email || db.users.some((u) => u.email === a.email)) continue;
      db.users.push({
        id: a.id ?? uuid(), role: a.role === "freelancer" ? "freelancer" : "client", fullName: a.name ?? "", email: a.email,
        company: a.company ?? "", headline: a.headline ?? "", bio: a.bio ?? "", skills: a.skills ?? [], portfolioUrl: a.portfolio ?? "",
        githubUsername: "", resume: a.resume ? { path: a.resume.dataUrl, name: a.resume.name, size: a.resume.size } : null,
        createdAt: now(), passHash: a.passHash,
      });
    }
    localStorage.removeItem(LEGACY_ACCOUNTS_KEY);
    localStorage.removeItem("mp-session");
  } catch { /* ignore */ }
}

function load(): DB {
  let db = emptyDb();
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) db = { ...emptyDb(), ...JSON.parse(raw) };
  } catch { /* fall back to empty */ }
  if (localStorage.getItem(LEGACY_ACCOUNTS_KEY)) { migrateLegacy(db); save(db); }
  return db;
}

function save(db: DB) {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
  catch { throw new Error("Browser storage is full. Remove your resume or use a smaller file."); }
}

async function hashPassword(password: string, email: string) {
  const text = `milestonepay:${email.toLowerCase()}:${password}`;
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return btoa(unescape(encodeURIComponent(text)));
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function resumeFromFile(file: File): Promise<ResumeRef> {
  if (file.size > MAX_RESUME_BYTES) throw new Error("Resume must be under 1.5 MB.");
  return { path: await readAsDataUrl(file), name: file.name, size: file.size };
}

function publicProfile(u: StoredUser): Profile {
  const { passHash: _omit, ...p } = u;
  void _omit;
  return { ...p, email: "" };
}

function recompute(db: DB, v: Verification) {
  const ms = db.milestones.find((m) => m.id === v.milestoneId)!;
  const crit = db.criteria.filter((c) => c.milestoneId === v.milestoneId);
  const total = crit.reduce((a, c) => a + c.weight, 0);
  const passed = crit.reduce((a, c) => a + (v.results.find((r) => r.criterionId === c.id)?.passed ? c.weight : 0), 0);
  v.scorePercent = total ? Math.round((10000 * passed) / total) / 100 : 0;
  v.proposedCents = total ? Math.floor((ms.amountCents * passed) / total) : 0;
}

export class LocalBackend implements Backend {
  readonly kind = "local" as const;
  private listeners = new Set<() => void>();

  private me(db: DB): StoredUser {
    const u = db.users.find((x) => x.id === db.sessionUserId);
    if (!u) throw new Error("Your session has expired. Log in again.");
    return u;
  }
  private log(db: DB, projectId: string, kind: string, message: string) {
    db.activity.unshift({ id: uuid(), projectId, actorId: db.sessionUserId, kind, message, createdAt: now() });
  }
  private member(db: DB, projectId: string) {
    const me = db.sessionUserId;
    const p = db.projects.find((x) => x.id === projectId);
    return !!p && (p.clientId === me || p.freelancerId === me);
  }
  private emit() { this.listeners.forEach((l) => l()); }

  async currentProfile() {
    const db = load();
    const u = db.users.find((x) => x.id === db.sessionUserId);
    if (!u) return null;
    const { passHash: _p, ...profile } = u;
    void _p;
    return profile;
  }

  onAuthChange(cb: () => void) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  async signUp(input: SignUpInput): Promise<SignUpResult> {
    const db = load();
    const email = input.email.trim().toLowerCase();
    if (db.users.some((u) => u.email === email)) throw new Error("An account with this email already exists. Log in instead.");
    const resume = input.resumeFile ? await resumeFromFile(input.resumeFile) : null;
    const user: StoredUser = {
      id: uuid(), role: input.role, fullName: input.fullName, email, company: input.company, headline: input.headline,
      bio: input.bio, skills: input.skills, portfolioUrl: input.portfolioUrl, githubUsername: input.githubUsername,
      resume, createdAt: now(), passHash: await hashPassword(input.password, email),
    };
    db.users.push(user);
    db.sessionUserId = user.id;
    save(db);
    this.emit();
    return { profile: (await this.currentProfile())! };
  }

  async signIn(email: string, password: string) {
    const db = load();
    const key = email.trim().toLowerCase();
    const u = db.users.find((x) => x.email === key);
    if (!u || u.passHash !== (await hashPassword(password, key))) throw new Error("Incorrect email or password.");
    db.sessionUserId = u.id;
    save(db);
    this.emit();
    return (await this.currentProfile())!;
  }

  async signOut() {
    const db = load();
    db.sessionUserId = null;
    save(db);
    this.emit();
  }

  async updateProfile(input: ProfileInput, resume: ResumeChange) {
    const db = load();
    const u = this.me(db);
    Object.assign(u, input);
    if (resume instanceof File) u.resume = await resumeFromFile(resume);
    else if (resume === null) u.resume = null;
    save(db);
    return (await this.currentProfile())!;
  }

  async resumeUrl(resume: ResumeRef) { return resume.path; }

  private stats(db: DB, id: string): FreelancerStats {
    const projects = db.projects.filter((p) => p.freelancerId === id);
    const pids = new Set(projects.map((p) => p.id));
    const subs = new Set(db.submissions.filter((s) => s.freelancerId === id).map((s) => s.id));
    const results = db.verifications.filter((v) => subs.has(v.submissionId)).flatMap((v) => v.results).filter((r) => r.passed !== null);
    const reviews = db.reviews.filter((r) => r.freelancerId === id);
    return {
      verifiedMilestones: db.milestones.filter((m) => pids.has(m.projectId) && m.status === "approved").length,
      capturedCents: db.payments.filter((p) => pids.has(p.projectId) && p.kind === "capture").reduce((a, p) => a + p.amountCents, 0),
      completedProjects: projects.filter((p) => p.status === "completed").length,
      passRate: results.length ? Math.round((1000 * results.filter((r) => r.passed).length) / results.length) / 10 : null,
      avgRating: reviews.length ? Math.round((100 * reviews.reduce((a, r) => a + r.rating, 0)) / reviews.length) / 100 : null,
      reviewCount: reviews.length,
    };
  }

  async listFreelancers() {
    const db = load();
    this.me(db);
    return db.users.filter((u) => u.role === "freelancer").reverse().map((u) => ({ profile: publicProfile(u), stats: this.stats(db, u.id) }));
  }

  async freelancerReviews(freelancerId: string) {
    return load().reviews.filter((r) => r.freelancerId === freelancerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async loadWorkspace(): Promise<Workspace> {
    const db = load();
    const me = this.me(db);
    const projects = db.projects.filter((p) => p.clientId === me.id || p.freelancerId === me.id);
    const pids = new Set(projects.map((p) => p.id));
    const milestones = db.milestones.filter((m) => pids.has(m.projectId));
    const mids = new Set(milestones.map((m) => m.id));
    const people: Record<string, Profile> = {};
    for (const p of projects) for (const id of [p.clientId, p.freelancerId]) {
      const u = id && db.users.find((x) => x.id === id);
      if (u) people[u.id] = publicProfile(u);
    }
    people[me.id] = (await this.currentProfile())!;
    return {
      projects: [...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      milestones: [...milestones].sort((a, b) => a.position - b.position),
      criteria: db.criteria.filter((c) => mids.has(c.milestoneId)).sort((a, b) => a.position - b.position),
      submissions: db.submissions.filter((s) => mids.has(s.milestoneId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      verifications: db.verifications.filter((v) => mids.has(v.milestoneId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      revisions: db.revisions.filter((r) => mids.has(r.milestoneId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      payments: db.payments.filter((p) => pids.has(p.projectId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      reviews: db.reviews.filter((r) => pids.has(r.projectId)),
      activity: db.activity.filter((a) => pids.has(a.projectId)).slice(0, 300),
      people,
    };
  }

  async createProject(d: ProjectDraft) {
    const db = load();
    const me = this.me(db);
    if (me.role !== "client") throw new Error("Only client accounts can create projects");
    if (!db.users.some((u) => u.id === d.freelancerId && u.role === "freelancer")) throw new Error("Choose a registered freelancer");
    if (d.title.trim().length < 3) throw new Error("Enter a project title");
    if (d.brief.trim().length < 20) throw new Error("The brief must be at least 20 characters");
    if (!(d.budgetCents > 0)) throw new Error("Enter a budget");
    if (d.milestones.length < 1 || d.milestones.length > 8) throw new Error("A plan needs between 1 and 8 milestones");
    const pct = d.milestones.reduce((a, m) => a + m.percent, 0);
    if (Math.abs(pct - 100) > 0.001) throw new Error(`Milestone percentages must total 100% (got ${pct})`);
    for (const m of d.milestones) {
      if (!m.criteria.length) throw new Error("Every milestone needs at least one acceptance criterion");
      const w = m.criteria.reduce((a, c) => a + c.weight, 0);
      if (w !== 100) throw new Error(`Criteria weights in "${m.title}" must total 100% (got ${w})`);
    }
    const project: Project = {
      id: uuid(), clientId: me.id, freelancerId: d.freelancerId, title: d.title.trim(), brief: d.brief.trim(),
      budgetCents: d.budgetCents, status: "draft", authorizationRef: null, authorizedAt: null, completedAt: null, createdAt: now(),
    };
    db.projects.push(project);
    let allocated = 0;
    d.milestones.forEach((m, i) => {
      const amount = i === d.milestones.length - 1 ? d.budgetCents - allocated : Math.floor((d.budgetCents * m.percent) / 100);
      allocated += amount;
      const ms: Milestone = {
        id: uuid(), projectId: project.id, position: i + 1, title: m.title.trim(), description: m.description, percent: m.percent,
        amountCents: amount, capturedCents: 0, status: "not_started", dueDate: m.dueDate || null, approvedAt: null,
      };
      db.milestones.push(ms);
      m.criteria.forEach((c, j) => db.criteria.push({ id: uuid(), milestoneId: ms.id, position: j + 1, type: c.type, description: c.description.trim(), weight: c.weight, config: c.config }));
    });
    this.log(db, project.id, "project_created", `Project created with ${d.milestones.length} milestones.`);
    save(db);
    return project.id;
  }

  async authorizeProject(projectId: string) {
    const db = load();
    const me = this.me(db);
    const p = db.projects.find((x) => x.id === projectId && x.clientId === me.id);
    if (!p) throw new Error("Project not found");
    if (p.status !== "draft") throw new Error("This project is already funded");
    const r = ref("AUTH");
    Object.assign(p, { status: "in_progress", authorizationRef: r, authorizedAt: now() });
    const first = db.milestones.find((m) => m.projectId === p.id && m.position === 1);
    if (first) first.status = "in_progress";
    db.payments.push({ id: uuid(), projectId: p.id, milestoneId: null, kind: "authorization", amountCents: p.budgetCents, reference: r, createdAt: now() });
    this.log(db, p.id, "authorized", `Funding authorized in PayPal Sandbox (${r}).`);
    save(db);
    return r;
  }

  async cancelProject(projectId: string) {
    const db = load();
    const me = this.me(db);
    const p = db.projects.find((x) => x.id === projectId && x.clientId === me.id);
    if (!p) throw new Error("Project not found");
    if (p.status === "completed" || p.status === "cancelled") throw new Error("This project is already closed");
    if (p.status === "in_progress") {
      const captured = db.payments.filter((x) => x.projectId === p.id && x.kind === "capture").reduce((a, x) => a + x.amountCents, 0);
      if (p.budgetCents - captured > 0) db.payments.push({ id: uuid(), projectId: p.id, milestoneId: null, kind: "release", amountCents: p.budgetCents - captured, reference: ref("VOID"), createdAt: now() });
    }
    p.status = "cancelled";
    this.log(db, p.id, "cancelled", "Project cancelled by the client.");
    save(db);
  }

  async submitMilestone(i: SubmissionInput) {
    const db = load();
    const me = this.me(db);
    const ms = db.milestones.find((m) => m.id === i.milestoneId);
    const p = ms && db.projects.find((x) => x.id === ms.projectId);
    if (!ms || !p || p.freelancerId !== me.id) throw new Error("Milestone not found");
    if (p.status !== "in_progress") throw new Error("This project is not active");
    if (ms.status !== "in_progress" && ms.status !== "revision_requested") throw new Error("This milestone is not open for submission");
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+/i.test(i.repoUrl)) throw new Error("Enter a GitHub repository URL");
    const sub: Submission = { id: uuid(), milestoneId: ms.id, freelancerId: me.id, repoUrl: i.repoUrl, commitSha: i.commitSha, notes: i.notes, createdAt: now() };
    db.submissions.push(sub);
    db.verifications.filter((v) => v.milestoneId === ms.id && v.status === "pending_review").forEach((v) => { v.status = "superseded"; });
    const v: Verification = {
      id: uuid(), submissionId: sub.id, milestoneId: ms.id, scorePercent: 0, proposedCents: 0, status: "pending_review", createdAt: now(), decidedAt: null,
      results: db.criteria.filter((c) => c.milestoneId === ms.id).map((c) => {
        if (c.type === "MANUAL_REVIEW") return { criterionId: c.id, passed: null, evidence: "Awaiting client review.", source: "manual" as const };
        const r = i.results.find((x) => x.criterionId === c.id);
        return { criterionId: c.id, passed: r?.passed ?? false, evidence: (r?.evidence || "No evidence recorded.").slice(0, 1000), source: "github" as const };
      }),
    };
    recompute(db, v);
    db.verifications.push(v);
    ms.status = "submitted";
    db.revisions.filter((r) => r.milestoneId === ms.id && !r.resolvedAt).forEach((r) => { r.resolvedAt = now(); });
    this.log(db, p.id, "submitted", `Milestone ${ms.position} submitted for verification.`);
    save(db);
    return v.id;
  }

  private clientVerification(db: DB, verificationId: string) {
    const me = this.me(db);
    const v = db.verifications.find((x) => x.id === verificationId);
    const ms = v && db.milestones.find((m) => m.id === v.milestoneId);
    const p = ms && db.projects.find((x) => x.id === ms.projectId);
    if (!v || !ms || !p || p.clientId !== me.id) throw new Error("Verification not found");
    if (v.status !== "pending_review") throw new Error("This verification is already decided");
    return { v, ms, p };
  }

  async setManualResult(verificationId: string, criterionId: string, passed: boolean, note: string) {
    const db = load();
    const { v } = this.clientVerification(db, verificationId);
    const c = db.criteria.find((x) => x.id === criterionId && x.milestoneId === v.milestoneId);
    if (c?.type !== "MANUAL_REVIEW") throw new Error("Only client-review criteria can be set manually");
    const r = v.results.find((x) => x.criterionId === criterionId);
    if (r) { r.passed = passed; r.evidence = note.trim() || (passed ? "Marked as passed by the client." : "Marked as not passed by the client."); }
    recompute(db, v);
    save(db);
  }

  async approveRelease(verificationId: string) {
    const db = load();
    const { v, ms, p } = this.clientVerification(db, verificationId);
    if (v.results.some((r) => r.passed === null)) throw new Error("Review the remaining client-review criteria first");
    if (v.proposedCents <= 0) throw new Error("No criteria passed, so there is nothing to release. Request a revision instead.");
    const captured = () => db.payments.filter((x) => x.projectId === p.id && x.kind === "capture").reduce((a, x) => a + x.amountCents, 0);
    if (captured() + v.proposedCents > p.budgetCents) throw new Error("Release exceeds the remaining authorization");
    const r = ref("CAP");
    db.payments.push({ id: uuid(), projectId: p.id, milestoneId: ms.id, kind: "capture", amountCents: v.proposedCents, reference: r, createdAt: now() });
    Object.assign(v, { status: "approved", decidedAt: now() });
    Object.assign(ms, { status: "approved", capturedCents: v.proposedCents, approvedAt: now() });
    const next = db.milestones.find((m) => m.projectId === p.id && m.position === ms.position + 1);
    if (next) next.status = "in_progress";
    else {
      Object.assign(p, { status: "completed", completedAt: now() });
      const rest = p.budgetCents - captured();
      if (rest > 0) db.payments.push({ id: uuid(), projectId: p.id, milestoneId: null, kind: "release", amountCents: rest, reference: ref("VOID"), createdAt: now() });
      this.log(db, p.id, "completed", "Project completed. Remaining authorization released.");
    }
    this.log(db, p.id, "captured", `Milestone ${ms.position} approved; ${money(v.proposedCents)} captured (${r}).`);
    save(db);
    return r;
  }

  async requestRevision(verificationId: string, message: string) {
    const db = load();
    const { v, ms, p } = this.clientVerification(db, verificationId);
    if (message.trim().length < 5) throw new Error("Describe what needs to change");
    Object.assign(v, { status: "revision_requested", decidedAt: now() });
    ms.status = "revision_requested";
    db.revisions.push({ id: uuid(), milestoneId: ms.id, verificationId: v.id, message: message.trim(), createdAt: now(), resolvedAt: null });
    this.log(db, p.id, "revision", `Revision requested on milestone ${ms.position}.`);
    save(db);
  }

  async submitReview(projectId: string, rating: number, body: string) {
    const db = load();
    const me = this.me(db);
    const p = db.projects.find((x) => x.id === projectId && x.clientId === me.id);
    if (!p || !this.member(db, projectId)) throw new Error("Project not found");
    if (!p.freelancerId) throw new Error("This project has no freelancer");
    if (!db.payments.some((x) => x.projectId === p.id && x.kind === "capture")) throw new Error("Reviews open after the first payment is captured");
    if (db.reviews.some((r) => r.projectId === p.id && r.clientId === me.id)) throw new Error("You have already reviewed this project");
    if (rating < 1 || rating > 5) throw new Error("Choose a rating");
    if (body.trim().length < 10) throw new Error("Write at least 10 characters");
    db.reviews.push({ id: uuid(), projectId: p.id, clientId: me.id, freelancerId: p.freelancerId, rating, body: body.trim(), createdAt: now() });
    this.log(db, p.id, "review", `Client left a ${rating}-star review.`);
    save(db);
  }
}
