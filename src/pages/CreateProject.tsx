import { useEffect, useState, type FormEvent } from "react";
import { act, useApp } from "../app-context";
import { backend } from "../lib/backend";
import { errorText, initials, money as fmt, pad } from "../lib/format";
import { criterionLabels, newCriterion, rebalanceWeights, suggestPlan } from "../lib/plan";
import type { CriterionType, FreelancerStats, MilestoneDraft, Profile } from "../lib/types";
import { Button, Empty, Icon, Notice, PageHeader, Spinner, StatusBadge } from "../ui";

const types = Object.keys(criterionLabels) as CriterionType[];

function planProblems(ms: MilestoneDraft[]): string[] {
  const out: string[] = [];
  const pct = ms.reduce((a, m) => a + (Number(m.percent) || 0), 0);
  if (Math.abs(pct - 100) > 0.001) out.push(`Milestone percentages must total 100% (currently ${pct}%).`);
  ms.forEach((m, i) => {
    if (m.title.trim().length < 2) out.push(`Milestone ${pad(i + 1)} needs a title.`);
    if (!(m.percent > 0)) out.push(`Milestone ${pad(i + 1)} needs a percentage above 0.`);
    if (!m.criteria.length) out.push(`Milestone ${pad(i + 1)} needs at least one criterion.`);
    const w = m.criteria.reduce((a, c) => a + (Number(c.weight) || 0), 0);
    if (m.criteria.length && w !== 100) out.push(`Criteria weights in milestone ${pad(i + 1)} must total 100% (currently ${w}%).`);
    m.criteria.forEach((c) => {
      if (c.description.trim().length < 2) out.push(`A criterion in milestone ${pad(i + 1)} needs a description.`);
      if (c.type === "FILE_EXISTS" && !c.config.path?.trim()) out.push(`A "File exists" criterion in milestone ${pad(i + 1)} needs a file path.`);
      if (!(c.weight > 0)) out.push(`Every criterion in milestone ${pad(i + 1)} needs a weight above 0.`);
    });
  });
  return Array.from(new Set(out));
}

export function CreateProject({ preselect }: { preselect?: string }) {
  const ctx = useApp();
  const { go } = ctx;
  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [budget, setBudget] = useState("");
  const [freelancerId, setFreelancerId] = useState(preselect ?? "");
  const [freelancers, setFreelancers] = useState<{ profile: Profile; stats: FreelancerStats }[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [plan, setPlan] = useState<MilestoneDraft[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    backend.listFreelancers().then(setFreelancers).catch((e) => { setLoadError(errorText(e)); setFreelancers([]); });
  }, []);

  const budgetCents = Math.round((Number(budget) || 0) * 100);
  const step1Valid = title.trim().length >= 3 && brief.trim().length >= 20 && budgetCents >= 100 && !!freelancerId;
  const problems = planProblems(plan);
  const chosen = freelancers?.find((f) => f.profile.id === freelancerId)?.profile;

  function next(e: FormEvent) {
    e.preventDefault();
    setAttempted(true);
    if (!step1Valid) return;
    if (!plan.length) setPlan(suggestPlan(`${title} ${brief}`));
    setStep(2);
    window.scrollTo({ top: 0 });
  }

  const updM = (i: number, patch: Partial<MilestoneDraft>) => setPlan((p) => p.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const updC = (i: number, k: number, patch: Partial<MilestoneDraft["criteria"][number]>) =>
    setPlan((p) => p.map((m, j) => (j === i ? { ...m, criteria: m.criteria.map((c, l) => (l === k ? { ...c, ...patch } : c)) } : m)));
  const move = (i: number, d: -1 | 1) => setPlan((p) => { const n = [...p]; const t = n[i + d]; if (!t) return p; n[i + d] = n[i]; n[i] = t; return n; });

  async function create() {
    if (problems.length || saving) return;
    setSaving(true);
    const id = await act(ctx, () => backend.createProject({ title: title.trim(), brief: brief.trim(), budgetCents, freelancerId, milestones: plan }), "Project created. Authorize funding to start work.");
    setSaving(false);
    if (id) go(`/project/${id}/fund`);
  }

  if (step === 1) {
    const list = (freelancers ?? []).filter((f) => {
      const n = search.trim().toLowerCase();
      return !n || f.profile.fullName.toLowerCase().includes(n) || f.profile.headline.toLowerCase().includes(n) || f.profile.skills.some((s) => s.toLowerCase().includes(n));
    });
    return <div className="narrow-page"><PageHeader eyebrow="New project · Step 1 of 3" title="Create a project" subtitle="Describe the deliverable, set the budget and choose who will deliver it."/>
      <form className="form-panel" onSubmit={next} noValidate>
        <div className="field"><label>Project title</label><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="e.g. Commerce API implementation" className={attempted && title.trim().length < 3 ? "invalid" : ""}/>{attempted && title.trim().length < 3 && <small className="error-text">Enter a project title (at least 3 characters).</small>}</div>
        <div className="field"><div className="label-row"><label>Project brief</label><span>{brief.length} / 4,000</span></div><textarea value={brief} maxLength={4000} onChange={(e) => setBrief(e.target.value)} placeholder="Describe the software deliverable, technical requirements, expected behavior and any constraints..." className={attempted && brief.trim().length < 20 ? "invalid" : ""}/>{attempted && brief.trim().length < 20 ? <small className="error-text">Write at least 20 characters.</small> : <small>Mention the stack and key features (API, UI, auth, payments…) and the suggested plan will reflect them.</small>}</div>
        <div className="field budget-field"><label>Total budget</label><div className={`money-input ${attempted && budgetCents < 100 ? "invalid" : ""}`}><span>USD</span><input type="number" min="1" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0.00"/></div>{attempted && budgetCents < 100 ? <small className="error-text">Enter a budget of at least $1.</small> : <small>The full amount is authorized through PayPal Sandbox once you approve the plan.</small>}</div>
        <div className="field"><div className="label-row"><label>Freelancer</label>{freelancers && freelancers.length > 4 && <span>{freelancers.length} available</span>}</div>
          {freelancers === null ? <div className="loading-row"><Spinner dark/> Loading freelancers…</div>
            : loadError ? <Notice tone="error">{loadError}</Notice>
            : freelancers.length === 0 ? <Notice tone="warn">No freelancers have registered yet. Ask the freelancer you want to work with to create a MilestonePay account, then come back.</Notice>
            : <>{freelancers.length > 4 && <input className="picker-search" placeholder="Search by name or skill" value={search} onChange={(e) => setSearch(e.target.value)}/>}
              <div className="picker">{list.map(({ profile: f, stats }) => <button type="button" key={f.id} className={freelancerId === f.id ? "active" : ""} onClick={() => setFreelancerId(f.id)}><span className="avatar">{initials(f.fullName)}</span><span><b>{f.fullName}</b><small>{f.headline || "Freelancer"}{stats.verifiedMilestones ? ` · ${stats.verifiedMilestones} verified milestones` : ""}</small>{f.skills.length > 0 && <em>{f.skills.slice(0, 4).join(" · ")}</em>}</span>{freelancerId === f.id && <Icon name="check" size={16}/>}</button>)}{list.length === 0 && <p className="empty-note">No freelancers match “{search}”.</p>}</div></>}
          {attempted && !freelancerId && <small className="error-text">Choose a freelancer.</small>}
        </div>
        <div className="ai-note"><span className="ai-mark">PLAN</span><p><b>Suggested milestone plan</b><br/>MilestonePay drafts 2–5 priced milestones with checkable acceptance criteria from your brief. You can edit everything before funding.</p></div>
        <div className="form-actions"><Button kind="secondary" onClick={() => go("/overview")}>Cancel</Button><Button type="submit">Continue to milestone plan <Icon name="arrow" size={16}/></Button></div>
      </form>
    </div>;
  }

  const pct = plan.reduce((a, m) => a + (Number(m.percent) || 0), 0);
  let allocated = 0;
  return <><PageHeader eyebrow="New project · Step 2 of 3" title="Review milestone plan" subtitle="Edit milestones, amounts and acceptance criteria. Payments are released per milestone based on the criteria that pass." action={<StatusBadge tone="pending">Suggested plan</StatusBadge>}/>
    <div className="plan-summary"><div><span>Project</span><b>{title}</b></div><div><span>Total budget</span><b className="mono">{fmt(budgetCents)}</b></div><div><span>Freelancer</span><b>{chosen?.fullName ?? "—"}</b></div><div><span>Allocated</span><b className={Math.abs(pct - 100) < 0.001 ? "good" : "bad"}>{pct}%</b></div></div>
    <div className="plan-list">{plan.map((m, i) => {
      const amount = i === plan.length - 1 ? budgetCents - allocated : Math.floor((budgetCents * (Number(m.percent) || 0)) / 100);
      allocated += amount;
      const w = m.criteria.reduce((a, c) => a + (Number(c.weight) || 0), 0);
      return <section className="milestone-editor" key={i}>
        <div className="milestone-top">
          <span className="milestone-number">{pad(i + 1)}</span>
          <div className="milestone-copy"><input aria-label="Milestone title" value={m.title} onChange={(e) => updM(i, { title: e.target.value })} maxLength={140}/><textarea aria-label="Milestone description" value={m.description} onChange={(e) => updM(i, { description: e.target.value })} placeholder="What will be delivered in this milestone?"/><label className="due-field">Due date <input type="date" value={m.dueDate} onChange={(e) => updM(i, { dueDate: e.target.value })}/></label></div>
          <div className="milestone-money"><input aria-label="Budget percentage" type="number" min="1" max="100" value={m.percent} onChange={(e) => updM(i, { percent: Number(e.target.value) })}/><span>%</span><b className="mono">{fmt(Math.max(0, amount))}</b></div>
          <div className="milestone-tools"><button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button type="button" aria-label="Move down" disabled={i === plan.length - 1} onClick={() => move(i, 1)}>↓</button><button type="button" aria-label="Remove milestone" disabled={plan.length === 1} onClick={() => setPlan((p) => p.filter((_, j) => j !== i))}><Icon name="trash" size={14}/></button></div>
        </div>
        <div className="criteria-list"><div className="criteria-head"><span>Acceptance criteria</span><span className={w === 100 ? "good" : "bad"}>Weights {w}%</span></div>
          {m.criteria.map((c, k) => <div className="criterion-edit" key={k}>
            <select aria-label="Criterion type" value={c.type} onChange={(e) => { const t = e.target.value as CriterionType; updC(i, k, { type: t, config: t === "FILE_EXISTS" ? { path: c.config.path || "README.md" } : {} }); }}>{types.map((t) => <option key={t} value={t}>{criterionLabels[t].label}</option>)}</select>
            <div className="criterion-text"><input aria-label="Criterion description" value={c.description} onChange={(e) => updC(i, k, { description: e.target.value })} maxLength={400}/>{c.type === "FILE_EXISTS" ? <input aria-label="File path" className="path-input" value={c.config.path ?? ""} onChange={(e) => updC(i, k, { config: { path: e.target.value } })} placeholder="path/to/file.ext"/> : <small>{criterionLabels[c.type].hint}</small>}</div>
            <div className="weight-input"><input aria-label="Weight" type="number" min="1" max="100" value={c.weight} onChange={(e) => updC(i, k, { weight: Number(e.target.value) })}/><span>%</span></div>
            <button type="button" aria-label="Remove criterion" onClick={() => updM(i, { criteria: m.criteria.filter((_, l) => l !== k) })}><Icon name="close" size={14}/></button>
          </div>)}
          <div className="criteria-actions"><button type="button" className="text-link" onClick={() => updM(i, { criteria: rebalanceWeights([...m.criteria, newCriterion("CI_PASSES")]) })}><Icon name="plus" size={13}/> Add criterion</button>{m.criteria.length > 1 && <button type="button" className="text-link" onClick={() => updM(i, { criteria: rebalanceWeights(m.criteria) })}>Split weights evenly</button>}</div>
        </div>
      </section>;
    })}</div>
    {plan.length < 8 && <button type="button" className="add-milestone" onClick={() => setPlan((p) => [...p, { title: `Milestone ${pad(p.length + 1)}`, description: "", percent: 0, dueDate: "", criteria: [newCriterion("CI_PASSES", 50), newCriterion("MANUAL_REVIEW", 50)] }])}><Icon name="plus" size={15}/> Add milestone</button>}
    {problems.length > 0 && <Notice tone="warn"><b>Fix these before continuing</b><ul>{problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}</ul></Notice>}
    <div className="sticky-actions"><div><b>{problems.length ? "Plan needs attention" : "Plan is ready"}</b><small>Amounts are calculated from the {fmt(budgetCents)} budget. The last milestone absorbs rounding.</small></div><Button kind="secondary" onClick={() => setStep(1)}>Back</Button><Button kind="secondary" onClick={() => setPlan(suggestPlan(`${title} ${brief}`))}>Reset to suggestion</Button><Button onClick={create} disabled={problems.length > 0 || saving}>{saving ? "Creating…" : <>Create project <Icon name="arrow" size={16}/></>}</Button></div>
  </>;
}

export function NotAllowed() {
  const { go } = useApp();
  return <Empty title="This page isn’t available for your account" action={<Button onClick={() => go("/overview")}>Back to overview</Button>}>Clients and freelancers see different parts of MilestonePay.</Empty>;
}
