import { LEAGUES, type LeagueKey } from "../../../src/lib/leagues";
import { apiFootballFetchJson } from "./apifootball";
import { createTtlCache } from "./cache";

const CACHE_TTL_MS = 60_000;
const fixturesCache = createTtlCache<any>(CACHE_TTL_MS);

export async function getFixtures(opts: {
  leagueKey: LeagueKey;
  season: number;
  from: string;
  to: string;
}) {
  const { leagueKey, season, from, to } = opts;

  const cacheKey = `${leagueKey}|${season}|${from}|${to}`;
  const hit = fixturesCache.get(cacheKey);
  if (hit) return { ...hit, cached: true };

  const league = LEAGUES[leagueKey]; // ✅ fully typed
  if (!league) {
    // realistically unreachable, but safe
    throw new Error(`Unknown leagueKey: ${leagueKey}`);
  }

  const { res, json } = await apiFootballFetchJson("/fixtures", {
    league: league.id,
    season,
    from,
    to,
    timezone: "Europe/Sofia",
  });

  if (!res.ok) {
    const err: any = new Error("API-Football request failed");
    err.status = res.status;
    err.body = json;
    throw err;
  }

  const fixtures = (json?.response ?? []).map((f: any) => ({
    fixtureId: f?.fixture?.id,
    date: f?.fixture?.date,
    status: f?.fixture?.status?.short,
    league: f?.league?.name,
    round: f?.league?.round,
    home: f?.teams?.home?.name,
    away: f?.teams?.away?.name,
  }));

  const payload = { count: fixtures.length, fixtures, cached: false };
  fixturesCache.set(cacheKey, payload);

  return payload;
}
