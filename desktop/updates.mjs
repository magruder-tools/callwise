export const RELEASES_URL =
  "https://api.github.com/repos/magruder-tools/callwise/releases/latest";
export function newerVersion(current, tag) {
  const parse = (v) =>
    /^v?\d+\.\d+\.\d+$/.test(v || "")
      ? v.replace(/^v/, "").split(".").map(Number)
      : null;
  const a = parse(current),
    b = parse(tag);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (b[i] !== a[i]) return b[i] > a[i];
  }
  return false;
}
export function releaseLink(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      u.hostname === "github.com" &&
      !u.username &&
      !u.password &&
      !u.port &&
      u.pathname.startsWith("/magruder-tools/callwise/releases/")
      ? u.href
      : "";
  } catch {
    return "";
  }
}
export async function checkForUpdate(version, { fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      await r.body?.cancel();
      return null;
    }
    const d = await r.json();
    const url = releaseLink(d.html_url);
    return !d.draft && !d.prerelease && url && newerVersion(version, d.tag_name)
      ? { version: d.tag_name, url }
      : null;
  } catch {
    return null;
  }
}
