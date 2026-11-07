import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppContext, useApp, type AppCtx } from "./app-context";
import { backend, supabaseConfigured } from "./lib/backend";
import { errorText, initials } from "./lib/format";
import type { Profile, Role, Workspace } from "./lib/types";
import { AuthScreen } from "./pages/Auth";
import { CreateProject, NotAllowed } from "./pages/CreateProject";
import { FreelancerDirectory, FreelancerProfile } from "./pages/Freelancers";
import { Fund } from "./pages/Fund";
import { Overview } from "./pages/Overview";
import { Payments } from "./pages/Payments";
import { ProjectDetail } from "./pages/ProjectDetail";
import { Projects } from "./pages/Projects";
import { ReviewPage } from "./pages/Review";
import { Settings } from "./pages/Settings";
import { Submit } from "./pages/Submit";
import { Verification } from "./pages/Verification";
import { Button, Empty, Icon, Spinner, Toast } from "./ui";

type Theme = "light" | "dark" | "system";

const emptyWorkspace: Workspace = { projects: [], milestones: [], criteria: [], submissions: [], verifications: [], revisions: [], payments: [], reviews: [], activity: [], people: {} };

function readHash() {
  const raw = window.location.hash.replace(/^#/, "") || "/overview";
  const [path, query = ""] = raw.split("?");
  return { path, query: new URLSearchParams(query) };
}

function useHashRoute() {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    const on = () => setRoute(readHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((to: string) => {
    if (window.location.hash !== `#${to}`) window.location.hash = to;
    else setRoute(readHash());
    window.scrollTo({ top: 0 });
  }, []);
  return { ...route, go };
}

function renderRoute(path: string, query: URLSearchParams, role: Role): { node: ReactNode; section: string } {
  const seg = path.split("/").filter(Boolean);
  const clientOnly = (node: ReactNode) => (role === "client" ? node : <NotAllowed/>);
  const freelancerOnly = (node: ReactNode) => (role === "freelancer" ? node : <NotAllowed/>);
  switch (seg[0]) {
    case "overview": return { node: <Overview/>, section: "overview" };
    case "projects":
      if (seg[1] === "new") return { node: clientOnly(<CreateProject preselect={query.get("freelancer") ?? undefined}/>), section: "projects" };
      return { node: <Projects/>, section: "projects" };
    case "project":
      if (seg[1] && seg[2] === "fund") return { node: clientOnly(<Fund key={seg[1]} projectId={seg[1]}/>), section: "projects" };
      if (seg[1]) return { node: <ProjectDetail key={seg[1]} projectId={seg[1]}/>, section: "projects" };
      break;
    case "milestone":
      if (seg[1] && seg[2] === "submit") return { node: freelancerOnly(<Submit key={seg[1]} milestoneId={seg[1]}/>), section: "projects" };
      break;
    case "verification":
      if (seg[1]) return { node: <Verification key={seg[1]} verificationId={seg[1]}/>, section: "projects" };
      break;
    case "payments": return { node: <Payments/>, section: "payments" };
    case "freelancers":
      if (seg[1]) return { node: <FreelancerProfile key={seg[1]} freelancerId={seg[1]}/>, section: role === "client" ? "freelancers" : "profile" };
      return { node: clientOnly(<FreelancerDirectory/>), section: "freelancers" };
    case "profile": return { node: freelancerOnly(<ProfileSelf/>), section: "profile" };
    case "settings": return { node: <Settings/>, section: "settings" };
    case "review":
      if (seg[1]) return { node: clientOnly(<ReviewPage key={seg[1]} projectId={seg[1]}/>), section: "projects" };
      break;
  }
  return { node: <NotFound/>, section: "" };
}

function ProfileSelf() {
  const { user } = useApp();
  return <FreelancerProfile freelancerId={user.id}/>;
}

function NotFound() {
  return <Empty title="Page not found" action={<Button onClick={() => { window.location.hash = "/overview"; }}>Go to overview</Button>}>The link may be out of date.</Empty>;
}

export default function App() {
  const route = useHashRoute();
  const [user, setUserState] = useState<Profile | null>(null);
  const [booting, setBooting] = useState(true);
  const [ws, setWs] = useState<Workspace>(emptyWorkspace);
  const [wsError, setWsError] = useState("");
  const [loadingWs, setLoadingWs] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [theme, setTheme] = useState<Theme>(() => { try { return (localStorage.getItem("mp-theme") as Theme) || "light"; } catch { return "light"; } });
  const [mobileOpen, setMobileOpen] = useState(false);

  const setUser = useCallback((p: Profile | null) => setUserState(p), []);
  useEffect(() => { setToast(null); }, [user?.id]);

  useEffect(() => {
    try { localStorage.setItem("mp-theme", theme); } catch { /* ignore */ }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = theme === "dark" || (theme === "system" && mq.matches) ? "dark" : "light"; };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  const reload = useCallback(async () => {
    try {
      setWs(await backend.loadWorkspace());
      setWsError("");
    } catch (e) {
      setWsError(errorText(e));
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try { setUser(await backend.currentProfile()); } catch { setUser(null); }
    setBooting(false);
  }, [setUser]);

  useEffect(() => {
    refreshSession();
    return backend.onAuthChange(() => { refreshSession(); });
  }, [refreshSession]);

  useEffect(() => {
    if (!user) { setWs(emptyWorkspace); return; }
    setLoadingWs(true);
    reload().finally(() => setLoadingWs(false));
  }, [user?.id, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const notify = useCallback((message: string, tone: "success" | "error" = "success") => setToast({ message, tone }), []);
  const go = useCallback((to: string) => { setMobileOpen(false); route.go(to); }, [route]);

  const ctx: AppCtx | null = useMemo(() => (user ? { user, ws, reload, setUser: (p: Profile) => setUser(p), go, notify } : null), [user, ws, reload, setUser, go, notify]);

  if (booting) return <div className="boot"><Spinner dark/></div>;
  if (!user || !ctx) return <AuthScreen onAuth={(p) => { setUser(p); route.go("/overview"); }}/>;

  const role = user.role;
  const { node, section } = renderRoute(route.path, route.query, role);
  const nav: { id: string; to: string; label: string; icon: string }[] = role === "client"
    ? [{ id: "overview", to: "/overview", label: "Overview", icon: "overview" }, { id: "projects", to: "/projects", label: "Projects", icon: "projects" }, { id: "payments", to: "/payments", label: "Payments", icon: "payments" }, { id: "freelancers", to: "/freelancers", label: "Find freelancers", icon: "users" }]
    : [{ id: "overview", to: "/overview", label: "Overview", icon: "overview" }, { id: "projects", to: "/projects", label: "My work", icon: "projects" }, { id: "payments", to: "/payments", label: "Earnings", icon: "payments" }, { id: "profile", to: "/profile", label: "My profile", icon: "user" }];
  const counts: Record<string, number> = {
    projects: role === "client"
      ? ws.milestones.filter((m) => m.status === "submitted").length + ws.projects.filter((p) => p.status === "draft").length
      : ws.milestones.filter((m) => (m.status === "in_progress" || m.status === "revision_requested") && ws.projects.find((p) => p.id === m.projectId)?.status === "in_progress").length,
  };

  async function signOut() {
    await backend.signOut();
    setUser(null);
    window.location.hash = "/overview";
  }

  return <AppContext.Provider value={ctx}><div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}><div className="brand"><span className="brand-mark"><i/><i/><i/></span><b>MilestonePay</b><button onClick={() => setMobileOpen(false)} aria-label="Close menu"><Icon name="close" size={18}/></button></div>
      <nav>{nav.map((n) => <button key={n.id} className={section === n.id ? "active" : ""} onClick={() => go(n.to)}><Icon name={n.icon} size={17}/><span>{n.label}</span>{counts[n.id] ? <em className="nav-count">{counts[n.id]}</em> : null}</button>)}</nav>
      <div className="sidebar-bottom"><button className={`settings ${section === "settings" ? "active" : ""}`} onClick={() => go("/settings")}><Icon name="settings" size={17}/>{role === "client" ? "Account settings" : "Edit profile"}</button><div className="profile"><div className="avatar">{initials(user.fullName)}</div><div><b>{user.fullName}</b><small>{role === "client" ? (user.company || "Client account") : "Freelancer account"}</small></div><button className="profile-signout" onClick={signOut} title="Log out">Log out</button></div><div className={`backend-pill ${supabaseConfigured ? "on" : ""}`}><span/>{supabaseConfigured ? "Supabase connected" : "Local mode · browser storage"}</div></div>
    </aside>
    {mobileOpen && <div className="mobile-overlay" onClick={() => setMobileOpen(false)}/>}
    <div className="main-column"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Icon name="menu" size={20}/></button><div className="mobile-wordmark">MilestonePay</div><div className="demo-label"><span/> PAYPAL SANDBOX · {role === "client" ? "CLIENT" : "FREELANCER"} WORKSPACE</div><div className="top-actions"><div className="theme-control" aria-label="Theme preference">{(["light", "dark", "system"] as Theme[]).map((t) => <button key={t} className={theme === t ? "active" : ""} onClick={() => setTheme(t)} aria-label={`${t} theme`}><Icon name={t === "light" ? "sun" : t === "dark" ? "moon" : "monitor"} size={15}/></button>)}</div><button className="top-avatar" onClick={() => go("/settings")} aria-label="Open settings">{initials(user.fullName)}</button></div></header>
      <main className="content">
        {wsError && <div className="ws-error"><b>Couldn’t load your data.</b> {wsError} <button className="text-link inline" onClick={reload}>Retry</button></div>}
        {loadingWs && ws.projects.length === 0 && !wsError ? <div className="loading-row"><Spinner dark/> Loading your workspace…</div> : node}
      </main>
    </div>
    {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)}/>}
  </div></AppContext.Provider>;
}
