import type { Tone } from "../ui";
import type { Milestone, MilestoneStatus, Project, Verification, VerificationStatus, Workspace } from "./types";

export const milestonesOf = (ws: Workspace, projectId: string) =>
  ws.milestones.filter((m) => m.projectId === projectId).sort((a, b) => a.position - b.position);

export const criteriaOf = (ws: Workspace, milestoneId: string) =>
  ws.criteria.filter((c) => c.milestoneId === milestoneId).sort((a, b) => a.position - b.position);

export const verificationsOf = (ws: Workspace, milestoneId: string) =>
  ws.verifications.filter((v) => v.milestoneId === milestoneId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const latestVerification = (ws: Workspace, milestoneId: string): Verification | undefined => verificationsOf(ws, milestoneId)[0];

export const submissionOf = (ws: Workspace, submissionId: string) => ws.submissions.find((s) => s.id === submissionId);

export const openRevision = (ws: Workspace, milestoneId: string) =>
  ws.revisions.filter((r) => r.milestoneId === milestoneId && !r.resolvedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

export function money(ws: Workspace, projectId?: string) {
  const pays = projectId ? ws.payments.filter((p) => p.projectId === projectId) : ws.payments;
  const sum = (k: string) => pays.filter((p) => p.kind === k).reduce((a, p) => a + p.amountCents, 0);
  const authorized = sum("authorization");
  const captured = sum("capture");
  const released = sum("release");
  return { authorized, captured, released, remaining: Math.max(0, authorized - captured - released) };
}

export function progress(ws: Workspace, projectId: string) {
  const ms = milestonesOf(ws, projectId);
  const done = ms.filter((m) => m.status === "approved").length;
  return { done, total: ms.length, percent: ms.length ? Math.round((100 * done) / ms.length) : 0 };
}

export const currentMilestone = (ws: Workspace, projectId: string): Milestone | undefined =>
  milestonesOf(ws, projectId).find((m) => m.status !== "approved");

export function projectBadge(ws: Workspace, p: Project): { tone: Tone; label: string } {
  if (p.status === "draft") return { tone: "pending", label: "Awaiting funding" };
  if (p.status === "completed") return { tone: "complete", label: "Completed" };
  if (p.status === "cancelled") return { tone: "failed", label: "Cancelled" };
  const cur = currentMilestone(ws, p.id);
  if (cur?.status === "submitted") return { tone: "active", label: "Awaiting review" };
  if (cur?.status === "revision_requested") return { tone: "revision", label: "Needs revision" };
  return { tone: "active", label: "In progress" };
}

export const milestoneBadge: Record<MilestoneStatus, { tone: Tone; label: string }> = {
  not_started: { tone: "pending", label: "Not started" },
  in_progress: { tone: "active", label: "In progress" },
  submitted: { tone: "active", label: "Awaiting review" },
  revision_requested: { tone: "revision", label: "Needs revision" },
  approved: { tone: "complete", label: "Approved" },
};

export const verificationBadge: Record<VerificationStatus, { tone: Tone; label: string }> = {
  pending_review: { tone: "active", label: "Awaiting decision" },
  processing: { tone: "active", label: "Payment processing" },
  approved: { tone: "complete", label: "Approved" },
  revision_requested: { tone: "revision", label: "Revision requested" },
  superseded: { tone: "pending", label: "Superseded" },
};

/** A milestone is overdue when it has a due date in the past and is still waiting on the freelancer. */
export function isOverdue(m: Milestone) {
  if (!m.dueDate || (m.status !== "in_progress" && m.status !== "revision_requested")) return false;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return m.dueDate < todayStr;
}

export function personName(ws: Workspace, id: string | null | undefined) {
  return (id && ws.people[id]?.fullName) || "—";
}
