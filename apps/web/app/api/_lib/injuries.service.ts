import { apiFootballFetchJson } from "./apifootball";
import { createTtlCache } from "./cache";

const TEAM_LEADERS_TTL = 12 * 60 * 60 * 1000; // 12h
const leadersCache = createTtlCache<any>(TEAM_LEADERS_TTL);

type Leaders = {
  topScorer?: { playerId: number; name: string; goals: number };
  topAssister?: { playerId: number; name: string; assists: number };
  firstChoiceGK?: { playerId: number; name: string; minutes: number; appearances: number };
  // optional: store top defenders/attackers arrays if you want
};

function pickLeadersFromPlayersResponse(playersResp: any[]): Leaders {
  // API-Football players response typically: [{ player, statistics: [...] }]
  // We'll search across statistics arrays and use league/team matching implicitly.
  const rows = (playersResp ?? []).map((x) => {
    const p = x?.player;
    const st = (x?.statistics ?? [])[0] ?? {}; // first stat block (usually league-season)
    const goals = Number(st?.goals?.total ?? 0);
    const assists = Number(st?.goals?.assists ?? 0);
    const minutes = Number(st?.games?.minutes ?? 0);
    const apps = Number(st?.games?.appearences ?? st?.games?.appearances ?? 0);
    const pos = String(st?.games?.position ?? "");

    return {
      playerId: Number(p?.id),
      name: String(p?.name ?? ""),
      pos,
      goals,
      assists,
      minutes,
      apps,
    };
  }).filter(r => Number.isFinite(r.playerId) && r.name);

  const topScorer = rows.slice().sort((a,b)=> b.goals - a.goals)[0];
  const topAssister = rows.slice().sort((a,b)=> b.assists - a.assists)[0];

  // first-choice GK: position GK, sort by minutes then apps
  const gks = rows.filter(r => r.pos.toUpperCase() === "GOALKEEPER" || r.pos.toUpperCase() === "GK");
  const firstGK = gks.slice().sort((a,b)=> (b.minutes - a.minutes) || (b.apps - a.apps))[0];

  return {
    topScorer: topScorer?.goals ? { playerId: topScorer.playerId, name: topScorer.name, goals: topScorer.goals } : undefined,
    topAssister: topAssister?.assists ? { playerId: topAssister.playerId, name: topAssister.name, assists: topAssister.assists } : undefined,
    firstChoiceGK: firstGK?.minutes ? { playerId: firstGK.playerId, name: firstGK.name, minutes: firstGK.minutes, appearances: firstGK.apps } : undefined,
  };
}

export async function getTeamLeaders(opts: { teamId: number; season: number }): Promise<Leaders> {
  const key = `${opts.teamId}|${opts.season}`;
  const hit = leadersCache.get(key);
  if (hit) return hit;

  const { res, json } = await apiFootballFetchJson("/players", {
    team: opts.teamId,
    season: opts.season,
  });

  if (!res.ok) {
    // Don’t fail prediction. Just return empty.
    return {};
  }

  const leaders = pickLeadersFromPlayersResponse(json?.response ?? []);
  leadersCache.set(key, leaders);
  return leaders;
}

export async function getFixtureInjuries(fixtureId: number) {
  const { res, json } = await apiFootballFetchJson("/injuries", { fixture: fixtureId });
  if (!res.ok) return { available: false, response: [] as any[] };
  return { available: true, response: json?.response ?? [] };
}
