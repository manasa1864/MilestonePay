import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";

type Page =
  | "settings"
  | "myprofile"
  | "overview"
  | "projects"
  | "create"
  | "plan"
  | "fund"
  | "project"
  | "submit"
  | "verification"
  | "revision"
  | "payments"
  | "freelancers"
  | "review";
type Role = "client" | "freelancer";
type Theme = "light" | "dark" | "system";
type Status = "active" | "pending" | "complete" | "revision" | "failed";

type Resume = { name: string; size: number; dataUrl: string };
type User = {
  id: string; name: string; email: string; role: Role; passHash: string;
  company: string; headline: string; bio: string; skills: string[]; portfolio: string; resume: Resume | null;
};
type Draft = { company: string; headline: string; bio: string; skills: string; portfolio: string; resume: Resume | null };

const ACCOUNTS_KEY = "mp-accounts";
const SESSION_KEY = "mp-session";
const MAX_RESUME_BYTES = 1_500_000;

function loadAccounts(): User[] {
  try { const raw = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]"); return Array.isArray(raw) ? raw : []; } catch { return []; }
}
function saveAccounts(list: User[]): boolean {
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list)); return true; } catch { return false; }
}
async function hashPassword(password: string, email: string): Promise<string> {
  const text = `milestonepay:${email.toLowerCase()}:${password}`;
  if (window.crypto?.subtle) {
    const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return btoa(unescape(encodeURIComponent(text)));
}
function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
function normalizeUrl(value: string): string | null {
  const v = value.trim();
  if (!v) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch { return null; }
}
function parseSkills(text: string) {
  return Array.from(new Set(text.split(",").map((s) => s.trim()).filter(Boolean))).slice(0, 12);
}
function emptyDraft(user?: User): Draft {
  return { company: user?.company ?? "", headline: user?.headline ?? "", bio: user?.bio ?? "", skills: user?.skills.join(", ") ?? "", portfolio: user?.portfolio ?? "", resume: user?.resume ?? null };
}
function draftToProfile(d: Draft) {
  return { company: d.company.trim(), headline: d.headline.trim(), bio: d.bio.trim(), skills: parseSkills(d.skills), portfolio: normalizeUrl(d.portfolio) ?? "", resume: d.resume };
}
function formatSize(bytes: number) { return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(file); });
}

const paths: Record<string, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  projects: <><path d="M3 7h18v13H3z"/><path d="M8 7V4h8v3M3 12h18"/></>,
  payments: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.2.36.31.76.31 1.17H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></>,
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>,
  monitor: <><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  alert: <><path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
  github: <><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7.5A5.8 5.8 0 0 0 19.3 3 5.4 5.4 0 0 0 19.1 0S17.9-.4 15 1.5a13.4 13.4 0 0 0-7 0C5.1-.4 3.9 0 3.9 0a5.4 5.4 0 0 0-.2 3A5.8 5.8 0 0 0 2.2 7c0 5.9 3.5 7.1 6.8 7.5A4.8 4.8 0 0 0 8 18v4"/><path d="M8 19c-3 .9-3-1.5-4-2"/></>,
  external: <><path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
  back: <path d="m15 18-6-6 6-6"/>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const projects = [
  { name: "Atlas Commerce API", freelancer: "Maya Chen", client: "Olivia Park", progress: 66, amount: "$3,200", status: "active" as Status, label: "In progress" },
  { name: "Northstar Analytics", freelancer: "Jon Bell", client: "Olivia Park", progress: 100, amount: "$1,600", status: "complete" as Status, label: "Completed" },
  { name: "Relay Design System", freelancer: "Maya Chen", client: "Olivia Park", progress: 25, amount: "$2,400", status: "revision" as Status, label: "Needs revision" },
];

const criteria = [
  { name: "Continuous integration passes", type: "CI_PASSES", pass: true, weight: 25, evidence: "GitHub Actions workflow completed successfully across all 34 checks.", source: "Deterministic GitHub check" },
  { name: "OpenAPI specification included", type: "FILE_EXISTS", pass: true, weight: 15, evidence: "Located openapi.yaml at /docs/openapi.yaml in commit 7a29cf1.", source: "Deterministic GitHub check" },
  { name: "Authentication merged to main", type: "PR_MERGED", pass: true, weight: 20, evidence: "Pull request #48 merged to main by repository maintainer.", source: "Deterministic GitHub check" },
  { name: "Error handling is production ready", type: "LLM_REVIEW", pass: true, weight: 20, evidence: "Error boundaries and typed service errors are consistent across reviewed API routes.", source: "AI qualitative review" },
  { name: "Pagination covers all list endpoints", type: "LLM_REVIEW", pass: false, weight: 20, evidence: "The /orders endpoint does not expose cursor pagination or a documented limit.", source: "AI qualitative review" },
];

function StatusBadge({ status, children }: { status: Status; children: ReactNode }) {
  return <span className={`status status-${status}`}><span className="status-dot"/>{children}</span>;
}

function Button({ children, kind = "primary", onClick, type = "button", disabled = false }: { children: ReactNode; kind?: "primary" | "secondary" | "ghost" | "danger"; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean }) {
  return <button type={type} className={`btn btn-${kind}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

function PageHeader({ title, subtitle, action, eyebrow }: { title: string; subtitle: string; action?: ReactNode; eyebrow?: string }) {
  return <header className="page-header"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{subtitle}</p></div>{action && <div className="page-action">{action}</div>}</header>;
}

function Metrics({ freelancer = false }: { freelancer?: boolean }) {
  const data = freelancer
    ? [["Captured earnings", "$6,850", "+$1,280 this month"], ["Assigned projects", "03", "2 active milestones"], ["Verified milestones", "18", "94% pass rate"]]
    : [["Total authorized", "$4,800", "Across 2 active projects"], ["Total captured", "$2,150", "44.8% of authorization"], ["Remaining authorization", "$2,650", "Available for capture"]];
  return <section className="metrics">{data.map(([label, value, note]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}</section>;
}

function Allocation() {
  return <div className="allocation">
    <div className="section-heading"><div><h2>Payment allocation</h2><p>Authorized funds across active projects</p></div><span className="mono">44.8% captured</span></div>
    <div className="bar"><span className="captured" style={{ width: "44.8%" }}/><span className="remaining"/></div>
    <div className="bar-legend"><span><i className="legend captured-dot"/>Captured <b>$2,150</b></span><span><i className="legend remaining-dot"/>Remaining <b>$2,650</b></span></div>
  </div>;
}

function ProjectsTable({ onOpen, role }: { onOpen: () => void; role: Role }) {
  return <div className="table-wrap"><table><thead><tr><th>Project</th><th>{role === "client" ? "Freelancer" : "Client"}</th><th>Milestone progress</th><th>{role === "client" ? "Project amount" : "You earn"}</th><th>Status</th><th/></tr></thead><tbody>
    {projects.map((p) => <tr key={p.name}><td><button className="text-button strong" onClick={onOpen}>{p.name}</button></td><td>{role === "client" ? p.freelancer : p.client}</td><td><div className="progress-cell"><div className="mini-progress"><span style={{ width: `${p.progress}%` }}/></div><span>{p.progress}%</span></div></td><td className="mono">{p.amount}</td><td><StatusBadge status={p.status}>{p.label}</StatusBadge></td><td><button className="icon-btn" aria-label={`Open ${p.name}`} onClick={onOpen}><Icon name="chevron" size={16}/></button></td></tr>)}
  </tbody></table></div>;
}

function Overview({ role, go, user }: { role: Role; go: (page: Page) => void; user: User }) {
  const first = user.name.split(" ")[0];
  const incomplete = role === "freelancer" && (!user.portfolio || !user.resume);
  return <>
    <PageHeader title={`Welcome, ${first}`} subtitle={role === "client" ? "Your projects, payments and milestones at a glance." : "Your assigned work, submissions and earnings at a glance."} action={role === "client" ? <Button onClick={() => go("create")}><Icon name="plus" size={16}/> Create project</Button> : <Button kind="secondary" onClick={() => go("myprofile")}>View my profile</Button>}/>
    {incomplete && <div className="profile-nudge"><div><b>Strengthen your freelancer profile</b><p>Clients can see your {!user.portfolio && !user.resume ? "portfolio website and resume" : !user.portfolio ? "portfolio website" : "resume"} when they browse freelancers. Both are optional.</p></div><Button kind="secondary" onClick={() => go("settings")}>Add now</Button></div>}
    <Metrics freelancer={role === "freelancer"}/>
    <div className="dashboard-grid">
      <Allocation/>
      <section className="attention"><div className="section-heading"><div><h2>{role === "client" ? "Requires attention" : "Next actions"}</h2><p>2 items waiting</p></div></div>
        <button onClick={() => go(role === "client" ? "verification" : "submit")}><span className="attention-index">01</span><span><b>{role === "client" ? "Review proposed release" : "Submit milestone 03"}</b><small>{role === "client" ? "Atlas Commerce API · $640" : "Atlas Commerce API · Due Friday"}</small></span><Icon name="arrow" size={16}/></button>
        <button onClick={() => go("revision")}><span className="attention-index">02</span><span><b>{role === "client" ? "Revision resubmitted" : "Address verification result"}</b><small>Relay Design System · Milestone 02</small></span><Icon name="arrow" size={16}/></button>
      </section>
    </div>
    <section className="section-block"><div className="section-heading"><div><h2>{role === "client" ? "Projects" : "Assigned projects"}</h2><p>Active and recently completed work</p></div><button className="text-link" onClick={() => go("projects")}>View all projects <Icon name="arrow" size={14}/></button></div><ProjectsTable role={role} onOpen={() => go("project")}/></section>
    <section className="activity-row"><div><span className="activity-time">Today, 10:42</span><span className="activity-line"/><span className="activity-mark complete"/><p><b>Verification completed</b> for Atlas Commerce API, milestone 02. Four of five criteria passed.</p></div><div><span className="activity-time">Yesterday</span><span className="activity-line"/><span className="activity-mark pending"/><p><b>Payment captured</b> for Northstar Analytics, milestone 04. PayPal reference 8P00491.</p></div></section>
  </>;
}

function Projects({ go, role }: { go: (page: Page) => void; role: Role }) {
  return <><PageHeader title={role === "client" ? "Projects" : "My work"} subtitle={role === "client" ? "Manage work, milestones and delivery status." : "Projects assigned to you, with milestones and delivery status."} action={role === "client" ? <Button onClick={() => go("create")}><Icon name="plus" size={16}/> Create project</Button> : undefined}/><div className="filter-row"><div className="segmented"><button className="active">All projects <span>3</span></button><button>Active <span>2</span></button><button>Completed <span>1</span></button></div><input className="compact-input" placeholder="Search projects"/></div><section className="section-block table-only"><ProjectsTable role={role} onOpen={() => go("project")}/></section></>;
}

function CreateProject({ go }: { go: (page: Page) => void }) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [budget, setBudget] = useState("");
  const [attempted, setAttempted] = useState(false);
  function submit(e: FormEvent) { e.preventDefault(); setAttempted(true); if (title && brief.length > 20 && Number(budget) > 0) go("plan"); }
  return <div className="narrow-page"><PageHeader eyebrow="New project · Step 1 of 3" title="Create a project" subtitle="Describe the deliverable and define the total authorization."/>
    <form className="form-panel" onSubmit={submit}><div className="field"><label>Project title</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Commerce API implementation" className={attempted && !title ? "invalid" : ""}/>{attempted && !title && <small className="error-text">Enter a project title.</small>}</div>
      <div className="field"><div className="label-row"><label>Project brief</label><span>{brief.length} / 2,000</span></div><textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Describe the software deliverable, technical requirements, expected behavior and any constraints..." className={attempted && brief.length <= 20 ? "invalid" : ""}/><small>Be specific about repository structure, required functionality and quality expectations.</small></div>
      <div className="field budget-field"><label>Total budget</label><div className="money-input"><span>USD</span><input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0.00"/></div><small>The full amount will be authorized through PayPal Sandbox after you approve the plan.</small></div>
      <div className="ai-note"><span className="ai-mark">AI</span><p><b>Milestone plan generation</b><br/>AI will convert your brief into 2–5 priced milestones with machine-checkable acceptance criteria. You can review and edit everything before funding.</p></div>
      <div className="form-actions"><Button kind="secondary" onClick={() => go("overview")}>Cancel</Button><Button type="submit">Generate milestone plan <Icon name="arrow" size={16}/></Button></div>
    </form>
  </div>;
}

const initialMilestones = [
  { id: 1, title: "API foundation & data model", desc: "Establish the typed service architecture, database schema and core REST resources.", percent: 30, criteria: ["CI_PASSES", "FILE_EXISTS"] },
  { id: 2, title: "Authentication & commerce flows", desc: "Implement secure authentication, catalog, cart and order lifecycle endpoints.", percent: 40, criteria: ["CI_PASSES", "PR_MERGED", "LLM_REVIEW"] },
  { id: 3, title: "Documentation & production readiness", desc: "Complete API documentation, tests, error handling and deployment configuration.", percent: 30, criteria: ["FILE_EXISTS", "LLM_REVIEW"] },
];

function Plan({ go }: { go: (page: Page) => void }) {
  const [items, setItems] = useState(initialMilestones);
  const [editing, setEditing] = useState<number | null>(null);
  const total = items.reduce((a, b) => a + b.percent, 0);
  return <><PageHeader eyebrow="New project · Step 2 of 3" title="Review milestone plan" subtitle="AI prepared a proposal from your brief. Review and modify it before authorizing funds." action={<StatusBadge status="pending">AI proposal</StatusBadge>}/>
    <div className="plan-summary"><div><span>Project</span><b>Atlas Commerce API</b></div><div><span>Total budget</span><b className="mono">$3,200.00</b></div><div><span>Milestones</span><b>{items.length}</b></div><div><span>Allocated</span><b className={total === 100 ? "good" : "bad"}>{total}%</b></div></div>
    <div className="plan-list">{items.map((m) => <section className="milestone-editor" key={m.id}><div className="milestone-top"><span className="milestone-number">0{m.id}</span><div className="milestone-copy">{editing === m.id ? <><input value={m.title} onChange={(e) => setItems(items.map(x => x.id === m.id ? {...x, title: e.target.value} : x))}/><textarea value={m.desc} onChange={(e) => setItems(items.map(x => x.id === m.id ? {...x, desc: e.target.value} : x))}/></> : <><h3>{m.title}</h3><p>{m.desc}</p></>}</div><div className="milestone-money"><input aria-label="Budget percentage" type="number" value={m.percent} onChange={(e) => setItems(items.map(x => x.id === m.id ? {...x, percent: Number(e.target.value)} : x))}/><span>%</span><b className="mono">${(3200 * m.percent / 100).toLocaleString(undefined, {minimumFractionDigits: 2})}</b></div><Button kind="ghost" onClick={() => setEditing(editing === m.id ? null : m.id)}>{editing === m.id ? "Done" : "Edit"}</Button></div>
      <div className="criteria-list"><span>Acceptance criteria</span>{m.criteria.map((c, i) => <div key={`${c}${i}`}><span className="type-chip">{c}</span><p>{c === "CI_PASSES" ? "All required GitHub Actions checks pass on the submitted commit." : c === "FILE_EXISTS" ? "Required specification and configuration files exist in the repository." : c === "PR_MERGED" ? "Feature pull requests are merged into the default branch." : "Implementation quality meets the stated qualitative requirements."}</p><button aria-label="More criterion options"><Icon name="more" size={16}/></button></div>)}</div>
    </section>)}</div>
    <div className="sticky-actions"><div><b>{total === 100 ? "Budget fully allocated" : `Allocation must equal 100% (currently ${total}%)`}</b><small>Milestone amounts are calculated from the $3,200.00 project budget.</small></div><Button kind="secondary">Regenerate plan</Button><Button onClick={() => go("fund")} disabled={total !== 100}>Continue to funding <Icon name="arrow" size={16}/></Button></div>
  </>;
}

function Fund({ go }: { go: (page: Page) => void }) {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(false);
  function authorize() { setLoading(true); window.setTimeout(() => { setLoading(false); setAuthorized(true); }, 900); }
  return <div className="fund-layout"><div><PageHeader eyebrow="New project · Step 3 of 3" title="Authorize project funding" subtitle="Review the project allocation before continuing to PayPal Sandbox."/>
    <section className="fund-card"><div className="project-identity"><div className="project-monogram">AC</div><div><span>PROJECT</span><h2>Atlas Commerce API</h2><p>With Maya Chen · @mayachen</p></div></div><div className="allocation-list">{initialMilestones.map((m) => <div key={m.id}><span>0{m.id}</span><p>{m.title}</p><small>{m.percent}%</small><b className="mono">${(3200*m.percent/100).toLocaleString()}.00</b></div>)}</div></section>
    <div className="legal-note"><Icon name="alert" size={18}/><p><b>Authorization, not escrow</b><br/>The full project amount is authorized through PayPal Sandbox. Funds are captured in parts only after you explicitly approve a milestone release. MilestonePay does not hold funds in escrow.</p></div>
  </div><aside className="checkout"><span className="sandbox-label">PAYPAL SANDBOX</span><h2>Authorization summary</h2><div className="checkout-row"><span>Project amount</span><b className="mono">$3,200.00</b></div><div className="checkout-row"><span>Fees</span><b className="mono">$0.00</b></div><div className="checkout-total"><span>Total to authorize</span><strong className="mono">$3,200.00</strong></div>
    {!authorized ? <><button className="paypal-btn" onClick={authorize} disabled={loading}>{loading ? <span className="spinner"/> : "Continue with PayPal"}</button><small className="centered">Demonstration only. No real funds will move.</small></> : <div className="authorization-success"><span><Icon name="check" size={20}/></span><h3>Authorization confirmed</h3><p>Sandbox authorization <b>7JH93284T</b> is ready. No funds have been captured.</p><Button onClick={() => go("project")}>Open project <Icon name="arrow" size={16}/></Button></div>}
  </aside></div>;
}

function ProjectDetail({ go, role }: { go: (page: Page) => void; role: Role }) {
  const [open, setOpen] = useState(2);
  const milestones = [
    { n: 1, title: "API foundation & data model", status: "complete" as Status, label: "Approved", amount: "$960.00", meta: "Captured Feb 12, 2025", desc: "Typed service architecture, schema and core REST resources." },
    { n: 2, title: "Authentication & commerce flows", status: "active" as Status, label: "Awaiting approval", amount: "$1,280.00", meta: "Submitted 2 hours ago", desc: "Secure authentication, catalog, cart and order lifecycle endpoints." },
    { n: 3, title: "Documentation & production readiness", status: "pending" as Status, label: "Not started", amount: "$960.00", meta: "Available after milestone 02", desc: "API documentation, tests and deployment configuration." },
  ];
  return <><div className="back-row"><button onClick={() => go("projects")}><Icon name="back" size={16}/> {role === "client" ? "All projects" : "My work"}</button></div><PageHeader title="Atlas Commerce API" subtitle="Software delivery with milestone-based verification and payment." action={<div className="header-status"><StatusBadge status="active">In progress</StatusBadge><Button onClick={() => go("verification")}>Review verification</Button></div>}/>
    <div className="project-meta"><div><span>{role === "client" ? "FREELANCER" : "CLIENT"}</span><b>{role === "client" ? "Maya Chen" : "Olivia Park"}</b></div><div><span>AUTHORIZED</span><b className="mono">$3,200.00</b></div><div><span>STARTED</span><b>Feb 03, 2025</b></div><div><span>PROJECT ID</span><b className="mono">MP-1048</b></div></div>
    <div className="detail-layout"><main className="timeline-panel"><div className="section-heading"><div><h2>Milestone timeline</h2><p>2 of 3 milestones submitted</p></div></div><div className="timeline">{milestones.map((m) => <article className={`timeline-item ${m.status}`} key={m.n}><div className="timeline-node"><Icon name={m.status === "complete" ? "check" : m.status === "active" ? "more" : "more"} size={14}/></div><button className="timeline-head" onClick={() => setOpen(open === m.n ? 0 : m.n)}><span>0{m.n}</span><div><h3>{m.title}</h3><p>{m.desc}</p></div><div className="timeline-amount"><b className="mono">{m.amount}</b><StatusBadge status={m.status}>{m.label}</StatusBadge></div><Icon name="chevron" size={17}/></button>{open === m.n && <div className="timeline-detail"><div><span>Latest activity</span><b>{m.meta}</b></div>{m.n === 2 && <><div><span>Submission</span><a href="https://github.com" target="_blank" rel="noreferrer">github.com/mayachen/atlas-api <Icon name="external" size={13}/></a></div><div><span>Verification</span><b>4 of 5 criteria passed · 80% weighted score</b></div><div className="inline-actions"><Button onClick={() => go("verification")}>Open evidence report</Button>{role === "client" ? <Button kind="secondary" onClick={() => go("revision")}>Request revision</Button> : <Button kind="secondary" onClick={() => go("submit")}>Submit update</Button>}</div></>}</div>}</article>)}</div></main>
      <aside className="money-panel"><div className="money-label">MONEY OVERVIEW</div><h2>Project funding</h2><div className="money-total"><span>Captured</span><strong className="mono">$960.00</strong></div><div className="dark-progress"><span style={{width:"30%"}}/></div><div className="money-stats"><div><span>Total authorized</span><b className="mono">$3,200.00</b></div><div><span>Remaining</span><b className="mono">$2,240.00</b></div><div><span>Captured</span><b>30%</b></div></div><div className="money-divider"/><h3>Payment activity</h3><div className="payment-line"><span>01</span><div><b>Milestone 01</b><small>Feb 12, 2025 · Captured</small></div><strong className="mono">$960.00</strong></div><div className="payment-line muted"><span>02</span><div><b>Proposed release</b><small>Pending client approval</small></div><strong className="mono">$1,024.00</strong></div><div className="sandbox-foot">PAYPAL SANDBOX · AUTHORIZED</div></aside>
    </div>
  </>;
}

function Submit({ go }: { go: (page: Page) => void }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle"|"loading"|"success"|"error">("idle");
  function submit(e: FormEvent) { e.preventDefault(); if (!/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(url)) { setState("error"); return; } setState("loading"); window.setTimeout(() => setState("success"), 1000); }
  return <div className="narrow-page"><PageHeader eyebrow="Atlas Commerce API · Milestone 02" title="Submit milestone" subtitle="Provide the GitHub repository containing your completed deliverable."/>
    <section className="submission-context"><div><span>CURRENT MILESTONE</span><h2>Authentication & commerce flows</h2><p>Implement secure authentication, catalog, cart and order lifecycle endpoints.</p></div><StatusBadge status="active">In progress</StatusBadge></section>
    <section className="criteria-compact"><h3>Acceptance criteria</h3>{criteria.map(c => <div key={c.name}><span className="type-chip">{c.type}</span><p>{c.name}</p><b>{c.weight}%</b></div>)}</section>
    {state === "success" ? <div className="success-state"><span><Icon name="check" size={24}/></span><h2>Submission received</h2><p>Repository access was confirmed. Verification is queued against commit <b>7a29cf1</b>.</p><div><Button onClick={() => go("verification")}>View verification report</Button><Button kind="secondary" onClick={() => setState("idle")}>Submit another URL</Button></div></div> :
    <form className="submit-form" onSubmit={submit}><div className="field"><label>GitHub repository URL</label><div className={`url-input ${state === "error" ? "invalid" : ""}`}><Icon name="github" size={19}/><input value={url} onChange={(e) => { setUrl(e.target.value); setState("idle"); }} placeholder="https://github.com/username/repository"/></div>{state === "error" ? <small className="error-text">Enter a valid public GitHub repository URL.</small> : <small>MilestonePay will inspect the default branch and linked GitHub evidence. GitHub-hosted software deliverables only.</small>}</div><div className="form-actions"><Button kind="secondary" onClick={() => go("project")}>Cancel</Button><Button type="submit" disabled={state === "loading"}>{state === "loading" ? <><span className="spinner dark"/> Inspecting repository</> : <>Submit for verification <Icon name="arrow" size={16}/></>}</Button></div></form>}
  </div>;
}

function Verification({ go, openCapture, role }: { go: (page: Page) => void; openCapture: () => void; role: Role }) {
  const [expanded, setExpanded] = useState<number | null>(4);
  const actions = role === "client"
    ? <><Button kind="secondary" onClick={() => go("revision")}>Request revision</Button><Button onClick={openCapture}>Approve $1,024 release</Button></>
    : <><Button kind="secondary" onClick={() => go("project")}>Back to project</Button><Button onClick={() => go("revision")}>Address feedback</Button></>;
  return <><div className="report-top"><div><div className="eyebrow">EVIDENCE REPORT · VR-2819</div><h1>Milestone verification</h1><p>Atlas Commerce API · Milestone 02</p></div><div className="report-actions">{actions}</div></div>
    <section className="audit-identity"><div><span>REPOSITORY</span><a href="https://github.com" target="_blank" rel="noreferrer"><Icon name="github" size={16}/> github.com/mayachen/atlas-api <Icon name="external" size={13}/></a></div><div><span>COMMIT</span><b className="mono">7a29cf1</b></div><div><span>CHECKED</span><b>Today, 10:42</b></div><div><span>STATUS</span><StatusBadge status="revision">Partial pass</StatusBadge></div></section>
    <section className="score-grid"><div className="score-primary"><span>WEIGHTED VERIFICATION SCORE</span><strong>80<span>%</span></strong><div className="verification-bar"><i style={{width:"80%"}}/><em style={{width:"20%"}}/></div><p>4 of 5 acceptance criteria passed</p></div><div><span>PASSED</span><strong>04</strong><small>80% total weight</small></div><div><span>FAILED</span><strong>01</strong><small>20% total weight</small></div><div className="release-box"><span>PROPOSED RELEASE</span><strong className="mono">$1,024.00</strong><small>80% of $1,280.00</small></div></section>
    <div className="method-note"><b>How this was calculated</b><p>Application logic multiplies the $1,280.00 milestone amount by the weights of passed criteria. AI provides qualitative evidence only; it does not calculate, approve or move money.</p></div>
    <section className="evidence-table"><div className="evidence-head"><span>Criterion</span><span>Type</span><span>Result</span><span>Weight</span><span/></div>{criteria.map((c, i) => <article key={c.name} className={c.pass ? "passed" : "failed"}><button className="evidence-row" onClick={() => setExpanded(expanded === i ? null : i)}><div><span className={`result-mark ${c.pass ? "pass" : "fail"}`}><Icon name={c.pass ? "check" : "close"} size={14}/></span><div><b>{c.name}</b><small>{c.source}</small></div></div><span><span className="type-chip">{c.type}</span></span><span><StatusBadge status={c.pass ? "complete" : "failed"}>{c.pass ? "Passed" : "Failed"}</StatusBadge></span><b>{c.weight}%</b><Icon name="chevron" size={16}/></button>{expanded === i && <div className="evidence-detail"><div><span>EVIDENCE SUMMARY</span><p>{c.evidence}</p></div><a href="https://github.com" target="_blank" rel="noreferrer">Inspect GitHub evidence <Icon name="external" size={13}/></a>{c.type === "LLM_REVIEW" && <aside><b>AI-generated explanation</b><p>This narrative supports human review. The linked repository evidence remains the source of record.</p></aside>}</div>}</article>)}</section>
    <div className="report-footer"><p>Verification checks completed against the submitted commit. Payment capture requires explicit client approval.</p><div>{actions}</div></div>
  </>;
}

function Revision({ go, role }: { go: (page: Page) => void; role: Role }) {
  const client = role === "client";
  return <><PageHeader eyebrow="Atlas Commerce API · Milestone 02" title={client ? "Request a revision" : "Revision requested"} subtitle={client ? "One acceptance criterion did not pass. The freelancer will be asked to resubmit." : "One acceptance criterion requires an updated delivery."} action={<StatusBadge status="revision">Needs revision</StatusBadge>}/>
    <div className="revision-layout"><main><section className="revision-issue"><div className="issue-top"><span className="result-mark fail"><Icon name="close" size={14}/></span><div><span className="type-chip">LLM_REVIEW</span><h2>Pagination covers all list endpoints</h2></div><b>20% weight</b></div><div className="issue-body"><span>WHAT IS MISSING</span><p>The <code>/orders</code> endpoint does not expose cursor pagination or a documented limit. This may lead to unbounded response sizes.</p><span>SUGGESTED CORRECTION</span><p>Add cursor-based pagination to the orders route, include limit validation, and update the OpenAPI specification.</p><a href="https://github.com" target="_blank" rel="noreferrer">View evidence in GitHub <Icon name="external" size={13}/></a></div></section>
      {client
        ? <section className="resubmit"><h2>Waiting for the freelancer</h2><p>Once you request a revision, the freelancer submits an updated repository and MilestonePay reruns all five checks. Nothing is captured until you approve a release.</p><Button onClick={() => go("project")}>Send revision request <Icon name="arrow" size={16}/></Button></section>
        : <section className="resubmit"><h2>Submit an updated repository</h2><p>Provide the updated GitHub URL when the correction is ready. MilestonePay will rerun all five checks.</p><div className="url-input"><Icon name="github" size={19}/><input defaultValue="https://github.com/mayachen/atlas-api"/></div><Button onClick={() => go("verification")}>Rerun verification <Icon name="arrow" size={16}/></Button></section>}
    </main><aside className="revision-summary"><span>PAYMENT POSITION</span><h2>Milestone 02</h2><div><span>Milestone amount</span><b className="mono">$1,280.00</b></div><div><span>Proposed partial release</span><b className="mono">$1,024.00</b></div><div><span>Already captured</span><b className="mono">$0.00</b></div><div><span>Project authorization remaining</span><b className="mono">$2,240.00</b></div><hr/><p>Approving as-is captures only the passed weighted portion. Requesting revision captures nothing.</p>{client && <Button kind="secondary" onClick={() => go("verification")}>Review partial approval</Button>}</aside></div>
  </>;
}

function Payments({ role }: { role: Role }) {
  return <><PageHeader title={role === "client" ? "Payments" : "Earnings"} subtitle={role === "client" ? "Authorization and capture activity across your projects." : "Payments captured for your approved milestones."} action={<span className="sandbox-pill">PAYPAL SANDBOX</span>}/><Metrics freelancer={role === "freelancer"}/><section className="chart-panel"><div className="section-heading"><div><h2>Captured payment activity</h2><p>Cumulative captures · Last 90 days</p></div><strong className="mono">$2,150.00</strong></div><div className="line-chart"><div className="grid-lines"><i/><i/><i/><i/></div><svg viewBox="0 0 900 180" preserveAspectRatio="none"><path d="M0 155 C90 155 80 135 170 135 S260 120 320 120 S390 95 470 95 S550 65 630 65 S720 32 900 32" fill="none" stroke="currentColor" strokeWidth="2.2"/><path d="M0 155 C90 155 80 135 170 135 S260 120 320 120 S390 95 470 95 S550 65 630 65 S720 32 900 32 L900 180 L0 180Z" fill="url(#fade)"/><defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".12"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs></svg><div className="chart-labels"><span>Dec 01</span><span>Dec 22</span><span>Jan 12</span><span>Feb 02</span><span>Feb 23</span></div></div></section>
    <section className="section-block"><div className="section-heading"><div><h2>Payment history</h2><p>All authorization and capture events</p></div></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Project</th><th>Milestone</th><th>Amount</th><th>Status</th><th>PayPal reference</th></tr></thead><tbody>{[["Feb 12, 2025","Atlas Commerce API","Milestone 01","$960.00","Captured","8P00491"],["Jan 28, 2025","Northstar Analytics","Milestone 04","$480.00","Captured","4KA23102"],["Jan 14, 2025","Northstar Analytics","Milestone 03","$320.00","Captured","9LM77341"],["Dec 19, 2024","Northstar Analytics","Milestone 02","$240.00","Captured","2GT61920"]].map(r=><tr key={r[5]}><td>{r[0]}</td><td className="strong">{r[1]}</td><td>{r[2]}</td><td className="mono">{r[3]}</td><td><StatusBadge status="complete">{r[4]}</StatusBadge></td><td className="mono muted-text">{r[5]}</td></tr>)}</tbody></table></div></section>
  </>;
}

function ProfileLinks({ portfolio, resume }: { portfolio: string; resume: Resume | null }) {
  if (!portfolio && !resume) return null;
  return <div className="link-row">
    {portfolio && <a href={portfolio} target="_blank" rel="noreferrer noopener"><Icon name="external" size={13}/> Portfolio website</a>}
    {resume && <a href={resume.dataUrl} download={resume.name}><Icon name="arrow" size={13}/> Resume · {resume.name} ({formatSize(resume.size)})</a>}
  </div>;
}

function FreelancerDirectory({ people }: { people: User[] }) {
  return <section className="section-block directory">
    <div className="section-heading"><div><h2>Freelancers on MilestonePay</h2><p>{people.length ? `${people.length} registered ${people.length === 1 ? "freelancer" : "freelancers"}` : "Freelancers who sign up will appear here."}</p></div></div>
    {people.length === 0 ? <p className="empty-note">No freelancers have registered yet.</p> : <div className="dir-grid">{people.map((p) => <article className="dir-card" key={p.id}>
      <div className="dir-top"><div className="avatar">{initials(p.name)}</div><div><b>{p.name}</b><small>{p.headline || "Freelancer"}</small></div></div>
      {p.bio && <p>{p.bio}</p>}
      {p.skills.length > 0 && <div className="skills">{p.skills.map((s) => <span key={s}>{s}</span>)}</div>}
      {p.portfolio || p.resume ? <ProfileLinks portfolio={p.portfolio} resume={p.resume}/> : <small className="muted-text">No portfolio or resume added.</small>}
    </article>)}</div>}
  </section>;
}

function MyProfile({ user, go }: { user: User; go: (page: Page) => void }) {
  return <><section className="profile-hero"><div className="profile-avatar">{initials(user.name)}</div><div className="profile-main"><span>FREELANCER</span><h1>{user.name}</h1><p className="profile-headline">{user.headline || "Add a headline so clients know what you do."}</p>{user.bio && <p>{user.bio}</p>}{user.skills.length > 0 && <div className="skills">{user.skills.map((s) => <span key={s}>{s}</span>)}</div>}<ProfileLinks portfolio={user.portfolio} resume={user.resume}/></div><Button kind="secondary" onClick={() => go("settings")}>Edit profile</Button></section>
    <section className="profile-stats"><div><strong>0</strong><span>Verified milestones</span></div><div><strong className="mono">$0</strong><span>Total captured payments</span></div><div><strong>0</strong><span>Completed projects</span></div><div><strong>—</strong><span>Criteria pass rate</span></div></section>
    <section className="section-block"><div className="section-heading"><div><h2>Portfolio &amp; resume</h2><p>Optional. Shown to clients browsing freelancers.</p></div></div>
      {user.portfolio || user.resume ? <div className="portfolio-box"><ProfileLinks portfolio={user.portfolio} resume={user.resume}/></div> : <p className="empty-note">You haven’t added a portfolio website or resume. <button className="text-link inline" onClick={() => go("settings")}>Add them in settings</button></p>}
    </section></>;
}

function Freelancer({ go, directory }: { go: (page: Page) => void; directory: User[] }) {
  return <><FreelancerDirectory people={directory}/><div className="spacer"/><section className="profile-hero"><div className="profile-avatar">MC</div><div className="profile-main"><span>VERIFIED FREELANCER</span><h1>Maya Chen</h1><a href="https://github.com" target="_blank" rel="noreferrer"><Icon name="github" size={15}/> @mayachen</a><p>Backend engineer specializing in reliable TypeScript services, payment systems and developer infrastructure.</p><div className="skills"><span>TypeScript</span><span>Node.js</span><span>PostgreSQL</span><span>API design</span></div></div><Button kind="secondary" onClick={() => go("review")}>Write a review</Button></section>
    <section className="profile-stats"><div><strong>18</strong><span>Verified milestones</span></div><div><strong className="mono">$18,420</strong><span>Total captured payments</span></div><div><strong>07</strong><span>Completed projects</span></div><div><strong>94%</strong><span>Criteria pass rate</span></div></section>
    <section className="section-block"><div className="section-heading"><div><h2>Verified milestone history</h2><p>Evidence-backed work completed through MilestonePay</p></div></div><div className="history-list">{[["Atlas Commerce API","API foundation & data model","$960.00"],["Northstar Analytics","Production deployment","$480.00"],["Northstar Analytics","Reporting engine","$320.00"],["Relay Design System","Component architecture","$600.00"]].map((r,i)=><div key={r[1]}><span className="history-index">0{i+1}</span><div><b>{r[0]}</b><p>{r[1]}</p></div><StatusBadge status="complete">Verified</StatusBadge><a href="https://github.com" target="_blank" rel="noreferrer">Evidence <Icon name="external" size={12}/></a><strong className="mono">{r[2]}</strong></div>)}</div></section>
  </>;
}

function Review({ go }: { go: (page: Page) => void }) {
  const [rating, setRating] = useState(0);
  const [done, setDone] = useState(false);
  return <div className="narrow-page"><PageHeader eyebrow="Northstar Analytics" title="Review your collaboration" subtitle="Reviews are available because a payment was captured for this project."/>
    {done ? <div className="success-state"><span><Icon name="check" size={24}/></span><h2>Review submitted</h2><p>Your verified-project review is now part of Maya Chen’s MilestonePay profile.</p><Button onClick={() => go("freelancers")}>View freelancer profile</Button></div> : <form className="review-form" onSubmit={(e)=>{e.preventDefault(); setDone(true);}}><div className="review-person"><div className="profile-avatar small">MC</div><div><span>FREELANCER</span><h3>Maya Chen</h3><p>Northstar Analytics · $1,600 captured</p></div></div><div className="field"><label>Overall rating</label><div className="rating">{[1,2,3,4,5].map(n=><button type="button" key={n} className={n<=rating ? "selected":""} onClick={()=>setRating(n)} aria-label={`${n} stars`}><svg viewBox="0 0 24 24"><path d="m12 2.5 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5-4.7-4.6 6.5-.9Z"/></svg></button>)}</div></div><div className="field"><label>Written feedback</label><textarea placeholder="Share specific feedback about the delivery, communication and quality of verified work..." required/></div><div className="form-actions"><Button kind="secondary" onClick={()=>go("freelancers")}>Cancel</Button><Button type="submit" disabled={!rating}>Submit review</Button></div></form>}
    <div className="eligibility-note"><Icon name="check" size={16}/><p><b>Verified review eligibility</b><br/>At least one PayPal Sandbox capture was completed for this project. Reviews cannot be submitted before a capture.</p></div>
  </div>;
}

function Modal({ close, confirm }: { close: () => void; confirm: () => void }) {
  return <div className="modal-backdrop" onMouseDown={close}><div className="modal" onMouseDown={(e)=>e.stopPropagation()}><div className="modal-icon"><Icon name="payments" size={20}/></div><h2>Approve payment release?</h2><p>You are approving a partial capture for the criteria that passed verification.</p><div className="modal-summary"><div><span>Project</span><b>Atlas Commerce API</b></div><div><span>Milestone</span><b>02 · Authentication & commerce</b></div><div><span>Authorization remaining</span><b className="mono">$2,240.00</b></div><div className="modal-total"><span>Amount to capture</span><strong className="mono">$1,024.00</strong></div></div><div className="legal-note compact"><Icon name="alert" size={16}/><p>This simulates a PayPal Sandbox capture. AI did not authorize this payment.</p></div><div className="modal-actions"><Button kind="secondary" onClick={close}>Cancel</Button><Button onClick={confirm}>Approve and capture $1,024</Button></div></div></div>;
}

function Toast({ close }: { close: () => void }) {
  useEffect(() => { const id = window.setTimeout(close, 4500); return () => window.clearTimeout(id); }, [close]);
  return <div className="toast"><span><Icon name="check" size={17}/></span><div><b>Payment capture approved</b><p>$1,024.00 was captured in PayPal Sandbox.</p></div><button onClick={close}><Icon name="close" size={15}/></button></div>;
}

function ResumeField({ draft, set }: { draft: Draft; set: (fn: (d: Draft) => Draft) => void }) {
  const [error, setError] = useState("");
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/\.(pdf|docx?)$/i.test(file.name)) { setError("Upload a PDF or Word document."); return; }
    if (file.size > MAX_RESUME_BYTES) { setError("Resume must be under 1.5 MB."); return; }
    try {
      const dataUrl = await readAsDataUrl(file);
      setError("");
      set((d) => ({ ...d, resume: { name: file.name, size: file.size, dataUrl } }));
    } catch { setError("Could not read that file."); }
  }
  return <div className="field">
    <div className="label-row"><label>Resume</label><span className="optional-tag">Optional</span></div>
    {draft.resume
      ? <div className="file-chip"><span><b>{draft.resume.name}</b><small>{formatSize(draft.resume.size)}</small></span><button type="button" onClick={() => set((d) => ({ ...d, resume: null }))}>Remove</button></div>
      : <label className="file-drop"><input type="file" accept=".pdf,.doc,.docx" onChange={pick}/><span>Upload PDF or Word document</span><small>Up to 1.5 MB</small></label>}
    {error && <small className="error-text">{error}</small>}
  </div>;
}

function ProfileFields({ role, draft, set, attempted }: { role: Role; draft: Draft; set: (fn: (d: Draft) => Draft) => void; attempted: boolean }) {
  const upd = (p: Partial<Draft>) => set((d) => ({ ...d, ...p }));
  const badUrl = attempted && draft.portfolio.trim() !== "" && normalizeUrl(draft.portfolio) === null;
  if (role === "client") return <>
    <div className="field"><div className="label-row"><label>Company or organisation</label><span className="optional-tag">Optional</span></div><input value={draft.company} onChange={(e) => upd({ company: e.target.value })} placeholder="e.g. Northwind Labs"/></div>
    <div className="field"><div className="label-row"><label>Company website</label><span className="optional-tag">Optional</span></div><input value={draft.portfolio} onChange={(e) => upd({ portfolio: e.target.value })} placeholder="https://yourcompany.com" className={badUrl ? "invalid" : ""}/>{badUrl && <small className="error-text">Enter a valid website address.</small>}</div>
    <div className="field"><div className="label-row"><label>What do you hire for?</label><span className="optional-tag">Optional</span></div><textarea value={draft.bio} onChange={(e) => upd({ bio: e.target.value })} placeholder="A sentence about the software work you typically need." maxLength={400} className="short"/></div>
  </>;
  return <>
    <div className="field"><label>Professional headline</label><input value={draft.headline} onChange={(e) => upd({ headline: e.target.value })} placeholder="e.g. Backend engineer · TypeScript & Postgres" maxLength={90}/></div>
    <div className="field"><label>Skills</label><input value={draft.skills} onChange={(e) => upd({ skills: e.target.value })} placeholder="TypeScript, Node.js, PostgreSQL"/><small>Separate skills with commas.</small></div>
    <div className="field"><div className="label-row"><label>About you</label><span className="optional-tag">Optional</span></div><textarea value={draft.bio} onChange={(e) => upd({ bio: e.target.value })} placeholder="Briefly describe your experience and the work you do best." maxLength={500} className="short"/></div>
    <div className="field"><div className="label-row"><label>Portfolio website</label><span className="optional-tag">Optional</span></div><input value={draft.portfolio} onChange={(e) => upd({ portfolio: e.target.value })} placeholder="https://yourportfolio.dev" className={badUrl ? "invalid" : ""}/>{badUrl && <small className="error-text">Enter a valid website address.</small>}</div>
    <ResumeField draft={draft} set={set}/>
  </>;
}

const authCopy: Record<Role, { statement: ReactNode; text: string; proof: [string, string][] }> = {
  client: {
    statement: <>Software work,<br/>verified before release.</>,
    text: "Define milestones with AI, authorize funds once, and release payment only after GitHub evidence checks out.",
    proof: [["Define", "AI-assisted milestone planning"], ["Verify", "Evidence-backed GitHub checks"], ["Approve", "You control every payment capture"]],
  },
  freelancer: {
    statement: <>Ship the work.<br/>Get paid for what passes.</>,
    text: "Submit your repository against clear acceptance criteria and receive payment for every criterion that verifies.",
    proof: [["Accept", "Clear, machine-checkable criteria"], ["Submit", "Link your GitHub repository"], ["Earn", "Paid for each verified milestone"]],
  },
};

function AuthScreen({ mode, setMode, onAuth }: { mode: "login" | "signup"; setMode: (mode: "login" | "signup") => void; onAuth: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("client");
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const copy = authCopy[role];
  const portfolioOk = draft.portfolio.trim() === "" || normalizeUrl(draft.portfolio) !== null;
  const valid = email.includes("@") && password.length >= 6 && (mode === "login" || (name.trim().length > 1 && portfolioOk));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setAttempted(true);
    setError("");
    if (!valid || busy) return;
    setBusy(true);
    try {
      const accounts = loadAccounts();
      const key = email.trim().toLowerCase();
      const passHash = await hashPassword(password, key);
      if (mode === "login") {
        const found = accounts.find((a) => a.email === key);
        if (!found || found.passHash !== passHash) { setError("Incorrect email or password."); return; }
        onAuth(found);
        return;
      }
      if (accounts.some((a) => a.email === key)) { setError("An account with this email already exists. Log in instead."); return; }
      const user: User = { id: crypto.randomUUID?.() ?? String(Date.now()), name: name.trim(), email: key, role, passHash, ...draftToProfile(draft) };
      if (!saveAccounts([...accounts, user])) { setError("Could not save your account. Try a smaller resume file."); return; }
      onAuth(user);
    } finally { setBusy(false); }
  }

  return <div className="auth-shell">
    <section className="auth-brand-panel">
      <div className="auth-wordmark"><span className="brand-mark"><i/><i/><i/></span><b>MilestonePay</b></div>
      <div className="auth-statement"><div className="eyebrow">{mode === "signup" ? (role === "client" ? "FOR CLIENTS" : "FOR FREELANCERS") : "CONTROLLED DELIVERY · ACCOUNTABLE PAYMENT"}</div><h1>{mode === "signup" ? copy.statement : authCopy.client.statement}</h1><p>{mode === "signup" ? copy.text : "Milestone-based payment authorization with GitHub evidence, deterministic checks and explicit client approval."}</p></div>
      <div className="auth-proof">{(mode === "signup" ? copy.proof : authCopy.client.proof).map(([t, s], i) => <div key={t}><span>0{i + 1}</span><p><b>{t}</b><small>{s}</small></p></div>)}</div>
      <p className="auth-sandbox">DEMONSTRATION ENVIRONMENT · PAYPAL SANDBOX</p>
    </section>
    <main className="auth-main">
      <div className="auth-mobile-brand"><span className="brand-mark"><i/><i/><i/></span><b>MilestonePay</b></div>
      <div className="auth-card">
        <div className="auth-tabs"><button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); setAttempted(false); }}>Log in</button><button type="button" className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); setAttempted(false); }}>Create account</button></div>
        <div className="auth-heading"><span>{mode === "login" ? "WELCOME BACK" : "GET STARTED"}</span><h2>{mode === "login" ? "Log in to MilestonePay" : "Create your account"}</h2><p>{mode === "login" ? "You’ll land in the workspace for your account type." : "Choose how you’ll use MilestonePay. You’ll get a workspace built for that role."}</p></div>
        <form onSubmit={submit} noValidate>
          {mode === "signup" && <div className="auth-role"><span>I AM A</span><div><button type="button" className={role === "client" ? "active" : ""} onClick={() => setRole("client")}><b>Client</b><small>Hire developers, fund milestones and approve releases</small></button><button type="button" className={role === "freelancer" ? "active" : ""} onClick={() => setRole("freelancer")}><b>Freelancer</b><small>Take on projects, submit work and get paid</small></button></div></div>}
          {mode === "signup" && <div className="field"><label>Full name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" className={attempted && name.trim().length < 2 ? "invalid" : ""}/></div>}
          <div className="field"><label>Email address</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="email" className={attempted && !email.includes("@") ? "invalid" : ""}/></div>
          <div className="field"><div className="label-row"><label>Password</label>{mode === "login" && <button type="button" className="forgot-link">Forgot password?</button>}</div><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete={mode === "login" ? "current-password" : "new-password"} className={attempted && password.length < 6 ? "invalid" : ""}/>{attempted && !valid && <small className="error-text">Complete all required fields with valid details.</small>}</div>
          {mode === "signup" && <><div className="auth-section-label">{role === "client" ? "ABOUT YOUR BUSINESS" : "YOUR FREELANCER PROFILE"}</div><ProfileFields role={role} draft={draft} set={setDraft} attempted={attempted}/></>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <Button type="submit" disabled={busy}>{mode === "login" ? "Log in" : role === "client" ? "Create client account" : "Create freelancer account"} <Icon name="arrow" size={16}/></Button>
        </form>
        <p className="auth-disclaimer">Prototype: accounts are saved only in this browser and no data is sent to a server.</p>
      </div>
    </main>
  </div>;
}

function Settings({ user, onSave }: { user: User; onSave: (patch: Partial<User>) => boolean }) {
  const [name, setName] = useState(user.name);
  const [draft, setDraft] = useState<Draft>(emptyDraft(user));
  const [attempted, setAttempted] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const isClient = user.role === "client";
  function save(e: FormEvent) {
    e.preventDefault();
    setAttempted(true);
    if (name.trim().length < 2) { setMessage({ ok: false, text: "Enter your full name." }); return; }
    if (draft.portfolio.trim() && normalizeUrl(draft.portfolio) === null) { setMessage({ ok: false, text: "Fix the website address before saving." }); return; }
    const ok = onSave({ name: name.trim(), ...draftToProfile(draft) });
    setMessage(ok ? { ok: true, text: "Profile saved." } : { ok: false, text: "Could not save. Try a smaller resume file." });
  }
  return <div className="narrow-page"><PageHeader title={isClient ? "Account settings" : "Edit profile"} subtitle={isClient ? "Your business details and contact information." : "Your public freelancer profile. Portfolio and resume are optional."}/>
    <form className="form-panel" onSubmit={save} noValidate>
      <div className="field"><label>Full name</label><input value={name} onChange={(e) => setName(e.target.value)} className={attempted && name.trim().length < 2 ? "invalid" : ""}/></div>
      <div className="field"><label>Email address</label><input value={user.email} disabled/><small>Account type: {isClient ? "Client" : "Freelancer"}</small></div>
      <ProfileFields role={user.role} draft={draft} set={setDraft} attempted={attempted}/>
      {message && <p className={message.ok ? "auth-success" : "auth-error"} role="status">{message.text}</p>}
      <div className="form-actions"><Button type="submit">Save changes</Button></div>
    </form>
  </div>;
}

function AppShell() {
  const [page, setPage] = useState<Page>("overview");
  const [user, setUser] = useState<User | null>(() => {
    try { const id = localStorage.getItem(SESSION_KEY); return id ? loadAccounts().find((a) => a.id === id) ?? null : null; } catch { return null; }
  });
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("mp-theme") as Theme) || "light");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [capture, setCapture] = useState(false);
  const [toast, setToast] = useState(false);
  useEffect(() => {
    localStorage.setItem("mp-theme", theme);
    const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [theme]);

  const role: Role = user?.role ?? "client";
  const clientPages: Page[] = ["create", "plan", "fund", "freelancers"];
  const freelancerPages: Page[] = ["submit", "myprofile"];
  function allowed(p: Page) {
    if (clientPages.includes(p)) return role === "client";
    if (freelancerPages.includes(p)) return role === "freelancer";
    return true;
  }
  function go(p: Page) { setPage(allowed(p) ? p : "overview"); setMobileOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function signIn(u: User) { try { localStorage.setItem(SESSION_KEY, u.id); } catch { /* session just won't persist */ } setUser(u); setPage("overview"); }
  function signOut() { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } setUser(null); setPage("overview"); setMobileOpen(false); }
  function saveProfile(patch: Partial<User>) {
    if (!user) return false;
    const next = { ...user, ...patch };
    const accounts = loadAccounts().map((a) => (a.id === next.id ? next : a));
    if (!saveAccounts(accounts)) return false;
    setUser(next);
    return true;
  }

  if (!user) return <AuthScreen mode={authMode} setMode={setAuthMode} onAuth={signIn}/>;

  const nav: { id: Page; label: string; icon: string }[] = role === "client"
    ? [{ id: "overview", label: "Overview", icon: "overview" }, { id: "projects", label: "Projects", icon: "projects" }, { id: "payments", label: "Payments", icon: "payments" }, { id: "freelancers", label: "Find freelancers", icon: "users" }]
    : [{ id: "overview", label: "Overview", icon: "overview" }, { id: "projects", label: "My work", icon: "projects" }, { id: "payments", label: "Earnings", icon: "payments" }, { id: "myprofile", label: "My profile", icon: "users" }];
  const projectPages: Page[] = ["project", "create", "plan", "fund", "submit", "verification", "revision"];
  const directory = loadAccounts().filter((a) => a.role === "freelancer");

  let content: ReactNode;
  if (page === "overview") content = <Overview role={role} go={go} user={user}/>;
  else if (page === "projects") content = <Projects go={go} role={role}/>;
  else if (page === "create") content = <CreateProject go={go}/>;
  else if (page === "plan") content = <Plan go={go}/>;
  else if (page === "fund") content = <Fund go={go}/>;
  else if (page === "project") content = <ProjectDetail go={go} role={role}/>;
  else if (page === "submit") content = <Submit go={go}/>;
  else if (page === "verification") content = <Verification go={go} role={role} openCapture={() => setCapture(true)}/>;
  else if (page === "revision") content = <Revision go={go} role={role}/>;
  else if (page === "payments") content = <Payments role={role}/>;
  else if (page === "settings") content = <Settings key={user.id} user={user} onSave={saveProfile}/>;
  else if (page === "myprofile") content = <MyProfile user={user} go={go}/>;
  else if (page === "freelancers") content = <Freelancer go={go} directory={directory}/>;
  else content = <Review go={go}/>;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}><div className="brand"><span className="brand-mark"><i/><i/><i/></span><b>MilestonePay</b><button onClick={() => setMobileOpen(false)}><Icon name="close" size={18}/></button></div><nav>{nav.map((n) => <button key={n.id} className={(page === n.id || (n.id === "projects" && projectPages.includes(page))) ? "active" : ""} onClick={() => go(n.id)}><Icon name={n.icon} size={17}/><span>{n.label}</span></button>)}</nav><div className="sidebar-bottom"><button className={`settings ${page === "settings" ? "active" : ""}`} onClick={() => go("settings")}><Icon name="settings" size={17}/>{role === "client" ? "Account settings" : "Edit profile"}</button><div className="profile"><div className="avatar">{initials(user.name)}</div><div><b>{user.name}</b><small>{role === "client" ? (user.company || "Client account") : "Freelancer account"}</small></div><button className="profile-signout" onClick={signOut} aria-label="Log out" title="Log out">Log out</button></div></div></aside>
    {mobileOpen && <div className="mobile-overlay" onClick={() => setMobileOpen(false)}/>}
    <div className="main-column"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileOpen(true)}><Icon name="menu" size={20}/></button><div className="mobile-wordmark">MilestonePay</div><div className="demo-label"><span/> DEMONSTRATION ENVIRONMENT · {role === "client" ? "CLIENT" : "FREELANCER"} WORKSPACE</div><div className="top-actions"><div className="theme-control" aria-label="Theme preference">{(["light", "dark", "system"] as Theme[]).map((t) => <button key={t} className={theme === t ? "active" : ""} onClick={() => setTheme(t)} aria-label={`${t} theme`}><Icon name={t === "light" ? "sun" : t === "dark" ? "moon" : "monitor"} size={15}/></button>)}</div><button className="top-avatar" onClick={() => go("settings")} aria-label="Open settings">{initials(user.name)}</button></div></header><main className="content">{content}</main></div>
    {capture && <Modal close={() => setCapture(false)} confirm={() => { setCapture(false); setToast(true); go("project"); }}/>}{toast && <Toast close={() => setToast(false)}/>}
  </div>;
}

export default function App() {
  return <AppShell/>;
}
