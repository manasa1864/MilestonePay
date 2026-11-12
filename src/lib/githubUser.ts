/**
 * Checks that a GitHub username really exists, so a typo can't be saved as someone's account.
 * Returns true (exists), false (no such user) or null (couldn't tell: offline or rate limited).
 * Callers should only block on `false`.
 */
export async function githubUserExists(username: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, { headers: { Accept: "application/vnd.github+json" } });
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}
