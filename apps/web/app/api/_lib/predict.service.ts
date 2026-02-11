import { predictFootballMarketsEloPoisson, type TeamMatch } from "@predictor/core";
import { apiFootballFetchJson } from "./apifootball";
import { getFixtureInjuries, getTeamLeaders } from "./injuries.service";
import { buildInjuryFlags } from "./injuryFlags";
import { NextResponse } from "next/server";


const r3 = (n: number) => Math.round(n * 1000) / 1000;

const impliedFromOdds = (odds: number[]) => {
  const inv = odds.map((o) => 1 / o);
  const sum = inv.reduce((a, b) => a + b, 0);
  return inv.map((x) => x / sum);
};

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

const marketWeight = (market: string) => {
  const m = String(market).toLowerCase();
  if (m === "1x2") return 1.0;
  if (m === "ou25") return 0.9;
  if (m === "btts") return 0.85;
  return 0.85;
};

const variancePenalty = (odds: number) => 1 / Math.sqrt(Math.max(1, odds));

const normalizedScore = (market: string, modelProb: number, odds: number) => {
  // EV per unit stake
  const ev = modelProb * odds - 1;

  // Stabilize and weight
  const score =
    clamp(ev, -0.25, 0.5) *
    variancePenalty(odds) *
    marketWeight(market);

  return r3(score);
};

function pickBookmakerBet365(bookmakers: any[]) {
  const bet365 = bookmakers.find(
    (b: any) => String(b?.name ?? "").trim().toLowerCase() === "bet365"
  );
  return bet365 ?? null;
}


export async function predictFixture(opts: { fixtureId: number; minEdge: number }) {
  const { fixtureId, minEdge } = opts;

  // 1) Fetch fixture (teams + season)
  const { res: fxRes, json: fxJson } = await apiFootballFetchJson("/fixtures", {
    id: fixtureId,
    timezone: "Europe/Sofia",
  });

  if (!fxRes.ok) {
    const err: any = new Error("API-Football fixtures request failed");
    err.status = fxRes.status;
    err.body = fxJson;
    throw err;
  }

  const f = fxJson?.response?.[0];
  const homeTeam = f?.teams?.home?.name;
  const awayTeam = f?.teams?.away?.name;
  const homeId = f?.teams?.home?.id;
  const awayId = f?.teams?.away?.id;
  const season = f?.league?.season;

  if (!homeTeam || !awayTeam || !homeId || !awayId || !season) {
    throw new Error("Missing fixture teams/ids/season");
  }

  // 2) Fetch recent matches for each team
  async function fetchRecent(teamId: number): Promise<TeamMatch[]> {
    const { res, json } = await apiFootballFetchJson("/fixtures", {
      team: teamId,
      season,
      last: 20,
      status: "FT",
      timezone: "Europe/Sofia",
    });

    if (!res.ok) throw new Error(`recent fixtures error ${res.status}`);

    return (json?.response ?? []).map((m: any) => {
      const isHome = m?.teams?.home?.id === teamId;
      const gf = isHome ? m?.goals?.home : m?.goals?.away;
      const ga = isHome ? m?.goals?.away : m?.goals?.home;
      return { goalsFor: Number(gf ?? 0), goalsAgainst: Number(ga ?? 0), isHome, dateISO: m?.fixture?.date };
    });
  }

  const [homeRecent, awayRecent] = await Promise.all([fetchRecent(homeId), fetchRecent(awayId)]);

  const modelOut = predictFootballMarketsEloPoisson({ homeRecent, awayRecent });

  // Injuries + leaders (explainability only)
const inj = await getFixtureInjuries(fixtureId);

// Build "outPlayers" per team from injuries response
const homeOut = (inj.response ?? [])
  .filter((x: any) => Number(x?.team?.id) === homeId)
  .map((x: any) => ({
    playerId: Number(x?.player?.id),
    name: String(x?.player?.name ?? ""),
    position: String(x?.player?.position ?? ""), // may be missing depending on API
  }))
  .filter((p: any) => Number.isFinite(p.playerId) && p.name);

const awayOut = (inj.response ?? [])
  .filter((x: any) => Number(x?.team?.id) === awayId)
  .map((x: any) => ({
    playerId: Number(x?.player?.id),
    name: String(x?.player?.name ?? ""),
    position: String(x?.player?.position ?? ""),
  }))
  .filter((p: any) => Number.isFinite(p.playerId) && p.name);

// Leaders cached per team+season
const [homeLeaders, awayLeaders] = await Promise.all([
  getTeamLeaders({ teamId: homeId, season }),
  getTeamLeaders({ teamId: awayId, season }),
]);

const injuriesBlock = {
  available: inj.available,
  home: {
    teamId: homeId,
    teamName: homeTeam,
    outCount: homeOut.length,
    flags: buildInjuryFlags({ teamId: homeId, teamName: homeTeam, outPlayers: homeOut, leaders: homeLeaders }),
    outPlayers: homeOut,
  },
  away: {
    teamId: awayId,
    teamName: awayTeam,
    outCount: awayOut.length,
    flags: buildInjuryFlags({ teamId: awayId, teamName: awayTeam, outPlayers: awayOut, leaders: awayLeaders }),
    outPlayers: awayOut,
  },
};

if (process.env.NODE_ENV !== "production") {
  console.log("[injuries]", fixtureId, {
    available: injuriesBlock.available,
    homeOut: injuriesBlock.home.outCount,
    awayOut: injuriesBlock.away.outCount,
    homeFlags: injuriesBlock.home.flags.map((f: any) => f.code),
    awayFlags: injuriesBlock.away.flags.map((f: any) => f.code),
  });
}


  // Base response always includes model markets
  const base = {
    fixtureId,
    homeTeam,
    awayTeam,
    injuries: injuriesBlock,
    modelInfo: {
      name: "elo+poisson",
      homeElo: r3(modelOut.homeElo),
      awayElo: r3(modelOut.awayElo),
      lambdaHome: r3(modelOut.lambdaHome),
      lambdaAway: r3(modelOut.lambdaAway),
    },
    markets: {
      "1x2": {
        home: r3(modelOut.markets["1x2"].home),
        draw: r3(modelOut.markets["1x2"].draw),
        away: r3(modelOut.markets["1x2"].away),
      },
      btts: {
        yes: r3(modelOut.markets.btts.yes),
        no: r3(modelOut.markets.btts.no),
      },
      ou25: {
        over: r3(modelOut.markets.ou25.over),
        under: r3(modelOut.markets.ou25.under),
      },
      draw: { draw: r3(modelOut.markets["1x2"].draw) },
    },
  };

  // 3) Odds
  const { res: oddsRes, json: oddsJson } = await apiFootballFetchJson("/odds", {
    fixture: fixtureId,
  });

  if (!oddsRes.ok) {
    return {
      ...base,
      oddsAvailable: false,
      note: "Odds not available on this plan (model-only).",
      oddsError: { status: oddsRes.status, body: oddsJson },
    };
  }

  const resp = oddsJson?.response ?? [];
  const bkAll = resp.flatMap((x: any) => x?.bookmakers ?? []);
const pick = pickBookmakerBet365(bkAll);

if (!pick) {
  return NextResponse.json({
    ...base,
    oddsAvailable: false,
    note: "Bet365 odds not available for this fixture.",
    bookmaker: null,
  });
}

  if (!pick) {
    return { ...base, oddsAvailable: false, note: "No bookmakers found." };
  }

  const getMarketOdds = (marketName: string) => {
    const bet = (pick?.bets ?? []).find((b: any) => String(b?.name ?? "").toLowerCase() === marketName.toLowerCase());
    if (!bet) return null;
    const values: Record<string, number> = {};
    for (const v of bet?.values ?? []) {
      const label = String(v?.value ?? "");
      const odd = Number(v?.odd);
      if (label && Number.isFinite(odd)) values[label] = odd;
    }
    return values;
  };

  const m1x2 = getMarketOdds("Match Winner") ?? getMarketOdds("Winner") ?? getMarketOdds("1X2");
  const mBtts = getMarketOdds("Both Teams Score") ?? getMarketOdds("BTTS");
  const mOU = getMarketOdds("Goals Over/Under") ?? getMarketOdds("Over/Under");

  const odds1 = m1x2?.["Home"] ?? m1x2?.["1"];
  const oddsX = m1x2?.["Draw"] ?? m1x2?.["X"];
  const odds2 = m1x2?.["Away"] ?? m1x2?.["2"];

  const oddsOver25 = mOU?.["Over 2.5"];
  const oddsUnder25 = mOU?.["Under 2.5"];

  const oddsYes = mBtts?.["Yes"];
  const oddsNo = mBtts?.["No"];

  const top: any[] = [];

  if (odds1 && oddsX && odds2) {
    const [p1, pX, p2] = impliedFromOdds([odds1, oddsX, odds2]);
    const e1 = modelOut.markets["1x2"].home - p1;
    const eX = modelOut.markets["1x2"].draw - pX;
    const e2 = modelOut.markets["1x2"].away - p2;

    top.push({ market: "1x2", selection: "home", odds: odds1, modelProb: r3(modelOut.markets["1x2"].home), impliedProb: r3(p1), edge: r3(e1), value: e1 >= minEdge, score: normalizedScore("1x2", modelOut.markets["1x2"].home, odds1), });
    top.push({ market: "1x2", selection: "draw", odds: oddsX, modelProb: r3(modelOut.markets["1x2"].draw), impliedProb: r3(pX), edge: r3(eX), value: eX >= minEdge, score: normalizedScore("1x2", modelOut.markets["1x2"].draw, oddsX), });
    
    top.push({ market: "1x2", selection: "away", odds: odds2, modelProb: r3(modelOut.markets["1x2"].away), impliedProb: r3(p2), edge: r3(e2), value: e2 >= minEdge, score: normalizedScore("1x2", modelOut.markets["1x2"].away, odds2), });
  }

  if (oddsOver25 && oddsUnder25) {
    const [pO, pU] = impliedFromOdds([oddsOver25, oddsUnder25]);
    const eO = modelOut.markets.ou25.over - pO;
    const eU = modelOut.markets.ou25.under - pU;

    top.push({ market: "ou25", selection: "over", odds: oddsOver25, modelProb: r3(modelOut.markets.ou25.over), impliedProb: r3(pO), edge: r3(eO), value: eO >= minEdge, score: normalizedScore("ou25", modelOut.markets.ou25.over, oddsOver25), });
    top.push({ market: "ou25", selection: "under", odds: oddsUnder25, modelProb: r3(modelOut.markets.ou25.under), impliedProb: r3(pU), edge: r3(eU), value: eU >= minEdge, score: normalizedScore("ou25", modelOut.markets.ou25.under, oddsUnder25), });
  }

  if (oddsYes && oddsNo) {
    const [pY, pN] = impliedFromOdds([oddsYes, oddsNo]);
    const eY = modelOut.markets.btts.yes - pY;
    const eN = modelOut.markets.btts.no - pN;

    top.push({ market: "btts", selection: "yes", odds: oddsYes, modelProb: r3(modelOut.markets.btts.yes), impliedProb: r3(pY), edge: r3(eY), value: eY >= minEdge, score: normalizedScore("btts", modelOut.markets.btts.yes, oddsYes), });
    top.push({ market: "btts", selection: "no", odds: oddsNo, modelProb: r3(modelOut.markets.btts.no), impliedProb: r3(pN), edge: r3(eN), value: eN >= minEdge, score: normalizedScore("btts", modelOut.markets.btts.no, oddsNo), });
  }

  top.sort((a, b) => (b.score ?? b.edge) - (a.score ?? a.edge));

  return {
    ...base,
    oddsAvailable: true,
    bookmaker: { id: pick?.id, name: pick?.name },
    top: top.slice(0, 6),
  };
}
