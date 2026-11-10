export type Role = "client" | "freelancer";
export type ProjectStatus = "draft" | "in_progress" | "completed" | "cancelled";
export type MilestoneStatus = "not_started" | "in_progress" | "submitted" | "revision_requested" | "approved";
export type CriterionType = "CI_PASSES" | "FILE_EXISTS" | "PR_MERGED" | "MANUAL_REVIEW";
export type VerificationStatus = "pending_review" | "processing" | "approved" | "revision_requested" | "superseded";
export type PaymentKind = "authorization" | "capture" | "release" | "payout";
export type PaymentMode = "simulated" | "paypal";

export type ResumeRef = { path: string; name: string; size: number };

export type Profile = {
  id: string;
  role: Role;
  fullName: string;
  email: string;
  company: string;
  headline: string;
  bio: string;
  skills: string[];
  portfolioUrl: string;
  githubUsername: string;
  /** Only filled for your own profile. Freelancers are paid out to this PayPal address. */
  paypalEmail: string;
  resume: ResumeRef | null;
  /** Text read from the resume for client search. Only filled for your own profile. */
  resumeText: string;
  createdAt: string;
};

/** Public track record shown on freelancer profiles. Deliberately contains no money. */
export type FreelancerStats = {
  verifiedMilestones: number;
  completedProjects: number;
  passRate: number | null;
  avgRating: number | null;
  reviewCount: number;
};

export type Project = {
  id: string;
  clientId: string;
  freelancerId: string | null;
  title: string;
  brief: string;
  budgetCents: number;
  status: ProjectStatus;
  latePenaltyPerDay: number;
  latePenaltyCap: number;
  paymentMode: PaymentMode;
  authorizationExpiresAt: string | null;
  authorizationRef: string | null;
  authorizedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type Milestone = {
  id: string;
  projectId: string;
  position: number;
  title: string;
  description: string;
  percent: number;
  amountCents: number;
  capturedCents: number;
  status: MilestoneStatus;
  dueDate: string | null;
  approvedAt: string | null;
};

export type Criterion = {
  id: string;
  milestoneId: string;
  position: number;
  type: CriterionType;
  description: string;
  weight: number;
  config: { path?: string };
};

export type Submission = {
  id: string;
  milestoneId: string;
  freelancerId: string;
  repoUrl: string;
  commitSha: string | null;
  notes: string;
  checkedBy: "browser" | "server";
  createdAt: string;
};

export type VerificationResult = {
  criterionId: string;
  passed: boolean | null;
  evidence: string;
  source: "github" | "manual";
};

export type Verification = {
  id: string;
  submissionId: string;
  milestoneId: string;
  scorePercent: number;
  /** Amount for the passed criteria before any late penalty. */
  baseCents: number;
  daysLate: number;
  penaltyPercent: number;
  /** Amount to release after the late penalty. */
  proposedCents: number;
  status: VerificationStatus;
  createdAt: string;
  decidedAt: string | null;
  results: VerificationResult[];
};

export type Revision = {
  id: string;
  milestoneId: string;
  verificationId: string | null;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
};

export type Payment = {
  id: string;
  projectId: string;
  milestoneId: string | null;
  kind: PaymentKind;
  amountCents: number;
  reference: string;
  note: string;
  createdAt: string;
};

export type Review = {
  id: string;
  projectId: string;
  clientId: string;
  freelancerId: string;
  rating: number;
  body: string;
  createdAt: string;
};

export type Activity = {
  id: string;
  projectId: string;
  actorId: string | null;
  kind: string;
  message: string;
  createdAt: string;
};

/** Everything the signed-in user is allowed to see, loaded in one go. */
export type Workspace = {
  projects: Project[];
  milestones: Milestone[];
  criteria: Criterion[];
  submissions: Submission[];
  verifications: Verification[];
  revisions: Revision[];
  payments: Payment[];
  reviews: Review[];
  activity: Activity[];
  people: Record<string, Profile>;
};

export type ProfileInput = {
  fullName: string;
  company: string;
  headline: string;
  bio: string;
  skills: string[];
  portfolioUrl: string;
  githubUsername: string;
  paypalEmail: string;
};

export type SignUpInput = ProfileInput & { email: string; password: string; role: Role; resumeFile: File | null; resumeText: string };

/** One search hit: which freelancer matched, how well, and where the keywords were found. */
export type FreelancerMatch = { id: string; score: number; matchedIn: "profile" | "resume"; snippet: string };

export type SignUpResult = { profile: Profile | null };

export type CriterionDraft = { type: CriterionType; description: string; weight: number; config: { path?: string } };
export type MilestoneDraft = { title: string; description: string; percent: number; dueDate: string; criteria: CriterionDraft[] };
export type ProjectDraft = {
  title: string; brief: string; budgetCents: number; freelancerId: string; milestones: MilestoneDraft[];
  latePenaltyPerDay: number; latePenaltyCap: number;
};

export type SubmissionInput = {
  milestoneId: string;
  repoUrl: string;
  commitSha: string | null;
  notes: string;
  results: { criterionId: string; passed: boolean; evidence: string }[];
};

/** Which real integrations are switched on (Supabase app_settings + .env). */
export type AppSettings = {
  /** Real PayPal Sandbox through the `paypal` Edge Function. */
  paypalEnabled: boolean;
  /** Public PayPal client id for the checkout buttons (VITE_PAYPAL_CLIENT_ID). */
  paypalClientId: string;
  currency: string;
  /** GitHub checks run in the `github-verify` Edge Function with a server token. */
  serverGithubChecks: boolean;
};

export type CheckOutcome = { commitSha: string; defaultBranch: string; results: { criterionId: string; passed: boolean; evidence: string }[] };

/** Resume change on profile update: undefined = keep, null = remove, File = replace. */
export type ResumeChange = File | null | undefined;

export interface Backend {
  readonly kind: "supabase" | "local";
  currentProfile(): Promise<Profile | null>;
  signUp(input: SignUpInput): Promise<SignUpResult>;
  signIn(email: string, password: string): Promise<Profile>;
  signOut(): Promise<void>;
  onAuthChange(cb: () => void): () => void;
  /** resumeText: undefined = keep what is stored, otherwise the new text read from the resume ("" clears it). */
  updateProfile(input: ProfileInput, resume: ResumeChange, resumeText?: string): Promise<Profile>;
  resumeUrl(resume: ResumeRef): Promise<string>;

  listFreelancers(): Promise<{ profile: Profile; stats: FreelancerStats }[]>;
  /** Keyword search over profiles and resume text. Every keyword must match; every picked skill must be on the profile. */
  searchFreelancers(query: string, skills: string[]): Promise<FreelancerMatch[]>;
  freelancerReviews(freelancerId: string): Promise<Review[]>;
  loadWorkspace(): Promise<Workspace>;

  settings(): Promise<AppSettings>;
  runChecks(milestoneId: string, repoUrl: string, criteria: Criterion[], onProgress?: (m: string) => void): Promise<CheckOutcome>;
  paypalCreateOrder(projectId: string): Promise<string>;
  paypalAuthorize(projectId: string, orderId: string): Promise<string>;
  retryPayout(milestoneId: string): Promise<void>;

  createProject(draft: ProjectDraft): Promise<string>;
  updateDraftProject(projectId: string, draft: ProjectDraft): Promise<void>;
  authorizeProject(projectId: string): Promise<string>;
  cancelProject(projectId: string, viaPayPal: boolean): Promise<void>;
  submitMilestone(input: SubmissionInput): Promise<string>;
  setManualResult(verificationId: string, criterionId: string, passed: boolean, note: string): Promise<void>;
  approveRelease(verificationId: string, viaPayPal: boolean): Promise<string>;
  requestRevision(verificationId: string, message: string): Promise<void>;
  submitReview(projectId: string, rating: number, body: string): Promise<void>;
}
