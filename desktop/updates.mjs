export const RELEASES_URL =
  "https://api.github.com/repos/magruder-tools/callwise/releases/latest";
export const PREVIEW_RELEASES_URL =
  "https://api.github.com/repos/magruder-tools/callwise/releases?per_page=100";

export function parseReleaseVersion(value) {
  if (typeof value !== "string") return null;
  const match =
    /^(?:v|callwise-)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:alpha|beta|rc|preview)(?:\.(?:0|[1-9]\d*))*))?$/.exec(
      value,
    );
  if (!match) return null;
  const numbers = match.slice(1, 4).map(Number);
  if (!numbers.every(Number.isSafeInteger)) return null;
  const prerelease = match[4]?.split(".") || [];
  if (prerelease.slice(1).some((v) => !Number.isSafeInteger(Number(v))))
    return null;
  return {
    numbers,
    prerelease,
    display: `${numbers.join(".")}${match[4] ? ` ${match[4]}` : ""}`,
  };
}
function compare(a, b) {
  for (let i = 0; i < 3; i++)
    if (a.numbers[i] !== b.numbers[i])
      return Math.sign(a.numbers[i] - b.numbers[i]);
  if (!a.prerelease.length || !b.prerelease.length)
    return a.prerelease.length ? -1 : b.prerelease.length ? 1 : 0;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i],
      y = b.prerelease[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x !== y) {
      if (/^\d+$/.test(x) && /^\d+$/.test(y))
        return Math.sign(Number(x) - Number(y));
      if (/^\d+$/.test(x) !== /^\d+$/.test(y)) return /^\d+$/.test(x) ? -1 : 1;
      return x < y ? -1 : 1;
    }
  }
  return 0;
}
export function newerVersion(current, tag, { includePreview = false } = {}) {
  const a = parseReleaseVersion(current),
    b = parseReleaseVersion(tag);
  return !!(
    a &&
    b &&
    (includePreview || !b.prerelease.length) &&
    compare(b, a) > 0
  );
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
export async function checkForUpdate(
  version,
  { fetchImpl = fetch, includePreview = false } = {},
) {
  try {
    const r = await fetchImpl(
      includePreview ? PREVIEW_RELEASES_URL : RELEASES_URL,
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!r.ok) {
      await r.body?.cancel();
      return null;
    }
    const data = await r.json();
    const releases = (Array.isArray(data) ? data : [data]).filter((d) => {
      const parsed = parseReleaseVersion(d?.tag_name);
      return (
        parsed &&
        !d.draft &&
        (includePreview || (!d.prerelease && !parsed.prerelease.length)) &&
        releaseLink(d.html_url) &&
        newerVersion(version, d.tag_name, { includePreview })
      );
    });
    releases.sort((a, b) =>
      compare(parseReleaseVersion(b.tag_name), parseReleaseVersion(a.tag_name)),
    );
    const best = releases[0];
    return best
      ? {
          version: best.tag_name,
          displayVersion: parseReleaseVersion(best.tag_name).display,
          url: releaseLink(best.html_url),
          preview:
            !!best.prerelease ||
            parseReleaseVersion(best.tag_name).prerelease.length > 0,
        }
      : null;
  } catch {
    return null;
  }
}
