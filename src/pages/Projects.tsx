import { useMemo, useState } from "react";
import { useApp } from "../app-context";
import { money as fmt } from "../lib/format";
import { money, personName, progress, projectBadge } from "../lib/select";
import type { Project } from "../lib/types";
import { Button, Empty, Icon, PageHeader, StatusBadge } from "../ui";

export function ProjectsTable({ projects }: { projects: Project[] }) {
  const { ws, user, go } = useApp();
  const client = user.role === "client";
  return <div className="table-wrap"><table><thead><tr><th>Project</th><th>{client ? "Freelancer" : "Client"}</th><th>Milestone progress</th><th>{client ? "Budget" : "Contract value"}</th><th>Captured</th><th>Status</th><th/></tr></thead><tbody>
    {projects.map((p) => {
      const pr = progress(ws, p.id);
      const b = projectBadge(ws, p);
      return <tr key={p.id} className="clickable" onClick={() => go(`/project/${p.id}`)}>
        <td><button className="text-button strong" onClick={(e) => { e.stopPropagation(); go(`/project/${p.id}`); }}>{p.title}</button></td>
        <td>{personName(ws, client ? p.freelancerId : p.clientId)}</td>
        <td><div className="progress-cell"><div className="mini-progress"><span style={{ width: `${pr.percent}%` }}/></div><span>{pr.done}/{pr.total}</span></div></td>
        <td className="mono">{fmt(p.budgetCents)}</td>
        <td className="mono">{fmt(money(ws, p.id).captured)}</td>
        <td><StatusBadge tone={b.tone}>{b.label}</StatusBadge></td>
        <td><span className="icon-btn" aria-hidden="true"><Icon name="chevron" size={16}/></span></td>
      </tr>;
    })}
  </tbody></table></div>;
}

type Filter = "all" | "active" | "draft" | "completed";

export function Projects() {
  const { ws, user, go } = useApp();
  const client = user.role === "client";
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const counts = {
    all: ws.projects.length,
    active: ws.projects.filter((p) => p.status === "in_progress").length,
    draft: ws.projects.filter((p) => p.status === "draft").length,
    completed: ws.projects.filter((p) => p.status === "completed" || p.status === "cancelled").length,
  };
  const list = useMemo(() => ws.projects.filter((p) => {
    if (filter === "active" && p.status !== "in_progress") return false;
    if (filter === "draft" && p.status !== "draft") return false;
    if (filter === "completed" && p.status !== "completed" && p.status !== "cancelled") return false;
    const needle = q.trim().toLowerCase();
    return !needle || p.title.toLowerCase().includes(needle) || personName(ws, client ? p.freelancerId : p.clientId).toLowerCase().includes(needle);
  }), [ws, filter, q, client]);

  const tabs: [Filter, string][] = client
    ? [["all", "All projects"], ["active", "Active"], ["draft", "Awaiting funding"], ["completed", "Closed"]]
    : [["all", "All work"], ["active", "Active"], ["completed", "Closed"]];

  return <>
    <PageHeader title={client ? "Projects" : "My work"} subtitle={client ? "Manage work, milestones and delivery status." : "Projects assigned to you, with milestones and delivery status."} action={client ? <Button onClick={() => go("/projects/new")}><Icon name="plus" size={16}/> Create project</Button> : undefined}/>
    <div className="filter-row"><div className="segmented">{tabs.map(([k, label]) => <button key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>{label} <span>{counts[k]}</span></button>)}</div><input className="compact-input" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)}/></div>
    <section className="section-block table-only">
      {ws.projects.length === 0
        ? <Empty title={client ? "No projects yet" : "No assigned work yet"} action={client ? <Button onClick={() => go("/projects/new")}><Icon name="plus" size={16}/> Create your first project</Button> : <Button kind="secondary" onClick={() => go("/settings")}>Complete your profile</Button>}>{client ? "Create a project, choose a freelancer and fund the milestone plan." : "When a client creates a project with you as the freelancer, it appears here. A complete profile helps clients choose you."}</Empty>
        : list.length === 0 ? <Empty title="No matching projects">Try a different filter or search.</Empty>
        : <ProjectsTable projects={list}/>}
    </section>
  </>;
}
