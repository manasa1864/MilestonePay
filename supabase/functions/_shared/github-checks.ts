/**
 * Deterministic milestone checks against the GitHub REST API.
 *
 * Shared by the browser (src/lib/github.ts, no token, ~60 requests/hour per IP)
 * and the `github-verify` Edge Function (with a GITHUB_TOKEN secret, 5,000/hour,
 * and access to any private repo the token owner can read).
 *
 * Keep this file free of browser-only, Node-only and Deno-only APIs.
 */

export type CheckCriterion = { id: string; type: string; description: string; config: { path?: string } };
export type RepoRef = { owner: string; repo: string };
export type CheckResult = { criterionId: string; passed: boolean; evidence: string };
export type VerifyOutcome = { commitSha: string; defaultBranch: string; htmlUrl: string; results: CheckResult[] };
export type VerifyOptions = { token?: string; fetchImpl?: typeof fetch; onProgress?: (message: string) => void };

const API = "https://api.github.com";

export function parseRepoUrl(url: string): RepoRef | null {
  const m = url.trim().match(/^https:\/\/github\.com\/([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+?)(?:\.git)?\/?(?:[#?].*)?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function client(opts: VerifyOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  return async function gh<T>(path: string): Promise<{ status: number; data: T | null }> {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const res = await doFetch(`${API}${path}`, { headers });
    if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const at = reset ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString()}.` : "";
      throw new Error(`GitHub rate limit reached.${at}`);
    }
    if (res.status === 401) throw new Error("GitHub rejected the server's token. Check the GITHUB_TOKEN secret.");
    if (!res.ok) return { status: res.status, data: null };
    return { status: res.status, data: (await res.json()) as T };
  };
}

type Gh = ReturnType<typeof client>;
type CheckRun = { name: string; status: string; conclusion: string | null };

async function checkCi(gh: Gh, r: RepoRef, sha: string): Promise<Omit<CheckResult, "criterionId">> {
  const runs = await gh<{ total_count: number; check_runs: CheckRun[] }>(`/repos/${r.owner}/${r.repo}/commits/${sha}/check-runs?per_page=100`);
  const list = runs.data?.check_runs ?? [];
  if (list.length) {
    const ok = new Set(["success", "neutral", "skipped"]);
    const bad = list.filter((c) => c.status !== "completed" || !ok.has(c.conclusion ?? ""));
    if (!bad.length) return { passed: true, evidence: `All ${list.length} GitHub check run${list.length === 1 ? "" : "s"} passed on ${sha.slice(0, 7)}.` };
    const names = bad.slice(0, 4).map((c) => `${c.name} (${c.status === "completed" ? c.conclusion : c.status})`).join(", ");
    return { passed: false, evidence: `${bad.length} of ${list.length} check runs did not pass: ${names}.` };
  }
  const status = await gh<{ state: string; total_count: number }>(`/repos/${r.owner}/${r.repo}/commits/${sha}/status`);
  if (status.data && status.data.total_count > 0) {
    return status.data.state === "success"
      ? { passed: true, evidence: `Combined commit status is "success" across ${status.data.total_count} checks.` }
      : { passed: false, evidence: `Combined commit status is "${status.data.state}".` };
  }
  return { passed: false, evidence: `No CI checks were reported for commit ${sha.slice(0, 7)}. Add a GitHub Actions workflow.` };
}

async function checkFile(gh: Gh, r: RepoRef, sha: string, path: string | undefined): Promise<Omit<CheckResult, "criterionId">> {
  const p = (path ?? "").trim().replace(/^\/+/, "");
  if (!p) return { passed: false, evidence: "No file path was configured for this criterion." };
  const encoded = p.split("/").map(encodeURIComponent).join("/");
  const res = await gh<unknown>(`/repos/${r.owner}/${r.repo}/contents/${encoded}?ref=${sha}`);
  return res.status === 200
    ? { passed: true, evidence: `Found ${p} at commit ${sha.slice(0, 7)}.` }
    : { passed: false, evidence: `${p} does not exist at commit ${sha.slice(0, 7)}.` };
}

type Pull = { number: number; title: string; merged_at: string | null };

async function checkPr(gh: Gh, r: RepoRef, branch: string): Promise<Omit<CheckResult, "criterionId">> {
  const res = await gh<Pull[]>(`/repos/${r.owner}/${r.repo}/pulls?state=closed&base=${encodeURIComponent(branch)}&sort=updated&direction=desc&per_page=50`);
  const merged = (res.data ?? []).filter((p) => p.merged_at);
  if (!merged.length) return { passed: false, evidence: `No merged pull requests into ${branch} were found.` };
  const p = merged[0];
  return { passed: true, evidence: `${merged.length} merged pull request${merged.length === 1 ? "" : "s"} into ${branch}; latest is #${p.number} "${p.title}" (${new Date(p.merged_at!).toISOString().slice(0, 10)}).` };
}

export async function verifyRepository(repoUrl: string, criteria: CheckCriterion[], opts: VerifyOptions = {}): Promise<VerifyOutcome> {
  const ref = parseRepoUrl(repoUrl);
  if (!ref) throw new Error("Enter a repository URL like https://github.com/owner/repo");
  const gh = client(opts);
  opts.onProgress?.("Looking up repository");
  const repo = await gh<{ default_branch: string; html_url: string }>(`/repos/${ref.owner}/${ref.repo}`);
  if (!repo.data) {
    if (repo.status === 404) {
      throw new Error(opts.token
        ? "Repository not found. If it is private, add the token owner's GitHub account as a collaborator."
        : "Repository not found. It must exist and be public.");
    }
    throw new Error(`GitHub returned ${repo.status}.`);
  }
  const branch = repo.data.default_branch;
  opts.onProgress?.(`Reading latest commit on ${branch}`);
  const commit = await gh<{ sha: string }>(`/repos/${ref.owner}/${ref.repo}/commits/${encodeURIComponent(branch)}`);
  if (!commit.data) throw new Error(`Could not read the latest commit on ${branch}. Is the repository empty?`);
  const sha = commit.data.sha;

  const results: CheckResult[] = [];
  for (const c of criteria) {
    if (c.type === "MANUAL_REVIEW") continue;
    opts.onProgress?.(`Checking: ${c.description}`);
    try {
      const r = c.type === "CI_PASSES" ? await checkCi(gh, ref, sha)
        : c.type === "FILE_EXISTS" ? await checkFile(gh, ref, sha, c.config?.path)
        : c.type === "PR_MERGED" ? await checkPr(gh, ref, branch)
        : { passed: false, evidence: `Unknown criterion type ${c.type}.` };
      results.push({ criterionId: c.id, ...r });
    } catch (e) {
      if (e instanceof Error && (e.message.startsWith("GitHub rate limit") || e.message.startsWith("GitHub rejected"))) throw e;
      results.push({ criterionId: c.id, passed: false, evidence: `Check could not run: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return { commitSha: sha, defaultBranch: branch, htmlUrl: repo.data.html_url, results };
}
