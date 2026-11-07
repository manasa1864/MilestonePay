import { useState } from "react";
import { act, useApp } from "../app-context";
import { backend } from "../lib/backend";
import { initials, money as fmt } from "../lib/format";
import { money, personName } from "../lib/select";
import { Button, Empty, Icon, PageHeader } from "../ui";

export function ReviewPage({ projectId }: { projectId: string }) {
  const ctx = useApp();
  const { ws, go } = ctx;
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const p = ws.projects.find((x) => x.id === projectId);
  if (!p || !p.freelancerId) return <Empty title="Project not found" action={<Button onClick={() => go("/projects")}>Projects</Button>}/>;
  const existing = ws.reviews.find((r) => r.projectId === p.id);
  const captured = money(ws, p.id).captured;
  const name = personName(ws, p.freelancerId);

  async function submit() {
    setBusy(true);
    const ok = await act(ctx, () => backend.submitReview(p!.id, rating, body).then(() => true), "Review submitted.");
    setBusy(false);
    if (ok) go(`/freelancers/${p!.freelancerId}`);
  }

  return <div className="narrow-page"><PageHeader eyebrow={p.title} title="Review your collaboration" subtitle="Reviews appear on the freelancer’s public profile."/>
    {existing ? <div className="success-state"><span><Icon name="check" size={24}/></span><h2>Already reviewed</h2><p>You gave {name} {existing.rating} star{existing.rating === 1 ? "" : "s"} for this project.</p><Button onClick={() => go(`/freelancers/${p.freelancerId}`)}>View profile</Button></div>
      : captured === 0 ? <Empty title="Reviews open after the first capture">Approve at least one milestone release on this project first.</Empty>
      : <form className="review-form" onSubmit={(e) => { e.preventDefault(); if (rating && body.trim().length >= 10) submit(); }}>
        <div className="review-person"><div className="profile-avatar small">{initials(name)}</div><div><span>FREELANCER</span><h3>{name}</h3><p>{p.title} · {fmt(captured)} captured</p></div></div>
        <div className="field"><label>Overall rating</label><div className="rating">{[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} className={n <= rating ? "selected" : ""} onClick={() => setRating(n)} aria-label={`${n} stars`}><svg viewBox="0 0 24 24"><path d="m12 2.5 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5-4.7-4.6 6.5-.9Z"/></svg></button>)}</div></div>
        <div className="field"><div className="label-row"><label>Written feedback</label><span>{body.length} / 2,000</span></div><textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} placeholder="Share specific feedback about the delivery, communication and quality of verified work..."/>{body.length > 0 && body.trim().length < 10 && <small className="error-text">Write at least 10 characters.</small>}</div>
        <div className="form-actions"><Button kind="secondary" onClick={() => go(`/project/${p.id}`)}>Cancel</Button><Button type="submit" disabled={!rating || body.trim().length < 10 || busy}>{busy ? "Submitting…" : "Submit review"}</Button></div>
      </form>}
    <div className="eligibility-note"><Icon name="check" size={16}/><p><b>Verified review eligibility</b><br/>Only clients with at least one captured payment on a project can review it, once per project.</p></div>
  </div>;
}
