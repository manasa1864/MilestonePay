import { useState } from "react";
import { act, useApp } from "../app-context";
import { backend } from "../lib/backend";
import { date, money as fmt, pad, when } from "../lib/format";
import { criterionLabels } from "../lib/plan";
import { criteriaOf, currentMilestone, isOverdue, latestVerification, milestoneBadge, milestonesOf, money, openRevision, personName, projectBadge, submissionOf } from "../lib/select";
import { Button, Empty, Icon, Modal, PageHeader, StatusBadge } from "../ui";
import { MilestoneChart, type ChartRow } from "../charts/MilestoneChart";

export function ProjectDetail({ projectId }: { projectId: string }) {
  const ctx = useApp();
  const { ws, user, go } = ctx;
  const p = ws.projects.find((x) => x.id === projectId);
  const ms = p ? milestonesOf(ws, p.id) : [];
  const cur = p ? currentMilestone(ws, p.id) : undefined;
  const [open, setOpen] = useState<string | null>(cur?.id ?? null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  if (!p) return <Empty title="Project not found" action={<Button onClick={() => go("/projects")}>All projects</Button>}>It may have been removed, or you may not have access.</Empty>;

  const client = user.role === "client";
  const badge = projectBadge(ws, p);
  const totals = money(ws, p.id);
  const pays = ws.payments.filter((x) => x.projectId === p.id);
  const unpaid = p.paymentMode === "paypal" ? ms.filter((m) => m.status === "approved" && m.capturedCents > 0 && !pays.some((x) => x.kind === "payout" && x.milestoneId === m.id)) : [];
  const pct = p.budgetCents ? (100 * totals.captured) / p.budgetCents : 0;
  const reviewed = ws.reviews.some((r) => r.projectId === p.id);
  const canReview = client && !reviewed && pays.some((x) => x.kind === "capture");
  const activity = ws.activity.filter((a) => a.projectId === p.id).slice(0, 8);
  const counterpart = ws.people[(client ? p.freelancerId : p.clientId) ?? ""];
  const pendingVerification = cur && cur.status === "submitted" ? latestVerification(ws, cur.id) : undefined;

  const headerAction = client
    ? <div className="header-status"><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
        {p.status === "draft" && <Button kind="secondary" onClick={() => go(`/project/${p.id}/edit`)}>Edit plan</Button>}
        {p.status === "draft" && <Button onClick={() => go(`/project/${p.id}/fund`)}>Authorize funding</Button>}
        {pendingVerification && <Button onClick={() => go(`/verification/${pendingVerification.id}`)}>Review submission</Button>}
        {canReview && <Button kind="secondary" onClick={() => go(`/review/${p.id}`)}>Review freelancer</Button>}
        {(p.status === "draft" || p.status === "in_progress") && <Button kind="ghost" onClick={() => setConfirmCancel(true)}>Cancel project</Button>}
      </div>
    : <div className="header-status"><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
        {p.status === "in_progress" && cur && (cur.status === "in_progress" || cur.status === "revision_requested") && <Button onClick={() => go(`/milestone/${cur.id}/submit`)}>{cur.status === "revision_requested" ? "Resubmit" : "Submit"} milestone {pad(cur.position)}</Button>}
      </div>;

  return <>
    <div className="back-row"><button onClick={() => go("/projects")}><Icon name="back" size={16}/> {client ? "All projects" : "My work"}</button></div>
    <PageHeader title={p.title} subtitle="Software delivery with milestone-based verification and payment." action={headerAction}/>
    {p.status === "draft" && <div className="profile-nudge"><div><b>{client ? "This project isn’t funded yet" : "Waiting for the client to fund this project"}</b><p>{client ? "Authorize the budget in PayPal Sandbox so the freelancer can start milestone 01." : "You can start once the client authorizes the budget."}</p></div>{client && <Button onClick={() => go(`/project/${p.id}/fund`)}>Authorize {fmt(p.budgetCents)}</Button>}</div>}
    <div className="project-meta">
      <div><span>{client ? "FREELANCER" : "CLIENT"}</span>{client && p.freelancerId ? <button className="text-button strong" onClick={() => go(`/freelancers/${p.freelancerId}`)}>{personName(ws, p.freelancerId)}</button> : <b>{personName(ws, client ? p.freelancerId : p.clientId)}</b>}
        {counterpart && <div className="contact-lines">{counterpart.email && <a href={`mailto:${counterpart.email}?subject=${encodeURIComponent(p.title)}`}>{counterpart.email}</a>}{!client && counterpart.company && <small>{counterpart.company}</small>}{!client && counterpart.portfolioUrl && <a href={counterpart.portfolioUrl} target="_blank" rel="noreferrer noopener">Company website <Icon name="external" size={11}/></a>}</div>}</div>
      <div><span>BUDGET</span><b className="mono">{fmt(p.budgetCents)}</b></div>
      <div><span>{p.completedAt ? "COMPLETED" : "FUNDED"}</span><b>{date(p.completedAt ?? p.authorizedAt)}</b></div>
      <div><span>LATE PENALTY</span><b>{p.latePenaltyPerDay > 0 && p.latePenaltyCap > 0 ? `${p.latePenaltyPerDay}%/day, max ${p.latePenaltyCap}%` : "None"}</b><small className="muted-text mono">MP-{p.id.slice(0, 6).toUpperCase()}</small></div>
    </div>
    <section className="brief-panel"><button onClick={() => setBriefOpen(!briefOpen)}><span>PROJECT BRIEF</span><Icon name="chevron" size={15}/></button>{briefOpen ? <p>{p.brief}</p> : <p className="clamp">{p.brief}</p>}</section>
    {ms.length > 0 && <section className="chart-card"><div className="section-heading"><div><h2>Milestones at a glance</h2><p>{fmt(totals.captured)} captured of {fmt(p.budgetCents)} · {ms.filter((m) => m.status === "approved").length} of {ms.length} milestones approved</p></div></div>
      <MilestoneChart mode="progress" legend={["Captured", "Not captured"]} label={`Milestones for ${p.title}`} rows={(() => {
        let prev = (p.authorizedAt ?? p.createdAt).slice(0, 10);
        return ms.map((m): ChartRow => {
          const start = prev;
          if (m.dueDate) prev = m.dueDate;
          return { key: m.id, label: `${pad(m.position)} · ${m.title}`, sub: milestoneBadge[m.status].label, amountCents: m.amountCents, capturedCents: m.capturedCents, start, due: m.dueDate, done: m.status === "approved", overdue: isOverdue(m) };
        });
      })()}/>
    </section>}
    <div className="detail-layout"><main className="timeline-panel"><div className="section-heading"><div><h2>Milestone timeline</h2><p>{ms.filter((m) => m.status === "approved").length} of {ms.length} milestones approved</p></div></div>
      <div className="timeline">{ms.map((m) => {
        const b = milestoneBadge[m.status];
        const v = latestVerification(ws, m.id);
        const sub = v ? submissionOf(ws, v.submissionId) : undefined;
        const rev = openRevision(ws, m.id);
        const crit = criteriaOf(ws, m.id);
        const tl = m.status === "approved" ? "complete" : m.status === "not_started" ? "pending" : "active";
        return <article className={`timeline-item ${tl}`} key={m.id}>
          <div className="timeline-node"><Icon name={m.status === "approved" ? "check" : "more"} size={14}/></div>
          <button className="timeline-head" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}><span>{pad(m.position)}</span><div><h3>{m.title}</h3><p>{m.description || "No description."}</p></div><div className="timeline-amount"><b className="mono">{fmt(m.amountCents)}</b><StatusBadge tone={b.tone}>{b.label}</StatusBadge>{isOverdue(m) && <StatusBadge tone="failed">Overdue</StatusBadge>}</div><Icon name="chevron" size={17}/></button>
          {open === m.id && <div className="timeline-detail">
            <div className="detail-grid"><div><span>Due</span><b className={isOverdue(m) ? "bad" : ""}>{date(m.dueDate)}{isOverdue(m) ? " · overdue" : ""}</b></div><div><span>Captured</span><b className="mono">{fmt(m.capturedCents)}</b></div>{m.approvedAt && <div><span>Approved</span><b>{date(m.approvedAt)}</b></div>}</div>
            <div><span>Acceptance criteria</span><ul className="criteria-mini">{crit.map((c) => <li key={c.id}><span className="type-chip">{criterionLabels[c.type].label}</span><p>{c.description}{c.type === "FILE_EXISTS" && c.config.path ? <code>{c.config.path}</code> : null}</p><b>{c.weight}%</b></li>)}</ul></div>
            {rev && <div className="revision-callout"><span>REVISION REQUESTED · {when(rev.createdAt)}</span><p>{rev.message}</p></div>}
            {sub && <div><span>Latest submission</span><a href={sub.repoUrl} target="_blank" rel="noreferrer noopener">{sub.repoUrl.replace("https://", "")} <Icon name="external" size={13}/></a>{sub.commitSha && <small className="mono muted-text"> · {sub.commitSha.slice(0, 7)}</small>}</div>}
            {v && <div><span>Verification</span><b>{v.results.filter((r) => r.passed).length} of {v.results.length} criteria passed · {v.scorePercent}% weighted · {fmt(v.proposedCents)} proposed</b></div>}
            <div className="inline-actions">
              {v && <Button kind={client && m.status === "submitted" ? "primary" : "secondary"} onClick={() => go(`/verification/${v.id}`)}>{client && m.status === "submitted" ? "Review & decide" : "Open evidence report"}</Button>}
              {!client && p.status === "in_progress" && (m.status === "in_progress" || m.status === "revision_requested") && <Button onClick={() => go(`/milestone/${m.id}/submit`)}>{m.status === "revision_requested" ? "Resubmit" : "Submit for verification"}</Button>}
              {m.status === "not_started" && <small className="muted-text">{p.status === "draft" ? "Opens after funding." : `Opens after milestone ${pad(m.position - 1)} is approved.`}</small>}
            </div>
          </div>}
        </article>;
      })}</div>
      {activity.length > 0 && <div className="project-activity"><h3>Activity</h3>{activity.map((a) => <div key={a.id}><span>{when(a.createdAt)}</span><p>{a.message}</p></div>)}</div>}
    </main>
    <aside className="money-panel"><div className="money-label">MONEY OVERVIEW</div><h2>Project funding</h2><div className="money-total"><span>Captured</span><strong className="mono">{fmt(totals.captured)}</strong></div><div className="dark-progress"><span style={{ width: `${pct}%` }}/></div>
      <div className="money-stats"><div><span>Total authorized</span><b className="mono">{fmt(totals.authorized)}</b></div><div><span>Remaining</span><b className="mono">{fmt(totals.remaining)}</b></div><div><span>Captured</span><b>{pct.toFixed(1)}%</b></div>{totals.released > 0 && <div><span>Released back</span><b className="mono">{fmt(totals.released)}</b></div>}</div>
      <div className="money-divider"/><h3>Payment activity</h3>
      {pays.length === 0 ? <p className="payment-empty">No payment activity yet.</p> : pays.map((x) => { const m = ms.find((y) => y.id === x.milestoneId); return <div className={`payment-line ${x.kind === "release" ? "muted" : ""}`} key={x.id}><span>{m ? pad(m.position) : "—"}</span><div><b>{x.kind === "authorization" ? "Authorization" : x.kind === "capture" ? `Milestone ${m ? pad(m.position) : ""} captured` : x.kind === "payout" ? `Paid out to freelancer` : "Unused authorization released"}</b><small>{date(x.createdAt)} · {x.reference}{x.note && x.kind === "capture" ? ` · ${x.note}` : ""}</small></div><strong className="mono">{fmt(x.amountCents)}</strong></div>; })}
      {unpaid.length > 0 && <div className="payout-pending"><b>{unpaid.length === 1 ? "1 payout" : `${unpaid.length} payouts`} waiting</b><p>{client ? "The captured amount hasn’t reached the freelancer’s PayPal yet." : user.paypalEmail ? "Your payment hasn’t been sent yet." : "Add a PayPal email to your profile to receive this payment."}</p>
        {!client && !user.paypalEmail ? <Button kind="secondary" onClick={() => go("/settings")}>Add PayPal email</Button> : unpaid.map((m) => <Button key={m.id} kind="secondary" disabled={retrying === m.id} onClick={async () => { setRetrying(m.id); await act(ctx, () => backend.retryPayout(m.id), "Payout sent."); setRetrying(null); }}>{retrying === m.id ? "Sending…" : `Send payout · milestone ${pad(m.position)}`}</Button>)}</div>}
      {p.authorizationExpiresAt && p.status === "in_progress" && <div className={`auth-expiry ${Date.parse(p.authorizationExpiresAt) < Date.now() + 5 * 86_400_000 ? "soon" : ""}`}>Authorization valid until {date(p.authorizationExpiresAt)}</div>}
      <div className="sandbox-foot">{p.paymentMode === "paypal" ? "PAYPAL SANDBOX" : "SIMULATED"} · {p.authorizationRef ?? "NOT AUTHORIZED"}</div>
    </aside></div>
    {confirmCancel && <Modal title="Cancel this project?" icon="alert" onClose={() => setConfirmCancel(false)} actions={<><Button kind="secondary" onClick={() => setConfirmCancel(false)}>Keep project</Button><Button kind="danger" onClick={async () => { setConfirmCancel(false); await act(ctx, () => backend.cancelProject(p.id, p.paymentMode === "paypal"), "Project cancelled."); }}>Cancel project</Button></>}><p>Work stops on all open milestones. {p.status === "in_progress" ? `Captured payments stay with the freelancer; the remaining ${fmt(totals.remaining)} authorization is released.` : "Nothing has been authorized yet."}</p></Modal>}
  </>;
}
