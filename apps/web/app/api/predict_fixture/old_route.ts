import { NextResponse } from "next/server";
import { z } from "zod";
import { predictFootballMarketsEloPoisson, type TeamMatch } from "@predictor/core";

const InputSchema = z.object({
  fixtureId: z.coerce.number().int().positive(),
  minEdge: z.coerce.number().min(0).max(0.5).default(0.05),
});

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const impliedFromOdds = (odds: number[]) => {
  const inv = odds.map((o) => 1 / o);
  const sum = inv.reduce((a, b) => a + b, 0);
  return inv.map((x) => x / sum);
};

export async function GET(req: Request) {
  const key = process.env.APIFOOTBALL_API_KEY;
  if (!key) return NextResponse.json({ error: "Missing APIFOOTBALL_API_KEY in apps/web/.env.local" }, { status: 500 });

  const url = new URL(req.url);
  const parsed = InputSchema.safeParse({
    fixtureId: url.searchParams.get("fixtureId"),
    minEdge: url.searchParams.get("minEdge"),
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { fixtureId, minEdge } = parsed.data;

  // 1) Fetch fixture (teams + season)
  const fxUrl = new URL("https://v3.football.api-sports.io/fixtures");
  fxUrl.searchParams.set("id", String(fixtureId));
  fxUrl.searchParams.set("timezone", "Europe/Sofia");

  const fxRes = await fetch(fxUrl, { headers: { "x-apisports-key": key }, cache: "no-store" });
  const fxJson = await fxRes.json().catch(() => null);
  if (!fxRes.ok) return NextResponse.json({ error: fxJson }, { status: fxRes.status });

  const f = fxJson?.response?.[0];
  const homeTeam = f?.teams?.home?.name;
  const awayTeam = f?.teams?.away?.name;
  const homeId = f?.teams?.home?.id;
  const awayId = f?.teams?.away?.id;
  const season = f?.league?.season;

  if (!homeTeam || !awayTeam || !homeId || !awayId || !season) {
    return NextResponse.json({ error: "Missing fixture teams/ids/season" }, { status: 500 });
  }

  // 2) Fetch recent matches for each team
  async function fetchRecent(teamId: number): Promise<TeamMatch[]> {
    const u = new URL("https://v3.football.api-sports.io/fixtures");
    u.searchParams.set("team", String(teamId));
    u.searchParams.set("season", String(season));
    u.searchParams.set("last", "20");
    u.searchParams.set("status", "FT");
    u.searchParams.set("timezone", "Europe/Sofia");

    const rr = await fetch(u, { headers: { "x-apisports-key": key }, cache: "no-store" });
    const jj = await rr.json().catch(() => null);
    if (!rr.ok) throw new Error(`recent fixtures error ${rr.status}`);

    return (jj?.response ?? []).map((m: any) => {
      const isHome = m?.teams?.home?.id === teamId;
      const gf = isHome ? m?.goals?.home : m?.goals?.away;
      const ga = isHome ? m?.goals?.away : m?.goals?.home;
      return { goalsFor: Number(gf ?? 0), goalsAgainst: Number(ga ?? 0), isHome, dateISO: m?.fixture?.date };
    });
  }

  const [homeRecent, awayRecent] = await Promise.all([fetchRecent(homeId), fetchRecent(awayId)]);

  const modelOut = predictFootballMarketsEloPoisson({ homeRecent, awayRecent });

  // Base response always includes model markets
  const base = {
    fixtureId,
    homeTeam,
    awayTeam,
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
    },
  };

  // 3) Try odds (if your plan supports it). If not, return model-only.
  const oddsUrl = new URL("https://v3.football.api-sports.io/odds");
  oddsUrl.searchParams.set("fixture", String(fixtureId));

  const oddsRes = await fetch(oddsUrl, { headers: { "x-apisports-key": key }, cache: "no-store" });
  const oddsJson = await oddsRes.json().catch(() => null);

  if (!oddsRes.ok) {
    return NextResponse.json({
      ...base,
      oddsAvailable: false,
      note: "Odds not available on this plan (model-only).",
      oddsError: { status: oddsRes.status, body: oddsJson },
    });
  }

  const resp = oddsJson?.response ?? [];
  const bkAll = resp.flatMap((x: any) => x?.bookmakers ?? []);
  const pick = bkAll[0];
  if (!pick) return NextResponse.json({ ...base, oddsAvailable: false, note: "No bookmakers found." });

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

    top.push({ market: "1x2", selection: "home", odds: odds1, modelProb: r3(modelOut.markets["1x2"].home), impliedProb: r3(p1), edge: r3(e1), value: e1 >= minEdge });
    top.push({ market: "1x2", selection: "draw", odds: oddsX, modelProb: r3(modelOut.markets["1x2"].draw), impliedProb: r3(pX), edge: r3(eX), value: eX >= minEdge });
    top.push({ market: "1x2", selection: "away", odds: odds2, modelProb: r3(modelOut.markets["1x2"].away), impliedProb: r3(p2), edge: r3(e2), value: e2 >= minEdge });
  }

  if (oddsOver25 && oddsUnder25) {
    const [pO, pU] = impliedFromOdds([oddsOver25, oddsUnder25]);
    const eO = modelOut.markets.ou25.over - pO;
    const eU = modelOut.markets.ou25.under - pU;

    top.push({ market: "ou25", selection: "over", odds: oddsOver25, modelProb: r3(modelOut.markets.ou25.over), impliedProb: r3(pO), edge: r3(eO), value: eO >= minEdge });
    top.push({ market: "ou25", selection: "under", odds: oddsUnder25, modelProb: r3(modelOut.markets.ou25.under), impliedProb: r3(pU), edge: r3(eU), value: eU >= minEdge });
  }

  if (oddsYes && oddsNo) {
    const [pY, pN] = impliedFromOdds([oddsYes, oddsNo]);
    const eY = modelOut.markets.btts.yes - pY;
    const eN = modelOut.markets.btts.no - pN;

    top.push({ market: "btts", selection: "yes", odds: oddsYes, modelProb: r3(modelOut.markets.btts.yes), impliedProb: r3(pY), edge: r3(eY), value: eY >= minEdge });
    top.push({ market: "btts", selection: "no", odds: oddsNo, modelProb: r3(modelOut.markets.btts.no), impliedProb: r3(pN), edge: r3(eN), value: eN >= minEdge });
  }

  top.sort((a, b) => b.edge - a.edge);

  return NextResponse.json({
    ...base,
    oddsAvailable: true,
    bookmaker: { id: pick?.id, name: pick?.name },
    top: top.slice(0, 6),
  });
}
