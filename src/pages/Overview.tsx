import { useApp } from "../app-context";
import { money as fmt, pad, when } from "../lib/format";
import { currentMilestone, isOverdue, latestVerification, money } from "../lib/select";
import { Button, Empty, Icon, PageHeader } from "../ui";
import { ProjectsTable } from "./Projects";

type Item = { title: string; detail: string; path: string };

export function Overview() {
  const { ws, user, go, settings } = useApp();
  const client = user.role === "client";
  const first = user.fullName.split(" ")[0] || "there";
  const totals = money(ws);
  const active = ws.projects.filter((p) => p.status === "in_progress");
  const approved = ws.milestones.filter((m) => m.status === "approved").length;
  const contracted = ws.projects.filter((p) => p.status === "in_progress" || p.status === "completed").reduce((a, p) => a + p.budgetCents, 0);

  const items: Item[] = [];
  for (const p of ws.projects) {
    if (client && p.status === "draft") items.push({ title: "Fund project", detail: `${p.title} · ${fmt(p.budgetCents)}`, path: `/project/${p.id}/fund` });
    if (p.status !== "in_progress") continue;
    const m = currentMilestone(ws, p.id);
    if (!m) continue;
    const v = latestVerification(ws, m.id);
    if (client && m.status === "submitted" && v) items.push({ title: `Review milestone ${pad(m.position)}`, detail: `${p.title} · ${fmt(v.proposedCents)} proposed`, path: `/verification/${v.id}` });
    const late = isOverdue(m) ? " · overdue" : "";
    if (client && late) items.push({ title: `Milestone ${pad(m.position)} is overdue`, detail: `${p.title} · ${m.title}`, path: `/project/${p.id}` });
    if (!client && m.status === "in_progress") items.push({ title: `Submit milestone ${pad(m.position)}`, detail: `${p.title} · ${m.title}${late}`, path: `/milestone/${m.id}/submit` });
    if (!client && m.status === "revision_requested") items.push({ title: `Address revision on milestone ${pad(m.position)}`, detail: `${p.title}${late}`, path: `/milestone/${m.id}/submit` });
    if (!client && m.status === "submitted" && v) items.push({ title: `Awaiting client decision`, detail: `${p.title} · Milestone ${pad(m.position)}`, path: `/verification/${v.id}` });
  }
  if (client) {
    for (const p of ws.projects) {
      if (ws.payments.some((x) => x.projectId === p.id && x.kind === "capture") && !ws.reviews.some((r) => r.projectId === p.id) && p.status === "completed")
        items.push({ title: "Review your freelancer", detail: p.title, path: `/review/${p.id}` });
    }
  }

  const metrics: [string, string, string][] = client
    ? [["Total authorized", fmt(totals.authorized), `Across ${ws.projects.filter((p) => p.authorizedAt).length} funded projects`], ["Total captured", fmt(totals.captured), totals.authorized ? `${((100 * totals.captured) / totals.authorized).toFixed(1)}% of authorization` : "No captures yet"], ["Remaining authorization", fmt(totals.remaining), "Available for capture"]]
    : [["Captured earnings", fmt(totals.captured), `${fmt(Math.max(0, contracted - totals.captured - totals.released))} still in active contracts`], ["Active projects", pad(active.length), `${ws.projects.length} assigned in total`], ["Verified milestones", pad(approved), `${ws.submissions.length} submission${ws.submissions.length === 1 ? "" : "s"} so far`]];

  const pct = totals.authorized ? (100 * totals.captured) / totals.authorized : 0;
  const incomplete = !client && (!user.portfolioUrl || !user.resume || !user.headline || user.skills.length === 0);

  return <>
    <PageHeader title={`Welcome, ${first}`} subtitle={client ? "Your projects, payments and milestones at a glance." : "Your assigned work, submissions and earnings at a glance."} action={client ? <Button onClick={() => go("/projects/new")}><Icon name="plus" size={16}/> Create project</Button> : <Button kind="secondary" onClick={() => go("/profile")}>View my profile</Button>}/>
    {!client && settings.paypalEnabled && !user.paypalEmail && <div className="profile-nudge"><div><b>Add your PayPal email to get paid</b><p>Approved milestones are paid out to your PayPal account. Without an email, payouts wait until you add one.</p></div><Button onClick={() => go("/settings")}>Add PayPal email</Button></div>}
    {incomplete && <div className="profile-nudge"><div><b>Strengthen your freelancer profile</b><p>Clients choose freelancers from the directory. Add a headline, skills, and optionally a portfolio website and resume.</p></div><Button kind="secondary" onClick={() => go("/settings")}>Edit profile</Button></div>}
    <section className="metrics">{metrics.map(([label, value, note]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}</section>
    <div className="dashboard-grid">
      <div className="allocation">
        <div className="section-heading"><div><h2>{client ? "Payment allocation" : "Earnings pipeline"}</h2><p>{client ? "Authorized funds across your projects" : "Captured versus authorized for your projects"}</p></div><span className="mono">{pct.toFixed(1)}% captured</span></div>
        <div className="bar"><span className="captured" style={{ width: `${pct}%` }}/><span className="remaining"/></div>
        <div className="bar-legend"><span><i className="legend captured-dot"/>Captured <b>{fmt(totals.captured)}</b></span><span><i className="legend remaining-dot"/>Remaining <b>{fmt(totals.remaining)}</b></span>{totals.released > 0 && <span><i className="legend remaining-dot"/>Released <b>{fmt(totals.released)}</b></span>}</div>
      </div>
      <section className="attention"><div className="section-heading"><div><h2>{client ? "Requires attention" : "Next actions"}</h2><p>{items.length ? `${items.length} item${items.length === 1 ? "" : "s"} waiting` : "You’re all caught up"}</p></div></div>
        {items.slice(0, 5).map((it, i) => <button key={it.path + i} onClick={() => go(it.path)}><span className="attention-index">{pad(i + 1)}</span><span><b>{it.title}</b><small>{it.detail}</small></span><Icon name="arrow" size={16}/></button>)}
        {items.length === 0 && <p className="attention-empty">{client ? "Nothing needs a decision right now." : "Nothing to submit right now."}</p>}
      </section>
    </div>
    <section className="section-block"><div className="section-heading"><div><h2>{client ? "Projects" : "Assigned projects"}</h2><p>Most recent first</p></div>{ws.projects.length > 0 && <button className="text-link" onClick={() => go("/projects")}>View all <Icon name="arrow" size={14}/></button>}</div>
      {ws.projects.length ? <ProjectsTable projects={ws.projects.slice(0, 5)}/> : <Empty title={client ? "No projects yet" : "No assigned work yet"} action={client ? <Button onClick={() => go("/projects/new")}><Icon name="plus" size={16}/> Create your first project</Button> : undefined}>{client ? "Start by describing the work and choosing a freelancer." : "Projects a client assigns to you will show up here."}</Empty>}
    </section>
    {ws.activity.length > 0 && <section className="activity-row">{ws.activity.slice(0, 6).map((a) => <div key={a.id}><span className="activity-time">{when(a.createdAt)}</span><span className="activity-line"/><span className={`activity-mark ${a.kind === "captured" || a.kind === "completed" ? "complete" : "pending"}`}/><p><b>{ws.projects.find((p) => p.id === a.projectId)?.title ?? "Project"}</b> · {a.message}</p></div>)}</section>}
  </>;
}
