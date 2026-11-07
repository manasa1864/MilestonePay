export type Role = "client" | "freelancer";
export type ProjectStatus = "draft" | "in_progress" | "completed" | "cancelled";
export type MilestoneStatus = "not_started" | "in_progress" | "submitted" | "revision_requested" | "approved";
export type CriterionType = "CI_PASSES" | "FILE_EXISTS" | "PR_MERGED" | "MANUAL_REVIEW";
export type VerificationStatus = "pending_review" | "approved" | "revision_requested" | "superseded";
export type PaymentKind = "authorization" | "capture" | "release";

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
  resume: ResumeRef | null;
  createdAt: string;
};

export type FreelancerStats = {
  verifiedMilestones: number;
  capturedCents: number;
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
};

export type SignUpInput = ProfileInput & { email: string; password: string; role: Role; resumeFile: File | null };

export type SignUpResult = { profile: Profile | null };

export type CriterionDraft = { type: CriterionType; description: string; weight: number; config: { path?: string } };
export type MilestoneDraft = { title: string; description: string; percent: number; dueDate: string; criteria: CriterionDraft[] };
export type ProjectDraft = { title: string; brief: string; budgetCents: number; freelancerId: string; milestones: MilestoneDraft[] };

export type SubmissionInput = {
  milestoneId: string;
  repoUrl: string;
  commitSha: string | null;
  notes: string;
  results: { criterionId: string; passed: boolean; evidence: string }[];
};

/** Resume change on profile update: undefined = keep, null = remove, File = replace. */
export type ResumeChange = File | null | undefined;

export interface Backend {
  readonly kind: "supabase" | "local";
  currentProfile(): Promise<Profile | null>;
  signUp(input: SignUpInput): Promise<SignUpResult>;
  signIn(email: string, password: string): Promise<Profile>;
  signOut(): Promise<void>;
  onAuthChange(cb: () => void): () => void;
  updateProfile(input: ProfileInput, resume: ResumeChange): Promise<Profile>;
  resumeUrl(resume: ResumeRef): Promise<string>;

  listFreelancers(): Promise<{ profile: Profile; stats: FreelancerStats }[]>;
  freelancerReviews(freelancerId: string): Promise<Review[]>;
  loadWorkspace(): Promise<Workspace>;

  createProject(draft: ProjectDraft): Promise<string>;
  authorizeProject(projectId: string): Promise<string>;
  cancelProject(projectId: string): Promise<void>;
  submitMilestone(input: SubmissionInput): Promise<string>;
  setManualResult(verificationId: string, criterionId: string, passed: boolean, note: string): Promise<void>;
  approveRelease(verificationId: string): Promise<string>;
  requestRevision(verificationId: string, message: string): Promise<void>;
  submitReview(projectId: string, rating: number, body: string): Promise<void>;
}
