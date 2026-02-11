export const APIFOOTBALL_BASE = "https://v3.football.api-sports.io";

export function getApiKeyOrThrow() {
  const key = process.env.APIFOOTBALL_API_KEY;
  if (!key) throw new Error("Missing APIFOOTBALL_API_KEY in apps/web/.env.local");
  return key;
}

export async function apiFootballFetchJson(
  pathOrUrl: string | URL,
  params?: Record<string, string | number | undefined>,
  timezone = "Europe/Sofia"
) {
  const key = getApiKeyOrThrow();

  const url =
    typeof pathOrUrl === "string"
      ? new URL(pathOrUrl.startsWith("http") ? pathOrUrl : `${APIFOOTBALL_BASE}${pathOrUrl}`)
      : new URL(pathOrUrl.toString());

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  // you always set timezone in your code; keep it centralized
  if (!url.searchParams.get("timezone")) url.searchParams.set("timezone", timezone);

  const res = await fetch(url.toString(), {
    headers: { "x-apisports-key": key },
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);
  return { res, json };
}
