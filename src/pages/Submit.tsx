import { useState, type FormEvent } from "react";
import { act, useApp } from "../app-context";
import { backend } from "../lib/backend";
import { date, errorText, money as fmt, pad, when } from "../lib/format";
import { parseRepoUrl } from "../lib/github";
import type { CheckOutcome } from "../lib/types";
import { criterionLabels } from "../lib/plan";
import { criteriaOf, latestVerification, milestoneBadge, openRevision, submissionOf } from "../lib/select";
import { Button, Empty, Icon, Notice, PageHeader, Spinner, StatusBadge } from "../ui";

export function Submit({ milestoneId }: { milestoneId: string }) {
  const ctx = useApp();
  const { ws, user, go, settings } = ctx;
  const m = ws.milestones.find((x) => x.id === milestoneId);
  const p = m && ws.projects.find((x) => x.id === m.projectId);
  const prev = m ? latestVerification(ws, m.id) : undefined;
  const prevSub = prev ? submissionOf(ws, prev.submissionId) : undefined;
  const ghDefault = user.githubUsername ? `https://github.com/${user.githubUsername}/` : "";
  const [url, setUrl] = useState(prevSub?.repoUrl ?? ghDefault);
  const [notes, setNotes] = useState("");
  const [phase, setPhase] = useState<"idle" | "checking" | "checked" | "submitting">("idle");
  const [progress, setProgress] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<CheckOutcome | null>(null);
  const [error, setError] = useState("");

  if (!m || !p) return <Empty title="Milestone not found" action={<Button onClick={() => go("/projects")}>My work</Button>}/>;
  const crit = criteriaOf(ws, m.id);
  const rev = openRevision(ws, m.id);
  const open = p.status === "in_progress" && (m.status === "in_progress" || m.status === "revision_requested");
  const b = milestoneBadge[m.status];

  async function runChecks(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!parseRepoUrl(url)) { setError("Enter a repository URL like https://github.com/owner/repo"); return; }
    setPhase("checking");
    setProgress([]);
    setOutcome(null);
    try {
      const out = await backend.runChecks(m!.id, url, crit, (msg) => setProgress((x) => [...x, msg]));
      setOutcome(out);
      setPhase("checked");
    } catch (err) {
      setError(errorText(err));
      setPhase("idle");
    }
  }

  async function submit() {
    if (!outcome || !m) return;
    setPhase("submitting");
    const id = await act(ctx, () => backend.submitMilestone({ milestoneId: m.id, repoUrl: url.trim().replace(/\/+$/, ""), commitSha: outcome.commitSha, notes, results: outcome.results }), "Submitted. The client has been asked to review the evidence.");
    if (id) go(`/verification/${id}`);
    else setPhase("checked");
  }

  const today = new Date().toISOString().slice(0, 10);
  const daysLate = m.dueDate && today > m.dueDate ? Math.round((Date.parse(today) - Date.parse(m.dueDate)) / 86_400_000) : 0;
  const penalty = Math.min(p.latePenaltyCap ?? 0, (p.latePenaltyPerDay ?? 0) * daysLate);
  const totalW = crit.reduce((a, c) => a + c.weight, 0);
  const passedW = outcome ? crit.reduce((a, c) => a + (outcome.results.find((r) => r.criterionId === c.id)?.passed ? c.weight : 0), 0) : 0;
  const manualW = crit.filter((c) => c.type === "MANUAL_REVIEW").reduce((a, c) => a + c.weight, 0);

  return <div className="narrow-page"><PageHeader eyebrow={`${p.title} · Milestone ${pad(m.position)}`} title={m.status === "revision_requested" ? "Resubmit milestone" : "Submit milestone"} subtitle="Point MilestonePay at the public GitHub repository containing your deliverable."/>
    <section className="submission-context"><div><span>CURRENT MILESTONE</span><h2>{m.title}</h2><p>{m.description || "No description."}</p><p className="mono">{fmt(m.amountCents)}</p></div><StatusBadge tone={b.tone}>{b.label}</StatusBadge></section>
    {open && m.dueDate && <div className={`deadline-strip ${daysLate ? "late" : ""}`}><Icon name={daysLate ? "alert" : "check"} size={14}/>{daysLate
      ? <span>Due {date(m.dueDate)}: submitting today is <b>{daysLate} day{daysLate === 1 ? "" : "s"} late</b>{penalty > 0 ? <> → the release is reduced by <b>{penalty}%</b> ({p.latePenaltyPerDay}%/day, max {p.latePenaltyCap}%).</> : "."}</span>
      : <span>Due {date(m.dueDate)}. Submitting today is on time{p.latePenaltyPerDay > 0 ? `; after that, ${p.latePenaltyPerDay}% per day late (max ${p.latePenaltyCap}%)` : ""}.</span>}</div>}
    {rev && <div className="revision-callout standalone"><span>CLIENT REQUESTED A REVISION · {when(rev.createdAt)}</span><p>{rev.message}</p></div>}
    <section className="criteria-compact"><h3>Acceptance criteria</h3>{crit.map((c) => {
      const r = outcome?.results.find((x) => x.criterionId === c.id);
      return <div key={c.id} className="criterion-check"><span className="type-chip">{criterionLabels[c.type].label}</span><p>{c.description}{c.type === "FILE_EXISTS" && c.config.path ? <code>{c.config.path}</code> : null}{r && <small className={r.passed ? "good" : "bad"}>{r.evidence}</small>}{outcome && c.type === "MANUAL_REVIEW" && <small className="muted-text">Reviewed by the client after you submit.</small>}</p><b>{c.weight}%</b>{outcome && <span className={`result-mark ${c.type === "MANUAL_REVIEW" ? "wait" : r?.passed ? "pass" : "fail"}`}><Icon name={c.type === "MANUAL_REVIEW" ? "more" : r?.passed ? "check" : "close"} size={13}/></span>}</div>;
    })}</section>
    {!open ? <div className="success-state"><h2>{m.status === "submitted" ? "Waiting for the client" : m.status === "approved" ? "Milestone approved" : "Not open yet"}</h2><p>{m.status === "submitted" ? "This milestone has been submitted and is waiting for the client’s decision." : m.status === "approved" ? "This milestone is complete." : "This milestone opens once the previous one is approved."}</p><div>{prev && <Button onClick={() => go(`/verification/${prev.id}`)}>View evidence report</Button>}<Button kind="secondary" onClick={() => go(`/project/${p.id}`)}>Back to project</Button></div></div>
    : <form className="submit-form" onSubmit={runChecks}>
      <div className="field"><label>GitHub repository URL</label><div className={`url-input ${error ? "invalid" : ""}`}><Icon name="github" size={19}/><input value={url} onChange={(e) => { setUrl(e.target.value); setError(""); if (phase === "checked") setPhase("idle"); }} placeholder="https://github.com/username/repository" disabled={phase === "checking" || phase === "submitting"}/></div>{error ? <small className="error-text">{error}</small> : <small>Checks run against the latest commit on the default branch.{settings.serverGithubChecks ? " They run on the MilestonePay server, which can also read private repositories shared with its GitHub account." : " The repository must be public."}</small>}</div>
      <div className="field"><div className="label-row"><label>Notes for the client</label><span className="optional-tag">Optional</span></div><textarea className="short" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Anything the client should know when reviewing — setup steps, trade-offs, what changed since the last submission…"/></div>
      {phase === "checking" && <div className="check-progress">{progress.map((x, i) => <div key={i}>{i === progress.length - 1 ? <Spinner dark/> : <Icon name="check" size={13}/>} {x}</div>)}</div>}
      {outcome && phase !== "checking" && <Notice tone={passedW === totalW - manualW ? "success" : "warn"}><b>Automated checks: {passedW}% of {totalW - manualW}% passed</b> on commit <code>{outcome.commitSha.slice(0, 7)}</code> ({outcome.defaultBranch}).{manualW > 0 && ` ${manualW}% is reviewed by the client.`} {passedW < totalW - manualW ? "You can fix the failing checks and run them again, or submit as-is for a partial release." : "Everything automated passed."}</Notice>}
      <div className="form-actions"><Button kind="secondary" onClick={() => go(`/project/${p.id}`)}>Cancel</Button>
        {phase === "checked" || phase === "submitting"
          ? <><Button kind="secondary" type="submit" disabled={phase === "submitting"}>Run checks again</Button><Button onClick={submit} disabled={phase === "submitting"}>{phase === "submitting" ? <><Spinner dark/> Submitting</> : <>Submit for client review <Icon name="arrow" size={16}/></>}</Button></>
          : <Button type="submit" disabled={phase === "checking"}>{phase === "checking" ? <><Spinner dark/> Inspecting repository</> : <>Run verification checks <Icon name="arrow" size={16}/></>}</Button>}
      </div>
    </form>}
  </div>;
}
