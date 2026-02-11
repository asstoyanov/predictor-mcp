import { NextResponse } from "next/server";
import { z } from "zod";
import { predictFootballMarketsEloPoisson, type TeamMatch } from "@predictor/core";

const InputSchema = z.object({
  fixtureId: z.coerce.number().int().positive(),
  minEdge: z.coerce.number().min(0).max(0.5).default(0.05),
  bookmaker: z.string().optional(),
});

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const impliedFromOdds = (odds: number[]) => {
  const inv = odds.map((o) => 1 / o);
  const sum = inv.reduce((a, b) => a + b, 0);
  return inv.map((x) => x / sum);
};

export async function GET(req: Request) {
  const key = process.env.APIFOOTBALL_API_KEY;
  if (!key) return NextResponse.json({ error: "Missing APIFOOTBALL_API_KEY" }, { status: 500 });

  const url = new URL(req.url);
  const parsed = InputSchema.safeParse({
    fixtureId: url.searchParams.get("fixtureId"),
    minEdge: url.searchParams.get("minEdge"),
    bookmaker: url.searchParams.get("bookmaker") ?? undefined,
  });

  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { fixtureId, minEdge, bookmaker } = parsed.data;

  // Fixture info
  const fxUrl = new URL("https://v3.football.api-sports.io/fixtures");
  fxUrl.searchParams.set("id", String(fixtureId));
  fxUrl.searchParams.set("timezone", "Europe/Sofia");

  const fxRes = await fetch(fxUrl, { headers: { "x-apisports-key": key } });
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

  // Recent results -> model
  async function fetchRecent(teamId: number): Promise<TeamMatch[]> {
    const u = new URL("https://v3.football.api-sports.io/fixtures");
    u.searchParams.set("team", String(teamId));
    u.searchParams.set("season", String(season));
    u.searchParams.set("last", "20");
    u.searchParams.set("status", "FT");
    u.searchParams.set("timezone", "Europe/Sofia");

    const rr = await fetch(u, { headers: { "x-apisports-key": key } });
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
  const model = modelOut.markets;

  // Odds
  const oddsUrl = new URL("https://v3.football.api-sports.io/odds");
  oddsUrl.searchParams.set("fixture", String(fixtureId));

  const oddsRes = await fetch(oddsUrl, { headers: { "x-apisports-key": key } });
  const oddsJson = await oddsRes.json().catch(() => null);
  if (!oddsRes.ok) return NextResponse.json({ error: oddsJson, note: "Odds endpoint may require plan." }, { status: oddsRes.status });

  const resp = oddsJson?.response ?? [];
  const bkAll = resp.flatMap((x: any) => x?.bookmakers ?? []);
  const pick =
    (bookmaker
      ? bkAll.find((b: any) => String(b?.name ?? "").toLowerCase().includes(bookmaker.toLowerCase()))
      : bkAll[0]) ?? bkAll[0];

  if (!pick) return NextResponse.json({ error: "No bookmakers in odds response" }, { status: 500 });

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

  const odds1 = m1x2?.["Home"] ?? m1x2?.["1"] ?? null;
  const oddsX = m1x2?.["Draw"] ?? m1x2?.["X"] ?? null;
  const odds2 = m1x2?.["Away"] ?? m1x2?.["2"] ?? null;

  const oddsOver25 = mOU?.["Over 2.5"] ?? null;
  const oddsUnder25 = mOU?.["Under 2.5"] ?? null;

  const oddsYes = mBtts?.["Yes"] ?? null;
  const oddsNo = mBtts?.["No"] ?? null;

  const edges: any = {};
  const top: any[] = [];

  if (odds1 && oddsX && odds2) {
    const [p1, pX, p2] = impliedFromOdds([odds1, oddsX, odds2]);
    const e1 = model["1x2"].home - p1;
    const eX = model["1x2"].draw - pX;
    const e2 = model["1x2"].away - p2;

    edges["1x2"] = {
      odds: { home: odds1, draw: oddsX, away: odds2 },
      implied: { home: r3(p1), draw: r3(pX), away: r3(p2) },
      edge: { home: r3(e1), draw: r3(eX), away: r3(e2) },
    };

    top.push({ market: "1x2", selection: "home", modelProb: model["1x2"].home, impliedProb: r3(p1), edge: r3(e1), odds: odds1, value: e1 >= minEdge });
    top.push({ market: "1x2", selection: "draw", modelProb: model["1x2"].draw, impliedProb: r3(pX), edge: r3(eX), odds: oddsX, value: eX >= minEdge });
    top.push({ market: "1x2", selection: "away", modelProb: model["1x2"].away, impliedProb: r3(p2), edge: r3(e2), odds: odds2, value: e2 >= minEdge });
  }

  if (oddsOver25 && oddsUnder25) {
    const [pO, pU] = impliedFromOdds([oddsOver25, oddsUnder25]);
    const eO = model.ou25.over - pO;
    const eU = model.ou25.under - pU;

    edges["ou25"] = {
      odds: { over: oddsOver25, under: oddsUnder25 },
      implied: { over: r3(pO), under: r3(pU) },
      edge: { over: r3(eO), under: r3(eU) },
    };

    top.push({ market: "ou25", selection: "over", modelProb: model.ou25.over, impliedProb: r3(pO), edge: r3(eO), odds: oddsOver25, value: eO >= minEdge });
    top.push({ market: "ou25", selection: "under", modelProb: model.ou25.under, impliedProb: r3(pU), edge: r3(eU), odds: oddsUnder25, value: eU >= minEdge });
  }

  if (oddsYes && oddsNo) {
    const [pY, pN] = impliedFromOdds([oddsYes, oddsNo]);
    const eY = model.btts.yes - pY;
    const eN = model.btts.no - pN;

    edges["btts"] = {
      odds: { yes: oddsYes, no: oddsNo },
      implied: { yes: r3(pY), no: r3(pN) },
      edge: { yes: r3(eY), no: r3(eN) },
    };

    top.push({ market: "btts", selection: "yes", modelProb: model.btts.yes, impliedProb: r3(pY), edge: r3(eY), odds: oddsYes, value: eY >= minEdge });
    top.push({ market: "btts", selection: "no", modelProb: model.btts.no, impliedProb: r3(pN), edge: r3(eN), odds: oddsNo, value: eN >= minEdge });
  }

  top.sort((a, b) => b.edge - a.edge);

  return NextResponse.json({
    fixtureId,
    homeTeam,
    awayTeam,
    bookmaker: { id: pick?.id, name: pick?.name },
    modelInfo: { homeElo: modelOut.homeElo, awayElo: modelOut.awayElo, lambdaHome: modelOut.lambdaHome, lambdaAway: modelOut.lambdaAway },
    model,
    edges,
    top: top.slice(0, 6),
    minEdge,
  });
}
