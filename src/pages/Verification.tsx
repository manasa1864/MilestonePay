import { useState } from "react";
import { act, useApp } from "../app-context";
import { backend } from "../lib/backend";
import { date, money as fmt, pad, when } from "../lib/format";
import { criterionLabels } from "../lib/plan";
import { criteriaOf, money, personName, submissionOf, verificationBadge, verificationsOf } from "../lib/select";
import { Button, Empty, Icon, Modal, StatusBadge } from "../ui";

export function Verification({ verificationId }: { verificationId: string }) {
  const ctx = useApp();
  const { ws, user, go } = ctx;
  const v = ws.verifications.find((x) => x.id === verificationId);
  const m = v && ws.milestones.find((x) => x.id === v.milestoneId);
  const p = m && ws.projects.find((x) => x.id === m.projectId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"approve" | "revise" | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  if (!v || !m || !p) return <Empty title="Evidence report not found" action={<Button onClick={() => go("/projects")}>Projects</Button>}/>;
  const client = user.role === "client";
  const sub = submissionOf(ws, v.submissionId);
  const crit = criteriaOf(ws, m.id);
  const pending = v.status === "pending_review";
  const processing = v.status === "processing";
  const viaPayPal = p.paymentMode === "paypal";
  const late = v.penaltyPercent > 0;
  const awaitingManual = v.results.filter((r) => r.passed === null).length;
  const passed = v.results.filter((r) => r.passed);
  const failed = v.results.filter((r) => r.passed === false);
  const weightOf = (ids: string[]) => crit.filter((c) => ids.includes(c.id)).reduce((a, c) => a + c.weight, 0);
  const passedW = weightOf(passed.map((r) => r.criterionId));
  const failedW = weightOf(failed.map((r) => r.criterionId));
  const b = verificationBadge[v.status];
  const history = verificationsOf(ws, m.id);
  const totals = money(ws, p.id);
  const failingText = failed.map((r) => `• ${crit.find((c) => c.id === r.criterionId)?.description}: ${r.evidence}`).join("\n");

  async function decide(kind: "approve" | "revise") {
    setBusy(true);
    const ok = kind === "approve"
      ? await act(ctx, () => backend.approveRelease(v!.id, viaPayPal), viaPayPal ? `${fmt(v!.proposedCents)} captured in PayPal Sandbox and sent to the freelancer.` : `${fmt(v!.proposedCents)} captured (simulated).`)
      : await act(ctx, () => backend.requestRevision(v!.id, message).then(() => "ok"), "Revision requested. The freelancer has been notified.");
    setBusy(false);
    setDialog(null);
    if (ok) go(`/project/${p!.id}`);
  }

  async function setManual(criterionId: string, value: boolean) {
    await act(ctx, () => backend.setManualResult(v!.id, criterionId, value, ""));
  }

  const actions = client && processing
    ? <Button onClick={() => decide("approve")} disabled={busy}>{busy ? "Finishing…" : "Finish PayPal capture"}</Button>
    : client && pending
    ? <><Button kind="secondary" onClick={() => { setMessage(failingText ? `Please address the following:\n${failingText}` : ""); setDialog("revise"); }}>Request revision</Button><Button onClick={() => setDialog("approve")} disabled={awaitingManual > 0 || v.proposedCents <= 0} title={awaitingManual ? "Review the client-review criteria first" : undefined}>Approve {fmt(v.proposedCents)} release</Button></>
    : !client && m.status === "revision_requested" && v.status === "revision_requested"
      ? <><Button kind="secondary" onClick={() => go(`/project/${p.id}`)}>Back to project</Button><Button onClick={() => go(`/milestone/${m.id}/submit`)}>Address feedback</Button></>
      : <Button kind="secondary" onClick={() => go(`/project/${p.id}`)}>Back to project</Button>;

  return <>
    <div className="back-row"><button onClick={() => go(`/project/${p.id}`)}><Icon name="back" size={16}/> {p.title}</button></div>
    <div className="report-top"><div><div className="eyebrow">EVIDENCE REPORT · VR-{v.id.slice(0, 6).toUpperCase()}</div><h1>Milestone verification</h1><p>{p.title} · Milestone {pad(m.position)} · {m.title}</p></div><div className="report-actions">{actions}</div></div>
    {client && pending && awaitingManual > 0 && <div className="profile-nudge"><div><b>{awaitingManual} criterion{awaitingManual === 1 ? "" : "s"} need{awaitingManual === 1 ? "s" : ""} your judgement</b><p>Mark each client-review criterion as passed or not passed below. The release amount updates automatically.</p></div></div>}
    <section className="audit-identity"><div><span>REPOSITORY</span>{sub ? <a href={sub.repoUrl} target="_blank" rel="noreferrer noopener"><Icon name="github" size={16}/> {sub.repoUrl.replace("https://", "")} <Icon name="external" size={13}/></a> : <b>—</b>}</div><div><span>COMMIT</span>{sub?.commitSha ? <a className="mono" href={`${sub.repoUrl}/commit/${sub.commitSha}`} target="_blank" rel="noreferrer noopener">{sub.commitSha.slice(0, 7)}</a> : <b>—</b>}</div><div><span>SUBMITTED</span><b>{when(v.createdAt)}</b></div><div><span>STATUS</span><StatusBadge tone={b.tone}>{b.label}</StatusBadge></div></section>
    <section className="score-grid"><div className="score-primary"><span>WEIGHTED VERIFICATION SCORE</span><strong>{Math.round(v.scorePercent)}<span>%</span></strong><div className="verification-bar"><i style={{ width: `${passedW}%` }}/><em style={{ width: `${failedW}%` }}/></div><p>{passed.length} of {v.results.length} acceptance criteria passed{awaitingManual ? ` · ${awaitingManual} awaiting client review` : ""}</p></div><div><span>PASSED</span><strong>{pad(passed.length)}</strong><small>{passedW}% total weight</small></div><div><span>FAILED</span><strong>{pad(failed.length)}</strong><small>{failedW}% total weight</small></div><div className="release-box"><span>{v.status === "approved" ? "CAPTURED" : "PROPOSED RELEASE"}</span><strong className="mono">{fmt(v.status === "approved" ? m.capturedCents : v.proposedCents)}</strong><small>{late ? `${fmt(v.baseCents)} − ${v.penaltyPercent}% late penalty` : `${Math.round(v.scorePercent)}% of ${fmt(m.amountCents)}`}</small></div></section>
    {late && <div className="late-note"><Icon name="alert" size={15}/><p><b>Submitted {v.daysLate} day{v.daysLate === 1 ? "" : "s"} after the due date{m.dueDate ? ` (${date(m.dueDate)})` : ""}.</b> The project’s policy is {p.latePenaltyPerDay}% per day late, capped at {p.latePenaltyCap}%, so the release is reduced by {v.penaltyPercent}%: {fmt(v.baseCents)} → {fmt(v.proposedCents)}.</p></div>}
    {processing && <div className="late-note"><Icon name="alert" size={15}/><p><b>The PayPal capture didn’t finish.</b> {client ? "Click “Finish PayPal capture” to complete it. PayPal won’t charge twice." : "Waiting for the client to finish the payment."}</p></div>}
    <div className="method-note"><b>How this was calculated</b><p>The milestone amount ({fmt(m.amountCents)}) is multiplied by the combined weight of passed criteria{p.latePenaltyPerDay > 0 ? `, then reduced by ${p.latePenaltyPerDay}% per day the submission was late (max ${p.latePenaltyCap}%)` : ""}. GitHub checks are deterministic{sub?.checkedBy === "server" ? " and ran on the MilestonePay server" : ""}; client-review criteria are decided by the client. Nothing is captured until the client approves.</p></div>
    {sub?.notes && <div className="freelancer-notes"><span>NOTES FROM {personName(ws, sub.freelancerId).toUpperCase()}</span><p>{sub.notes}</p></div>}
    <section className="evidence-table"><div className="evidence-head"><span>Criterion</span><span>Type</span><span>Result</span><span>Weight</span><span/></div>
      {crit.map((c) => {
        const r = v.results.find((x) => x.criterionId === c.id);
        const state = r?.passed === true ? "pass" : r?.passed === false ? "fail" : "wait";
        const isOpen = expanded === c.id || (client && pending && c.type === "MANUAL_REVIEW" && r?.passed === null);
        return <article key={c.id} className={state === "fail" ? "failed" : state === "pass" ? "passed" : "waiting"}>
          <button className="evidence-row" onClick={() => setExpanded(expanded === c.id ? null : c.id)}><div><span className={`result-mark ${state}`}><Icon name={state === "pass" ? "check" : state === "fail" ? "close" : "more"} size={14}/></span><div><b>{c.description}</b><small>{r?.source === "manual" ? "Client review" : "Deterministic GitHub check"}</small></div></div><span><span className="type-chip">{criterionLabels[c.type].label}</span></span><span><StatusBadge tone={state === "pass" ? "complete" : state === "fail" ? "failed" : "pending"}>{state === "pass" ? "Passed" : state === "fail" ? "Failed" : "Awaiting review"}</StatusBadge></span><b>{c.weight}%</b><Icon name="chevron" size={16}/></button>
          {isOpen && <div className="evidence-detail"><div><span>EVIDENCE</span><p>{r?.evidence ?? "No result recorded."}</p>{c.type === "FILE_EXISTS" && c.config.path && <p className="muted-text">Expected file: <code>{c.config.path}</code></p>}</div>
            {sub && c.type !== "MANUAL_REVIEW" && <a href={c.type === "CI_PASSES" && sub.commitSha ? `${sub.repoUrl}/commit/${sub.commitSha}` : c.type === "PR_MERGED" ? `${sub.repoUrl}/pulls?q=is%3Apr+is%3Amerged` : c.config.path && sub.commitSha ? `${sub.repoUrl}/blob/${sub.commitSha}/${c.config.path}` : sub.repoUrl} target="_blank" rel="noreferrer noopener">Inspect on GitHub <Icon name="external" size={13}/></a>}
            {client && pending && c.type === "MANUAL_REVIEW" && <div className="manual-decision"><span>YOUR DECISION</span><div><Button kind={r?.passed === true ? "primary" : "secondary"} onClick={() => setManual(c.id, true)}><Icon name="check" size={14}/> Passed</Button><Button kind={r?.passed === false ? "danger" : "secondary"} onClick={() => setManual(c.id, false)}><Icon name="close" size={14}/> Not passed</Button></div><small>Open the repository and judge this criterion against the brief.</small></div>}
          </div>}
        </article>;
      })}
    </section>
    {history.length > 1 && <section className="section-block"><div className="section-heading"><div><h2>Submission history</h2><p>All verifications for this milestone</p></div></div><div className="history-list">{history.map((h, i) => { const hb = verificationBadge[h.status]; return <div key={h.id} className={h.id === v.id ? "current" : ""}><span className="history-index">{pad(history.length - i)}</span><div><b>{when(h.createdAt)}</b><p>{Math.round(h.scorePercent)}% weighted · {fmt(h.proposedCents)} proposed</p></div><StatusBadge tone={hb.tone}>{hb.label}</StatusBadge>{h.id === v.id ? <small className="muted-text">Viewing</small> : <button className="text-link" onClick={() => go(`/verification/${h.id}`)}>Open</button>}<span/></div>; })}</div></section>}
    <div className="report-footer"><p>Checks ran against the submitted commit. Payment capture requires explicit client approval.</p><div>{actions}</div></div>

    {dialog === "approve" && <Modal title="Approve payment release?" onClose={() => setDialog(null)} actions={<><Button kind="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => decide("approve")} disabled={busy}>{busy ? "Capturing…" : `Approve and capture ${fmt(v.proposedCents)}`}</Button></>}>
      <p>{v.scorePercent < 100 ? "You are approving a partial capture for the criteria that passed. The unpassed portion is not paid for this milestone." : "All criteria passed. The full milestone amount will be captured."}</p>
      <div className="modal-summary"><div><span>Project</span><b>{p.title}</b></div><div><span>Milestone</span><b>{pad(m.position)} · {m.title}</b></div>{late && <><div><span>For passed criteria</span><b className="mono">{fmt(v.baseCents)}</b></div><div><span>Late penalty ({v.daysLate} day{v.daysLate === 1 ? "" : "s"})</span><b className="mono">−{v.penaltyPercent}%</b></div></>}<div><span>Authorization remaining</span><b className="mono">{fmt(totals.remaining)}</b></div><div className="modal-total"><span>Amount to capture</span><strong className="mono">{fmt(v.proposedCents)}</strong></div></div>
      <div className="legal-note compact"><Icon name="alert" size={16}/><p>{viaPayPal ? "This captures the amount from the client’s PayPal Sandbox authorization and pays it out to the freelancer’s PayPal." : "This simulates the capture; no PayPal account is charged."} {m.position === Math.max(...ws.milestones.filter((x) => x.projectId === p.id).map((x) => x.position)) ? "This is the final milestone: any remaining authorization will be released." : "The next milestone opens for the freelancer."}</p></div>
    </Modal>}
    {dialog === "revise" && <Modal title="Request a revision" icon="alert" onClose={() => setDialog(null)} actions={<><Button kind="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={() => decide("revise")} disabled={busy || message.trim().length < 5}>{busy ? "Sending…" : "Send revision request"}</Button></>}>
      <p>Nothing is captured. The freelancer sees your message and can resubmit; all checks run again.</p>
      <div className="field modal-field"><label>What needs to change?</label><textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} placeholder="Be specific about what’s missing and how you’ll judge it."/></div>
    </Modal>}
  </>;
}
