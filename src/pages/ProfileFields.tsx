import { useRef, type ChangeEvent } from "react";
import { backend } from "../lib/backend";
import { errorText, formatSize, normalizeUrl } from "../lib/format";
import { scanResume } from "../lib/resumeText";
import type { Profile, ProfileInput, ResumeChange, ResumeRef, Role } from "../lib/types";
import { Icon, Spinner } from "../ui";
import { SkillPicker } from "./SkillPicker";

export const MAX_RESUME_BYTES = 1_572_864;

type Scan = { state: "idle" | "working" | "done" | "failed"; message: string; words: number; ocr: boolean };

export type ProfileDraft = {
  company: string;
  headline: string;
  bio: string;
  skills: string[];
  portfolio: string;
  github: string;
  paypal: string;
  existingResume: ResumeRef | null;
  /** Words already indexed for the saved resume (0 = not searchable yet). */
  existingWords: number;
  resumeFile: File | null;
  removeResume: boolean;
  /** Text read from a new or re-scanned resume. undefined = nothing new to save. */
  resumeText: string | undefined;
  scan: Scan;
};

const IDLE: Scan = { state: "idle", message: "", words: 0, ocr: false };
const countWords = (t: string) => (t.match(/[\p{L}\p{N}]{2,}/gu) ?? []).length;

export function draftFrom(p?: Profile): ProfileDraft {
  return {
    company: p?.company ?? "", headline: p?.headline ?? "", bio: p?.bio ?? "", skills: p?.skills ?? [],
    portfolio: p?.portfolioUrl ?? "", github: p?.githubUsername ?? "", paypal: p?.paypalEmail ?? "",
    existingResume: p?.resume ?? null, existingWords: countWords(p?.resumeText ?? ""),
    resumeFile: null, removeResume: false, resumeText: undefined, scan: IDLE,
  };
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const GITHUB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** What is wrong with the GitHub username, or null. Freelancers must have one. */
export function githubError(d: ProfileDraft, role: Role): string | null {
  const gh = d.github.trim().replace(/^@/, "");
  if (!gh) return role === "freelancer" ? "Enter your GitHub username. It's required." : null;
  return GITHUB_NAME.test(gh) ? null : "Enter a valid GitHub username (letters, numbers and hyphens).";
}

/** What is wrong with the PayPal email, or null. Freelancers must have one so they can be paid. */
export function paypalError(d: ProfileDraft, role: Role): string | null {
  const pp = d.paypal.trim();
  if (!pp) return role === "freelancer" ? "Enter your PayPal email. It's required to get paid." : null;
  return EMAIL.test(pp) ? null : "Enter a valid PayPal email address.";
}

/** Clients must name their company or organisation. */
export function companyError(d: ProfileDraft, role: Role): string | null {
  return role === "client" && !d.company.trim() ? "Enter your company or organisation name. It's required." : null;
}

export function draftErrors(d: ProfileDraft, role: Role): string | null {
  if (d.portfolio.trim() && normalizeUrl(d.portfolio) === null) return "Enter a valid website address.";
  return companyError(d, role) ?? githubError(d, role) ?? paypalError(d, role);
}

export function draftToInput(fullName: string, d: ProfileDraft): ProfileInput {
  return {
    fullName: fullName.trim(), company: d.company.trim(), headline: d.headline.trim(), bio: d.bio.trim(),
    skills: d.skills, portfolioUrl: normalizeUrl(d.portfolio) ?? "", githubUsername: d.github.trim().replace(/^@/, ""),
    paypalEmail: d.paypal.trim().toLowerCase(),
  };
}

export function resumeChange(d: ProfileDraft): ResumeChange {
  if (d.resumeFile) return d.resumeFile;
  if (d.removeResume) return null;
  return undefined;
}

/** The text to store with the profile: undefined keeps what is already saved. */
export const resumeTextChange = (d: ProfileDraft): string | undefined => (d.removeResume ? "" : d.resumeText);

/** True while a resume is still being read, so forms can wait before saving. */
export const draftBusy = (d: ProfileDraft) => d.scan.state === "working";

type Setter = (fn: (d: ProfileDraft) => ProfileDraft) => void;

function ResumeField({ draft, set }: { draft: ProfileDraft; set: Setter }) {
  const job = useRef(0);

  async function run(source: Blob & { name?: string }, apply: (text: string) => Partial<ProfileDraft>) {
    const mine = ++job.current;
    set((d) => ({ ...d, scan: { state: "working", message: "Reading your resume", words: 0, ocr: false } }));
    try {
      const res = await scanResume(source, (message) => { if (job.current === mine) set((d) => ({ ...d, scan: { ...d.scan, state: "working", message } })); });
      if (job.current !== mine) return;
      if (res.method === "unsupported" || !res.text) {
        set((d) => ({ ...d, ...apply(""), scan: { state: "failed", message: res.method === "unsupported" ? "Old .doc files can't be read here. Save it as .docx or PDF to make it searchable." : "No text found in this file, so clients can't search inside it.", words: 0, ocr: false } }));
        return;
      }
      set((d) => ({ ...d, ...apply(res.text), scan: { state: "done", message: "", words: countWords(res.text), ocr: res.method === "ocr" } }));
    } catch (e) {
      if (job.current === mine) set((d) => ({ ...d, scan: { state: "failed", message: errorText(e), words: 0, ocr: false } }));
    }
  }

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/\.(pdf|docx?)$/i.test(file.name)) { set((d) => ({ ...d, scan: { state: "failed", message: "Upload a PDF or Word document.", words: 0, ocr: false } })); return; }
    if (file.size > MAX_RESUME_BYTES) { set((d) => ({ ...d, scan: { state: "failed", message: "Resume must be under 1.5 MB.", words: 0, ocr: false } })); return; }
    set((d) => ({ ...d, resumeFile: file, removeResume: false, resumeText: "" }));
    void run(file, (text) => ({ resumeText: text }));
  }

  async function reindex() {
    if (!draft.existingResume) return;
    const resume = draft.existingResume;
    try {
      const blob = await (await fetch(await backend.resumeUrl(resume))).blob();
      await run(Object.assign(blob, { name: resume.name }), (text) => ({ resumeText: text }));
    } catch (e) {
      set((d) => ({ ...d, scan: { state: "failed", message: errorText(e), words: 0, ocr: false } }));
    }
  }

  function remove() {
    job.current++;
    set((d) => ({ ...d, resumeFile: null, removeResume: true, resumeText: "", existingWords: 0, scan: IDLE }));
  }

  const shown = draft.resumeFile ? { name: draft.resumeFile.name, size: draft.resumeFile.size } : draft.removeResume ? null : draft.existingResume;
  const { scan } = draft;
  const searchable = !draft.resumeFile && !draft.removeResume && draft.existingWords > 0 && draft.resumeText === undefined;

  return <div className="field">
    <div className="label-row"><label>Resume</label><span className="optional-tag">Optional</span></div>
    {shown
      ? <div className="file-chip"><span><b>{shown.name}</b><small>{formatSize(shown.size)}{draft.resumeFile ? " · uploads when you save" : ""}</small></span><button type="button" onClick={remove}>Remove</button></div>
      : <label className="file-drop"><input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={pick}/><span>Upload PDF or Word document</span><small>Up to 1.5 MB</small></label>}
    {scan.state === "working" && <div className="scan-line"><Spinner dark/> {scan.message}…</div>}
    {scan.state === "done" && <div className="scan-line ok"><Icon name="check" size={13}/> Read {scan.words.toLocaleString()} words{scan.ocr ? " using OCR (it was a scanned document)" : ""}. Clients can now find you by keywords in your resume.</div>}
    {scan.state === "failed" && <div className="scan-line bad"><Icon name="alert" size={13}/> {scan.message}</div>}
    {scan.state === "idle" && searchable && <div className="scan-line ok"><Icon name="check" size={13}/> Searchable · {draft.existingWords.toLocaleString()} words indexed for client search.</div>}
    {scan.state === "idle" && shown && !draft.resumeFile && !draft.removeResume && draft.existingWords === 0 && draft.resumeText === undefined && (
      <div className="scan-line"><span>Clients can’t search inside this resume yet.</span> <button type="button" className="text-link inline" onClick={reindex}>Make it searchable</button></div>
    )}
  </div>;
}

export function ProfileFields({ role, draft, set, attempted }: { role: Role; draft: ProfileDraft; set: Setter; attempted: boolean }) {
  const upd = (p: Partial<ProfileDraft>) => set((d) => ({ ...d, ...p }));
  const badUrl = attempted && draft.portfolio.trim() !== "" && normalizeUrl(draft.portfolio) === null;
  const coErr = attempted ? companyError(draft, role) : null;
  const ghErr = attempted ? githubError(draft, role) : null;
  const ppErr = attempted ? paypalError(draft, role) : null;
  if (role === "client") return <>
    <div className="field"><div className="label-row"><label htmlFor="company-input">Company or organisation</label><span className="required-tag">Required</span></div><input id="company-input" value={draft.company} onChange={(e) => upd({ company: e.target.value })} placeholder="e.g. Northwind Labs" maxLength={140} className={coErr ? "invalid" : ""}/>{coErr ? <small className="error-text">{coErr}</small> : <small>Shown to freelancers on your projects. Working independently? Use your own name.</small>}</div>
    <div className="field"><div className="label-row"><label>Company website</label><span className="optional-tag">Optional</span></div><input value={draft.portfolio} onChange={(e) => upd({ portfolio: e.target.value })} placeholder="https://yourcompany.com" className={badUrl ? "invalid" : ""}/>{badUrl && <small className="error-text">Enter a valid website address.</small>}</div>
    <div className="field"><div className="label-row"><label>What do you hire for?</label><span className="optional-tag">Optional</span></div><textarea value={draft.bio} onChange={(e) => upd({ bio: e.target.value })} placeholder="A sentence about the software work you typically need." maxLength={1000} className="short"/></div>
  </>;
  return <>
    <div className="field"><label>Professional headline</label><input value={draft.headline} onChange={(e) => upd({ headline: e.target.value })} placeholder="e.g. Backend engineer · TypeScript & Postgres" maxLength={120}/></div>
    <div className="field"><label htmlFor="skills-input">Skills</label><SkillPicker id="skills-input" value={draft.skills} onChange={(skills) => upd({ skills })}/></div>
    <div className="field"><div className="label-row"><label htmlFor="github-input">GitHub username</label><span className="required-tag">Required</span></div><div className={`url-input ${ghErr ? "invalid" : ""}`}><span className="prefix">github.com/</span><input id="github-input" value={draft.github} onChange={(e) => upd({ github: e.target.value })} placeholder="username" autoComplete="off"/></div>{ghErr ? <small className="error-text">{ghErr}</small> : <small>Your milestone deliveries are checked on GitHub, and clients can see your profile. We check that the account exists.</small>}</div>
    <div className="field"><div className="label-row"><label>About you</label><span className="optional-tag">Optional</span></div><textarea value={draft.bio} onChange={(e) => upd({ bio: e.target.value })} placeholder="Briefly describe your experience and the work you do best." maxLength={1000} className="short"/></div>
    <div className="field"><div className="label-row"><label>Portfolio website</label><span className="optional-tag">Optional</span></div><input value={draft.portfolio} onChange={(e) => upd({ portfolio: e.target.value })} placeholder="https://yourportfolio.dev" className={badUrl ? "invalid" : ""}/>{badUrl && <small className="error-text">Enter a valid website address.</small>}</div>
    <div className="field"><div className="label-row"><label htmlFor="paypal-input">PayPal email for payouts</label><span className="required-tag">Required</span></div><input id="paypal-input" type="email" value={draft.paypal} onChange={(e) => upd({ paypal: e.target.value })} placeholder="you@example.com" className={ppErr ? "invalid" : ""}/>{ppErr ? <small className="error-text">{ppErr}</small> : <small>Approved milestone payments are sent here. For testing, use a PayPal Sandbox <b>personal</b> account email. It isn’t shown to anyone; only the payment server uses it.</small>}</div>
    <ResumeField draft={draft} set={set}/>
  </>;
}
