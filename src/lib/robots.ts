export const USER_AGENT = "ukvisa-jobs/0.1 (personal job board; respects robots.txt)";

/**
 * Minimal robots.txt check for the `User-agent: *` group. Longest matching
 * rule wins, as the spec requires; a missing file is not a disallow.
 */
export async function robotsAllows(host: string, path: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${host}/robots.txt`, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return true;
    const text = await res.text();

    let inStarGroup = false;
    let best: { allow: boolean; length: number } = { allow: true, length: 0 };

    for (const rawLine of text.split("\n")) {
      const line = rawLine.split("#")[0].trim();
      if (!line) continue;
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(":").trim();

      if (key === "user-agent") {
        inStarGroup = value === "*";
        continue;
      }
      if (!inStarGroup || !value) continue;
      if (key !== "allow" && key !== "disallow") continue;

      if (path.startsWith(value) && value.length > best.length) {
        best = { allow: key === "allow", length: value.length };
      }
    }
    return best.allow;
  } catch {
    return true;
  }
}
