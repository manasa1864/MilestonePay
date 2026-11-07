import { useState, type FormEvent } from "react";
import { useApp } from "../app-context";
import { backend, supabaseConfigured } from "../lib/backend";
import { errorText } from "../lib/format";
import { Button, Notice, PageHeader } from "../ui";
import { draftErrors, draftFrom, draftToInput, ProfileFields, resumeChange, type ProfileDraft } from "./ProfileFields";

export function Settings() {
  const { user, setUser, reload } = useApp();
  const [name, setName] = useState(user.fullName);
  const [draft, setDraft] = useState<ProfileDraft>(draftFrom(user));
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const client = user.role === "client";

  async function save(e: FormEvent) {
    e.preventDefault();
    setAttempted(true);
    setMessage(null);
    if (name.trim().length < 2) { setMessage({ ok: false, text: "Enter your full name." }); return; }
    const problem = draftErrors(draft);
    if (problem) { setMessage({ ok: false, text: problem }); return; }
    setBusy(true);
    try {
      const updated = await backend.updateProfile(draftToInput(name, draft), resumeChange(draft));
      setUser(updated);
      setDraft(draftFrom(updated));
      await reload();
      setMessage({ ok: true, text: "Profile saved." });
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return <div className="narrow-page"><PageHeader title={client ? "Account settings" : "Edit profile"} subtitle={client ? "Your business details and contact information." : "Your public freelancer profile. Portfolio website and resume are optional."}/>
    <form className="form-panel" onSubmit={save} noValidate>
      <div className="field"><label>Full name</label><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={attempted && name.trim().length < 2 ? "invalid" : ""}/></div>
      <div className="field"><label>Email address</label><input value={user.email} disabled/><small>Account type: {client ? "Client" : "Freelancer"}. The account type can’t be changed.</small></div>
      <ProfileFields role={user.role} draft={draft} set={setDraft} attempted={attempted}/>
      {message && <p className={message.ok ? "auth-success" : "auth-error"} role="status">{message.text}</p>}
      <div className="form-actions"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button></div>
    </form>
    <div className="spacer"/>
    <Notice tone="info">{supabaseConfigured ? "Your data is stored in Supabase. Resumes are kept in a private storage bucket and shared with signed-in clients through short-lived links." : "Local mode: data is stored in this browser only. Add your Supabase URL and anon key to .env to use a real database."}</Notice>
  </div>;
}
