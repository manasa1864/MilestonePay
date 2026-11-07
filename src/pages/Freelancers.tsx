import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { backend } from "../lib/backend";
import { date, errorText, formatSize, initials, money as fmt, pad } from "../lib/format";
import type { FreelancerStats, Profile, ResumeRef, Review } from "../lib/types";
import { Button, Empty, Icon, Notice, PageHeader, Spinner, StatusBadge, Stars } from "../ui";

type Entry = { profile: Profile; stats: FreelancerStats };

function ResumeLink({ resume }: { resume: ResumeRef }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function open() {
    setBusy(true);
    setErr("");
    try {
      const url = await backend.resumeUrl(resume);
      const a = document.createElement("a");
      a.href = url;
      a.download = resume.name;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }
  return <><button type="button" className="link-chip" onClick={open} disabled={busy}>{busy ? <Spinner dark/> : <Icon name="download" size={13}/>} Resume · {resume.name} ({formatSize(resume.size)})</button>{err && <small className="error-text">{err}</small>}</>;
}

export function ProfileLinks({ p }: { p: Profile }) {
  if (!p.portfolioUrl && !p.resume && !p.githubUsername) return null;
  return <div className="link-row">
    {p.portfolioUrl && <a href={p.portfolioUrl} target="_blank" rel="noreferrer noopener"><Icon name="external" size={13}/> Portfolio website</a>}
    {p.githubUsername && <a href={`https://github.com/${p.githubUsername}`} target="_blank" rel="noreferrer noopener"><Icon name="github" size={13}/> @{p.githubUsername}</a>}
    {p.resume && <ResumeLink resume={p.resume}/>}
  </div>;
}

function useFreelancers() {
  const [list, setList] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { backend.listFreelancers().then(setList).catch((e) => { setError(errorText(e)); setList([]); }); }, []);
  return { list, error };
}

export function FreelancerDirectory() {
  const { go } = useApp();
  const { list, error } = useFreelancers();
  const [q, setQ] = useState("");
  const shown = (list ?? []).filter(({ profile: p }) => {
    const n = q.trim().toLowerCase();
    return !n || p.fullName.toLowerCase().includes(n) || p.headline.toLowerCase().includes(n) || p.skills.some((s) => s.toLowerCase().includes(n));
  });
  return <><PageHeader title="Find freelancers" subtitle="Browse registered freelancers, their verified track record, portfolio and resume."/>
    <div className="filter-row"><span className="muted-text small">{list ? `${list.length} registered freelancer${list.length === 1 ? "" : "s"}` : ""}</span><input className="compact-input" placeholder="Search name or skill" value={q} onChange={(e) => setQ(e.target.value)}/></div>
    {error && <Notice tone="error">{error}</Notice>}
    {list === null ? <div className="loading-row"><Spinner dark/> Loading freelancers…</div>
      : list.length === 0 ? <section className="section-block"><Empty title="No freelancers yet">Freelancers who create an account appear here automatically.</Empty></section>
      : shown.length === 0 ? <section className="section-block"><Empty title="No matches">No freelancers match “{q}”.</Empty></section>
      : <div className="dir-grid">{shown.map(({ profile: p, stats }) => <article className="dir-card" key={p.id}>
        <button className="dir-top" onClick={() => go(`/freelancers/${p.id}`)}><div className="avatar">{initials(p.fullName)}</div><div><b>{p.fullName}</b><small>{p.headline || "Freelancer"}</small></div><Icon name="chevron" size={15}/></button>
        <div className="dir-stats"><span><b>{stats.verifiedMilestones}</b> verified</span><span><b>{stats.passRate == null ? "—" : `${stats.passRate}%`}</b> pass rate</span><span>{stats.avgRating ? <><Stars rating={stats.avgRating}/> ({stats.reviewCount})</> : "No reviews"}</span></div>
        {p.bio && <p>{p.bio}</p>}
        {p.skills.length > 0 && <div className="skills">{p.skills.map((s) => <span key={s}>{s}</span>)}</div>}
        <ProfileLinks p={p}/>
        <div className="dir-actions"><Button kind="secondary" onClick={() => go(`/freelancers/${p.id}`)}>View profile</Button><Button onClick={() => go(`/projects/new?freelancer=${p.id}`)}>Start a project</Button></div>
      </article>)}</div>}
  </>;
}

export function FreelancerProfile({ freelancerId }: { freelancerId: string }) {
  const { ws, user, go } = useApp();
  const self = user.id === freelancerId;
  const { list, error } = useFreelancers();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  useEffect(() => { backend.freelancerReviews(freelancerId).then(setReviews).catch(() => setReviews([])); }, [freelancerId]);
  if (list === null) return <div className="loading-row"><Spinner dark/> Loading profile…</div>;
  const entry = list.find((e) => e.profile.id === freelancerId);
  if (!entry) return <>{error && <Notice tone="error">{error}</Notice>}<Empty title="Freelancer not found" action={<Button onClick={() => go(user.role === "client" ? "/freelancers" : "/overview")}>Back</Button>}/></>;
  const p = self ? user : entry.profile;
  const s = entry.stats;
  const shared = ws.projects.filter((x) => x.freelancerId === freelancerId);
  const approved = ws.milestones.filter((m) => m.status === "approved" && shared.some((x) => x.id === m.projectId)).sort((a, b) => (b.approvedAt ?? "").localeCompare(a.approvedAt ?? ""));

  return <>
    {!self && <div className="back-row"><button onClick={() => go("/freelancers")}><Icon name="back" size={16}/> All freelancers</button></div>}
    <section className="profile-hero"><div className="profile-avatar">{initials(p.fullName)}</div><div className="profile-main"><span>{s.verifiedMilestones > 0 ? "VERIFIED FREELANCER" : "FREELANCER"}</span><h1>{p.fullName}</h1><p className="profile-headline">{p.headline || (self ? "Add a headline so clients know what you do." : "Freelancer")}</p>{p.bio && <p>{p.bio}</p>}{p.skills.length > 0 && <div className="skills">{p.skills.map((x) => <span key={x}>{x}</span>)}</div>}<ProfileLinks p={p}/></div>
      {self ? <Button kind="secondary" onClick={() => go("/settings")}>Edit profile</Button> : user.role === "client" && <Button onClick={() => go(`/projects/new?freelancer=${p.id}`)}>Start a project</Button>}</section>
    <section className="profile-stats"><div><strong>{s.verifiedMilestones}</strong><span>Verified milestones</span></div><div><strong className="mono">{fmt(s.capturedCents)}</strong><span>Total captured payments</span></div><div><strong>{pad(s.completedProjects)}</strong><span>Completed projects</span></div><div><strong>{s.passRate == null ? "—" : `${s.passRate}%`}</strong><span>Criteria pass rate</span></div></section>
    {self && !p.portfolioUrl && !p.resume && <div className="spacer"/>}
    {self && !p.portfolioUrl && !p.resume && <Notice tone="info">You haven’t added a portfolio website or resume. Both are optional, but clients see them when choosing a freelancer. <button className="text-link inline" onClick={() => go("/settings")}>Add them</button></Notice>}
    {approved.length > 0 && <section className="section-block"><div className="section-heading"><div><h2>{self ? "Your verified milestones" : "Verified work with you"}</h2><p>Evidence-backed work completed through MilestonePay</p></div></div><div className="history-list">{approved.map((m, i) => { const pr = shared.find((x) => x.id === m.projectId)!; return <div key={m.id}><span className="history-index">{pad(i + 1)}</span><div><b>{pr.title}</b><p>{m.title}</p></div><StatusBadge tone="complete">Verified</StatusBadge><button className="text-link" onClick={() => go(`/project/${pr.id}`)}>Project</button><strong className="mono">{fmt(m.capturedCents)}</strong></div>; })}</div></section>}
    <section className="section-block"><div className="section-heading"><div><h2>Client reviews</h2><p>{s.reviewCount ? `${s.avgRating?.toFixed(1)} average from ${s.reviewCount} review${s.reviewCount === 1 ? "" : "s"}` : "Reviews are only possible after a payment is captured"}</p></div></div>
      {reviews === null ? <div className="loading-row"><Spinner dark/></div> : reviews.length === 0 ? <p className="empty-note">No reviews yet.</p> : <div className="review-list">{reviews.map((r) => <article key={r.id}><div><Stars rating={r.rating}/><small>{date(r.createdAt)}</small></div><p>{r.body}</p></article>)}</div>}
    </section>
  </>;
}
