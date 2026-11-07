import { useState, type ChangeEvent } from "react";
import { formatSize, normalizeUrl, parseSkills } from "../lib/format";
import type { Profile, ProfileInput, ResumeChange, ResumeRef, Role } from "../lib/types";

export const MAX_RESUME_BYTES = 1_572_864;

export type ProfileDraft = {
  company: string;
  headline: string;
  bio: string;
  skills: string;
  portfolio: string;
  github: string;
  existingResume: ResumeRef | null;
  resumeFile: File | null;
  removeResume: boolean;
};

export function draftFrom(p?: Profile): ProfileDraft {
  return {
    company: p?.company ?? "", headline: p?.headline ?? "", bio: p?.bio ?? "", skills: p?.skills.join(", ") ?? "",
    portfolio: p?.portfolioUrl ?? "", github: p?.githubUsername ?? "", existingResume: p?.resume ?? null, resumeFile: null, removeResume: false,
  };
}

export function draftErrors(d: ProfileDraft): string | null {
  if (d.portfolio.trim() && normalizeUrl(d.portfolio) === null) return "Enter a valid website address.";
  if (d.github.trim() && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(d.github.trim().replace(/^@/, ""))) return "Enter a valid GitHub username.";
  return null;
}

export function draftToInput(fullName: string, d: ProfileDraft): ProfileInput {
  return {
    fullName: fullName.trim(), company: d.company.trim(), headline: d.headline.trim(), bio: d.bio.trim(),
    skills: parseSkills(d.skills), portfolioUrl: normalizeUrl(d.portfolio) ?? "", githubUsername: d.github.trim().replace(/^@/, ""),
  };
}

export function resumeChange(d: ProfileDraft): ResumeChange {
  if (d.resumeFile) return d.resumeFile;
  if (d.removeResume) return null;
  return undefined;
}

type Setter = (fn: (d: ProfileDraft) => ProfileDraft) => void;

function ResumeField({ draft, set }: { draft: ProfileDraft; set: Setter }) {
  const [error, setError] = useState("");
  function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/\.(pdf|docx?)$/i.test(file.name)) { setError("Upload a PDF or Word document."); return; }
    if (file.size > MAX_RESUME_BYTES) { setError("Resume must be under 1.5 MB."); return; }
    setError("");
    set((d) => ({ ...d, resumeFile: file, removeResume: false }));
  }
  const shown = draft.resumeFile ? { name: draft.resumeFile.name, size: draft.resumeFile.size } : draft.removeResume ? null : draft.existingResume;
  return <div className="field">
    <div className="label-row"><label>Resume</label><span className="optional-tag">Optional</span></div>
    {shown
      ? <div className="file-chip"><span><b>{shown.name}</b><small>{formatSize(shown.size)}{draft.resumeFile ? " · will upload on save" : ""}</small></span><button type="button" onClick={() => set((d) => ({ ...d, resumeFile: null, removeResume: true }))}>Remove</button></div>
      : <label className="file-drop"><input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={pick}/><span>Upload PDF or Word document</span><small>Up to 1.5 MB</small></label>}
    {error && <small className="error-text">{error}</small>}
  </div>;
}

export function ProfileFields({ role, draft, set, attempted }: { role: Role; draft: ProfileDraft; set: Setter; attempted: boolean }) {
  const upd = (p: Partial<ProfileDraft>) => set((d) => ({ ...d, ...p }));
  const badUrl = attempted && draft.portfolio.trim() !== "" && normalizeUrl(draft.portfolio) === null;
  const badGh = attempted && draftErrors({ ...draft, portfolio: "" }) !== null;
  if (role === "client") return <>
    <div className="field"><div className="label-row"><label>Company or organisation</label><span className="optional-tag">Optional</span></div><input value={draft.company} onChange={(e) => upd({ company: e.target.value })} placeholder="e.g. Northwind Labs" maxLength={140}/></div>
    <div className="field"><div className="label-row"><label>Company website</label><span className="optional-tag">Optional</span></div><input value={draft.portfolio} onChange={(e) => upd({ portfolio: e.target.value })} placeholder="https://yourcompany.com" className={badUrl ? "invalid" : ""}/>{badUrl && <small className="error-text">Enter a valid website address.</small>}</div>
    <div className="field"><div className="label-row"><label>What do you hire for?</label><span className="optional-tag">Optional</span></div><textarea value={draft.bio} onChange={(e) => upd({ bio: e.target.value })} placeholder="A sentence about the software work you typically need." maxLength={1000} className="short"/></div>
  </>;
  return <>
    <div className="field"><label>Professional headline</label><input value={draft.headline} onChange={(e) => upd({ headline: e.target.value })} placeholder="e.g. Backend engineer · TypeScript & Postgres" maxLength={120}/></div>
    <div className="field"><label>Skills</label><input value={draft.skills} onChange={(e) => upd({ skills: e.target.value })} placeholder="TypeScript, Node.js, PostgreSQL"/><small>Separate skills with commas. Clients can search by skill.</small></div>
    <div className="field"><div className="label-row"><label>GitHub username</label><span className="optional-tag">Optional</span></div><div className={`url-input ${badGh ? "invalid" : ""}`}><span className="prefix">github.com/</span><input value={draft.github} onChange={(e) => upd({ github: e.target.value })} placeholder="username"/></div>{badGh && <small className="error-text">Enter a valid GitHub username.</small>}</div>
    <div className="field"><div className="label-row"><label>About you</label><span className="optional-tag">Optional</span></div><textarea value={draft.bio} onChange={(e) => upd({ bio: e.target.value })} placeholder="Briefly describe your experience and the work you do best." maxLength={1000} className="short"/></div>
    <div className="field"><div className="label-row"><label>Portfolio website</label><span className="optional-tag">Optional</span></div><input value={draft.portfolio} onChange={(e) => upd({ portfolio: e.target.value })} placeholder="https://yourportfolio.dev" className={badUrl ? "invalid" : ""}/>{badUrl && <small className="error-text">Enter a valid website address.</small>}</div>
    <ResumeField draft={draft} set={set}/>
  </>;
}
