import { useState, type FormEvent, type ReactNode } from "react";
import { backend, supabaseConfigured } from "../lib/backend";
import { errorText } from "../lib/format";
import type { Profile, Role } from "../lib/types";
import { Button, Icon } from "../ui";
import { draftBusy, draftErrors, draftFrom, draftToInput, ProfileFields, type ProfileDraft } from "./ProfileFields";

const copy: Record<Role, { statement: ReactNode; text: string; proof: [string, string][] }> = {
  client: {
    statement: <>Software work,<br/>verified before release.</>,
    text: "Define milestones, authorize funds once, and release payment only after GitHub evidence checks out.",
    proof: [["Define", "Suggested milestone plans you can edit"], ["Verify", "Evidence-backed GitHub checks"], ["Approve", "You control every payment capture"]],
  },
  freelancer: {
    statement: <>Ship the work.<br/>Get paid for what passes.</>,
    text: "Submit your repository against clear acceptance criteria and receive payment for every criterion that verifies.",
    proof: [["Accept", "Clear, machine-checkable criteria"], ["Submit", "Link your public GitHub repository"], ["Earn", "Paid for each verified milestone"]],
  },
};

export function AuthScreen({ onAuth }: { onAuth: (p: Profile) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("client");
  const [draft, setDraft] = useState<ProfileDraft>(draftFrom());
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const c = copy[role];
  const valid = email.includes("@") && password.length >= 6 && (mode === "login" || (name.trim().length > 1 && !draftErrors(draft)));

  function switchMode(m: "login" | "signup") { setMode(m); setError(""); setAttempted(false); }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setAttempted(true);
    setError("");
    if (!valid || busy || draftBusy(draft)) return;
    setBusy(true);
    try {
      if (mode === "login") {
        onAuth(await backend.signIn(email.trim(), password));
      } else {
        const res = await backend.signUp({ ...draftToInput(name, draft), email: email.trim(), password, role, resumeFile: draft.resumeFile, resumeText: draft.resumeText ?? "" });
        if (res.profile) onAuth(res.profile);
        else setError("Your account was created but your profile couldn’t be loaded. Make sure supabase/schema.sql has been run, then log in.");
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return <div className="auth-shell">
    <section className="auth-brand-panel">
      <div className="auth-wordmark"><span className="brand-mark"><i/><i/><i/></span><b>MilestonePay</b></div>
      <div className="auth-statement"><div className="eyebrow">{mode === "signup" ? (role === "client" ? "FOR CLIENTS" : "FOR FREELANCERS") : "CONTROLLED DELIVERY · ACCOUNTABLE PAYMENT"}</div><h1>{mode === "signup" ? c.statement : copy.client.statement}</h1><p>{mode === "signup" ? c.text : "Milestone-based payment authorization with GitHub evidence, deterministic checks and explicit client approval."}</p></div>
      <div className="auth-proof">{(mode === "signup" ? c.proof : copy.client.proof).map(([t, s], i) => <div key={t}><span>0{i + 1}</span><p><b>{t}</b><small>{s}</small></p></div>)}</div>
      <p className="auth-sandbox">DEMONSTRATION ENVIRONMENT · PAYPAL SANDBOX</p>
    </section>
    <main className="auth-main">
      <div className="auth-mobile-brand"><span className="brand-mark"><i/><i/><i/></span><b>MilestonePay</b></div>
      <div className="auth-card">
        <div className="auth-tabs"><button type="button" className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>Log in</button><button type="button" className={mode === "signup" ? "active" : ""} onClick={() => switchMode("signup")}>Create account</button></div>
        <div className="auth-heading"><span>{mode === "login" ? "WELCOME BACK" : "GET STARTED"}</span><h2>{mode === "login" ? "Log in to MilestonePay" : "Create your account"}</h2><p>{mode === "login" ? "You’ll land in the workspace for your account type." : "Choose how you’ll use MilestonePay. You’ll get a workspace built for that role."}</p></div>
        <form onSubmit={submit} noValidate>
          {mode === "signup" && <div className="auth-role"><span>I AM A</span><div><button type="button" className={role === "client" ? "active" : ""} onClick={() => setRole("client")}><b>Client</b><small>Hire developers, fund milestones and approve releases</small></button><button type="button" className={role === "freelancer" ? "active" : ""} onClick={() => setRole("freelancer")}><b>Freelancer</b><small>Take on projects, submit work and get paid</small></button></div></div>}
          {mode === "signup" && <div className="field"><label>Full name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" autoComplete="name" maxLength={120} className={attempted && name.trim().length < 2 ? "invalid" : ""}/></div>}
          <div className="field"><label>Email address</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="email" className={attempted && !email.includes("@") ? "invalid" : ""}/></div>
          <div className="field"><label>Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete={mode === "login" ? "current-password" : "new-password"} className={attempted && password.length < 6 ? "invalid" : ""}/>{attempted && !valid && <small className="error-text">Complete all required fields with valid details.</small>}</div>
          {mode === "signup" && <><div className="auth-section-label">{role === "client" ? "ABOUT YOUR BUSINESS" : "YOUR FREELANCER PROFILE"}</div><ProfileFields role={role} draft={draft} set={setDraft} attempted={attempted}/></>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <Button type="submit" disabled={busy || draftBusy(draft)}>{busy ? "Please wait…" : draftBusy(draft) ? "Reading your resume…" : mode === "login" ? "Log in" : role === "client" ? "Create client account" : "Create freelancer account"} <Icon name="arrow" size={16}/></Button>
        </form>
        <p className="auth-disclaimer">{supabaseConfigured ? "Accounts are secured with Supabase Auth. Payments are simulated in PayPal Sandbox." : "Local mode: Supabase isn’t configured yet, so accounts and projects are saved only in this browser."}</p>
      </div>
    </main>
  </div>;
}
