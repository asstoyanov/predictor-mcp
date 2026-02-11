import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PredictInputSchema, predict1x2 } from "@predictor/core";
import { predictFootballMarketsEloPoisson, type TeamMatch } from "@predictor/core/dev";
import { LEAGUES, type LeagueKey } from "./leagues";


const server = new McpServer({
  name: "predictor-mcp",
  version: "0.0.1",
});

const supportsJson = true;

const OddsEdgeInputSchema = z.object({
  fixtureId: z.number().int().positive(),
  // Optional: choose bookmaker by name (API-Football returns many)
  bookmaker: z.string().optional(),
  // Edge threshold to flag “value”
  minEdge: z.number().min(0).max(0.5).default(0.05),
});

const ScanInputSchema = z.object({
  leagueKey: z.string().min(1),
  season: z.number().int().min(1900).max(2100),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minEdge: z.number().min(0).max(0.5).default(0.05),

  onlyValue: z.boolean().optional(),
  minOdds: z.number().min(1).optional(),
  market: z.enum(["all", "1x2", "btts", "ou25", "draw"]).optional(),
  concurrency: z.number().int().min(1).max(12).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const AnalyzeInputSchema = z.object({
  fixtureId: z.number().int().positive(),
  minEdge: z.number().min(0).max(0.5).default(0.05),
});

function r3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function impliedFromOdds(odds: number[]) {
  // implied p = 1/odds, then normalize to remove overround
  const inv = odds.map((o) => 1 / o);
  const sum = inv.reduce((a, b) => a + b, 0);
  return inv.map((x) => x / sum);
}

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? "http://localhost:3000";

async function callWebApi(path: string, params: Record<string, string>) {
  const url = new URL(path, WEB_BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), { cache: "no-store" });
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(`web api ${path} failed ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return json;
}

server.tool(
  "fixture.analyze",
  "Analyze a single fixture: model probabilities, odds, edges, injuries flags (wraps web /api/predict_fixture).",
  { input: AnalyzeInputSchema },
  async ({ input }) => {
    const data = await callWebApi("/api/predict_fixture", {
      fixtureId: String(input.fixtureId),
      minEdge: String(input.minEdge),
    });

    return {
      content: supportsJson
        ? [{ type: "json", data }]
        : [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "scan.fixtures",
  "Scan fixtures in a league/date-range and return ranked value-bets (wraps web /api/scan).",
  { input: ScanInputSchema },
  async ({ input }) => {
    const data = await callWebApi("/api/scan", {
      leagueKey: String(input.leagueKey),
      season: String(input.season),
      from: input.from,
      to: input.to,
      minEdge: String(input.minEdge),

      ...(input.onlyValue !== undefined ? { onlyValue: String(input.onlyValue) } : {}),
      ...(input.minOdds !== undefined ? { minOdds: String(input.minOdds) } : {}),
      ...(input.market ? { market: input.market } : {}),
      ...(input.concurrency !== undefined ? { concurrency: String(input.concurrency) } : {}),
      ...(input.limit !== undefined ? { limit: String(input.limit) } : {}),
    });

    return {
      content: supportsJson
        ? [{ type: "json", data }]
        : [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "odds.edge_fixture",
  "Compare model probabilities vs bookmaker odds for a fixtureId (1X2, O/U2.5, BTTS).",
  { input: OddsEdgeInputSchema },
  async ({ input }) => {
    const key = process.env.APIFOOTBALL_API_KEY;
    if (!key) {
      return {
        content: [{ type: "text", text: "Missing APIFOOTBALL_API_KEY in apps/mcp/.env" }],
        isError: true,
      };
    }

    // 1) Get model output (reuse your existing flow)
    // Fetch the fixture to get teams + season + ids
    const fxUrl = new URL("https://v3.football.api-sports.io/fixtures");
    fxUrl.searchParams.set("id", String(input.fixtureId));
    fxUrl.searchParams.set("timezone", "Europe/Sofia");

    const fxRes = await fetch(fxUrl, { headers: { "x-apisports-key": key } });
    const fxJson = await fxRes.json().catch(() => null);
    if (!fxRes.ok) {
      return {
        content: [{ type: "text", text: `fixtures error ${fxRes.status}: ${JSON.stringify(fxJson).slice(0, 300)}` }],
        isError: true,
      };
    }

    const f = fxJson?.response?.[0];
    const homeTeam = f?.teams?.home?.name;
    const awayTeam = f?.teams?.away?.name;
    const homeId = f?.teams?.home?.id;
    const awayId = f?.teams?.away?.id;
    const season = f?.league?.season;

    if (!homeTeam || !awayTeam || !homeId || !awayId || !season) {
      return {
        content: [{ type: "text", text: `Missing teams/ids/season for fixture id=${input.fixtureId}` }],
        isError: true,
      };
    }

    async function fetchRecent(teamId: number): Promise<TeamMatch[]> {
      const u = new URL("https://v3.football.api-sports.io/fixtures");
      u.searchParams.set("team", String(teamId));
      u.searchParams.set("season", String(season));
      u.searchParams.set("last", "20");
      u.searchParams.set("status", "FT");
      u.searchParams.set("timezone", "Europe/Sofia");

      const rr = await fetch(u, { headers: { "x-apisports-key": key } });
      const jj = await rr.json().catch(() => null);
      if (!rr.ok) throw new Error(`recent fixtures error ${rr.status}: ${JSON.stringify(jj).slice(0, 200)}`);

      return (jj?.response ?? []).map((m: any) => {
        const isHome = m?.teams?.home?.id === teamId;
        const gf = isHome ? m?.goals?.home : m?.goals?.away;
        const ga = isHome ? m?.goals?.away : m?.goals?.home;
        return {
          goalsFor: Number(gf ?? 0),
          goalsAgainst: Number(ga ?? 0),
          isHome,
          dateISO: m?.fixture?.date,
        } satisfies TeamMatch;
      });
    }

    const [homeRecent, awayRecent] = await Promise.all([fetchRecent(homeId), fetchRecent(awayId)]);
    const modelOut = predictFootballMarketsEloPoisson({ homeRecent, awayRecent });

    // 2) Fetch odds for that fixture (requires plan support)
    // API-Football odds endpoint can vary by plan; this is the usual v3 format:
    const oddsUrl = new URL("https://v3.football.api-sports.io/odds");
    oddsUrl.searchParams.set("fixture", String(input.fixtureId));

    const oddsRes = await fetch(oddsUrl, { headers: { "x-apisports-key": key } });
    const oddsJson = await oddsRes.json().catch(() => null);

    if (!oddsRes.ok) {
      return {
        content: [
          {
            type: "text",
            text:
              `odds error ${oddsRes.status}: ` +
              `${JSON.stringify(oddsJson).slice(0, 500)}\n` +
              `If your plan doesn’t include odds, we’ll plug a different odds source next.`,
          },
        ],
        isError: true,
      };
    }

    const resp = oddsJson?.response ?? [];
    if (!resp.length) {
      return {
        content: [{ type: "text", text: `No odds returned for fixture ${input.fixtureId}. (Maybe odds not posted yet.)` }],
        isError: true,
      };
    }

    // Pick one bookmaker (either requested, or first available)
    const bkAll = resp.flatMap((x: any) => x?.bookmakers ?? []);
    const pick =
      (input.bookmaker
        ? bkAll.find((b: any) => String(b?.name ?? "").toLowerCase().includes(input.bookmaker!.toLowerCase()))
        : bkAll[0]) ?? bkAll[0];

    if (!pick) {
      return { content: [{ type: "text", text: "No bookmakers found in odds response." }], isError: true };
    }

    // Helper to extract a market by name and map values -> odds number
    function getMarketOdds(marketName: string) {
      const bet = (pick?.bets ?? []).find((b: any) => String(b?.name ?? "").toLowerCase() === marketName.toLowerCase());
      if (!bet) return null;
      const values: Record<string, number> = {};
      for (const v of bet?.values ?? []) {
        const label = String(v?.value ?? "");
        const odd = Number(v?.odd);
        if (label && Number.isFinite(odd)) values[label] = odd;
      }
      return values;
    }

    // 1X2 market names vary a bit; commonly "Match Winner"
    const m1x2 = getMarketOdds("Match Winner") ?? getMarketOdds("Winner") ?? getMarketOdds("1X2");
    const mBtts = getMarketOdds("Both Teams Score") ?? getMarketOdds("BTTS");
    const mOU = getMarketOdds("Goals Over/Under") ?? getMarketOdds("Over/Under");

    // Extract specific selections we care about
    const odds1 = m1x2?.["Home"] ?? m1x2?.["1"] ?? null;
    const oddsX = m1x2?.["Draw"] ?? m1x2?.["X"] ?? null;
    const odds2 = m1x2?.["Away"] ?? m1x2?.["2"] ?? null;

    // For OU we want 2.5
    const oddsOver25 = mOU?.["Over 2.5"] ?? null;
    const oddsUnder25 = mOU?.["Under 2.5"] ?? null;

    const oddsYes = mBtts?.["Yes"] ?? null;
    const oddsNo = mBtts?.["No"] ?? null;

    const model = modelOut.markets;

    const out: any = {
      fixtureId: input.fixtureId,
      homeTeam,
      awayTeam,
      bookmaker: { id: pick?.id, name: pick?.name },
      model,
      edges: {},
      note: `edge = modelProb - impliedProb (overround removed). minEdge=${input.minEdge}`,
    };

    // 1X2 edges
    if (odds1 && oddsX && odds2) {
      const [p1, pX, p2] = impliedFromOdds([odds1, oddsX, odds2]);
      const edge1 = model["1x2"].home - p1;
      const edgeX = model["1x2"].draw - pX;
      const edge2 = model["1x2"].away - p2;

      out.edges["1x2"] = {
        odds: { home: odds1, draw: oddsX, away: odds2 },
        implied: { home: r3(p1), draw: r3(pX), away: r3(p2) },
        edge: { home: r3(edge1), draw: r3(edgeX), away: r3(edge2) },
        value: {
          home: edge1 >= input.minEdge,
          draw: edgeX >= input.minEdge,
          away: edge2 >= input.minEdge,
        },
      };
    }

    // OU2.5 edges
    if (oddsOver25 && oddsUnder25) {
      const [pO, pU] = impliedFromOdds([oddsOver25, oddsUnder25]);
      const eO = model.ou25.over - pO;
      const eU = model.ou25.under - pU;

      out.edges["ou25"] = {
        odds: { over: oddsOver25, under: oddsUnder25 },
        implied: { over: r3(pO), under: r3(pU) },
        edge: { over: r3(eO), under: r3(eU) },
        value: { over: eO >= input.minEdge, under: eU >= input.minEdge },
      };
    }

    // BTTS edges
    if (oddsYes && oddsNo) {
      const [pY, pN] = impliedFromOdds([oddsYes, oddsNo]);
      const eY = model.btts.yes - pY;
      const eN = model.btts.no - pN;

      out.edges["btts"] = {
        odds: { yes: oddsYes, no: oddsNo },
        implied: { yes: r3(pY), no: r3(pN) },
        edge: { yes: r3(eY), no: r3(eN) },
        value: { yes: eY >= input.minEdge, no: eN >= input.minEdge },
      };
    }

    type Pick = {
      market: "1x2" | "ou25" | "btts" | "draw";
      selection: string;
      modelProb: number;
      impliedProb: number;
      edge: number;
      odds: number;
      value: boolean;
    };
    
    const picks: Pick[] = [];
    
    // 1X2
    if (out.edges["1x2"]) {
      const e = out.edges["1x2"];
      picks.push({
        market: "1x2",
        selection: "home",
        modelProb: r3(out.model["1x2"].home),
        impliedProb: e.implied.home,
        edge: e.edge.home,
        odds: e.odds.home,
        value: e.value.home,
      });
      picks.push({
        market: "1x2",
        selection: "draw",
        modelProb: r3(out.model["1x2"].draw),
        impliedProb: e.implied.draw,
        edge: e.edge.draw,
        odds: e.odds.draw,
        value: e.value.draw,
      });
      picks.push({
        market: "1x2",
        selection: "away",
        modelProb: r3(out.model["1x2"].away),
        impliedProb: e.implied.away,
        edge: e.edge.away,
        odds: e.odds.away,
        value: e.value.away,
      });
    }
    
    // OU2.5
    if (out.edges["ou25"]) {
      const e = out.edges["ou25"];
      picks.push({
        market: "ou25",
        selection: "over",
        modelProb: r3(out.model.ou25.over),
        impliedProb: e.implied.over,
        edge: e.edge.over,
        odds: e.odds.over,
        value: e.value.over,
      });
      picks.push({
        market: "ou25",
        selection: "under",
        modelProb: r3(out.model.ou25.under),
        impliedProb: e.implied.under,
        edge: e.edge.under,
        odds: e.odds.under,
        value: e.value.under,
      });
    }
    
    // BTTS
    if (out.edges["btts"]) {
      const e = out.edges["btts"];
      picks.push({
        market: "btts",
        selection: "yes",
        modelProb: r3(out.model.btts.yes),
        impliedProb: e.implied.yes,
        edge: e.edge.yes,
        odds: e.odds.yes,
        value: e.value.yes,
      });
      picks.push({
        market: "btts",
        selection: "no",
        modelProb: r3(out.model.btts.no),
        impliedProb: e.implied.no,
        edge: e.edge.no,
        odds: e.odds.no,
        value: e.value.no,
      });
    }
    
    // Sort by edge desc
    picks.sort((a, b) => b.edge - a.edge);
    
    // Add top section (show top 5 by default)
    out.top = picks.slice(0, 5);
    

    return {
      content: supportsJson
        ? [{ type: "json", data: out }]
        : [{ type: "text", text: JSON.stringify(out, null, 2) }],
    };
  }
);


server.tool(
  "match.predict",
  "Predict 1X2 probabilities for a match (MVP placeholder).",
  { input: PredictInputSchema },
  async ({ input }) => {
    const result = predict1x2(input);
    return {
      content: supportsJson
        ? [{ type: "json", data: result }]
        : [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

const FixturesListInputSchema = z
  .object({
    league: z.number().int().positive().optional(),
    leagueKey: z.string().optional(),
    season: z.number().int().min(1900).max(2100),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((v) => Boolean(v.league) || Boolean(v.leagueKey), {
    message: "Provide either league or leagueKey",
    path: ["leagueKey"],
  });


const PredictFixtureInputSchema = z.object({
  fixtureId: z.number().int().positive(),
});

const PredictMarketsInputSchema = z.object({
  fixtureId: z.number().int().positive(),
});

server.tool(
  "fixtures.list",
  "List football fixtures for a league in a date range (API-Football).",
  { input: FixturesListInputSchema },
  async ({ input }) => {
    const key = process.env.APIFOOTBALL_API_KEY;
    console.error("APIFOOTBALL_API_KEY present:", Boolean(key), "length:", key?.length ?? 0);

    if (!key) {
      return {
        content: [{ type: "text", text: "Missing APIFOOTBALL_API_KEY in apps/mcp/.env" }],
        isError: true,
      };
    }

    let leagueId = input.league;

if (!leagueId) {
  const key = input.leagueKey as LeagueKey;
  const spec = LEAGUES[key];

  if (!spec) {
    return {
      content: [{ type: "text", text: `Unknown leagueKey: ${input.leagueKey}` }],
      isError: true,
    };
  }

  const leaguesUrl = new URL("https://v3.football.api-sports.io/leagues");
  leaguesUrl.searchParams.set("search", spec.name);
  if (spec.country) leaguesUrl.searchParams.set("country", spec.country);

  const leaguesRes = await fetch(leaguesUrl, {
    headers: { "x-apisports-key": process.env.APIFOOTBALL_API_KEY! },
  });

  const leaguesJson = await leaguesRes.json().catch(() => null);

  if (!leaguesRes.ok) {
    return {
      content: [
        {
          type: "text",
          text: `API-Football /leagues error ${leaguesRes.status}: ${JSON.stringify(leaguesJson).slice(0, 400)}`,
        },
      ],
      isError: true,
    };
  }

  // pick best match
  const items = (leaguesJson?.response ?? []).filter(Boolean);

// filter by exact name (case-insensitive)
let filtered = items.filter((it: any) =>
  String(it?.league?.name ?? "").toLowerCase() === spec.name.toLowerCase()
);

// enforce country if provided
if (spec.country) {
  filtered = filtered.filter(
    (it: any) => String(it?.country?.name ?? "").toLowerCase() === spec.country!.toLowerCase()
  );
}

// enforce type if provided
if (spec.type) {
  filtered = filtered.filter((it: any) => it?.league?.type === spec.type);
}

// pick best (or fallback)
const picked = filtered[0] ?? items[0];
leagueId = picked?.league?.id;

if (!leagueId) {
  const lk = input.leagueKey as LeagueKey;
  const spec = LEAGUES[lk];

  if (!spec) {
    return {
      content: [{ type: "text", text: `Unknown leagueKey: ${input.leagueKey}` }],
      isError: true,
    };
  }

  leagueId = spec.id;
}


}


    const url = new URL("https://v3.football.api-sports.io/fixtures");
    url.searchParams.set("league", String(leagueId));
    url.searchParams.set("season", String(input.season));
    url.searchParams.set("from", input.from);
    url.searchParams.set("to", input.to);
    url.searchParams.set("timezone", "Europe/Sofia");

    const res = await fetch(url, {
      headers: { "x-apisports-key": key },
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        content: [
          {
            type: "text",
            text: `API-Football error ${res.status}: ${JSON.stringify(json).slice(0, 500)}`,
          },
        ],
        isError: true,
      };
    }

    const fixtures = (json?.response ?? []).map((f: any) => ({
      fixtureId: f?.fixture?.id,
      date: f?.fixture?.date,
      home: f?.teams?.home?.name,
      away: f?.teams?.away?.name,
      league: f?.league?.name,
      round: f?.league?.round,
      status: f?.fixture?.status?.short,
    }));

    return {
      content: supportsJson
        ? [{ type: "json", data: { count: fixtures.length, fixtures } }]
        : [{ type: "text", text: JSON.stringify({ count: fixtures.length, fixtures }, null, 2) }],
    };
  }
);

server.tool(
  "match.predict_fixture",
  "Predict 1X2 probabilities for a fixtureId (API-Football → teams → predictor).",
  { input: PredictFixtureInputSchema },
  async ({ input }) => {
    const key = process.env.APIFOOTBALL_API_KEY;
    if (!key) {
      return {
        content: [{ type: "text", text: "Missing APIFOOTBALL_API_KEY in apps/mcp/.env" }],
        isError: true,
      };
    }

    const url = new URL("https://v3.football.api-sports.io/fixtures");
    url.searchParams.set("id", String(input.fixtureId));
    url.searchParams.set("timezone", "Europe/Sofia");

    const res = await fetch(url, {
      headers: { "x-apisports-key": key },
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        content: [
          {
            type: "text",
            text: `API-Football error ${res.status}: ${JSON.stringify(json).slice(0, 500)}`,
          },
        ],
        isError: true,
      };
    }

    const f = json?.response?.[0];
    const homeTeam = f?.teams?.home?.name;
    const awayTeam = f?.teams?.away?.name;

    if (!homeTeam || !awayTeam) {
      return {
        content: [{ type: "text", text: `Fixture not found or missing teams for id=${input.fixtureId}` }],
        isError: true,
      };
    }

    const result = predict1x2({ homeTeam, awayTeam });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              fixtureId: input.fixtureId,
              homeTeam,
              awayTeam,
              prediction: result,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "match.predict_markets",
  "Predict extra markets for a fixtureId (derived from MVP 1X2 placeholder).",
  { input: PredictMarketsInputSchema },
  async ({ input }) => {
    const key = process.env.APIFOOTBALL_API_KEY;
    if (!key) {
      return {
        content: [{ type: "text", text: "Missing APIFOOTBALL_API_KEY in apps/mcp/.env" }],
        isError: true,
      };
    }

    const r = (n: number) => Math.round(n * 1000) / 1000;
    const url = new URL("https://v3.football.api-sports.io/fixtures");
    url.searchParams.set("id", String(input.fixtureId));
    url.searchParams.set("timezone", "Europe/Sofia");

    const res = await fetch(url, { headers: { "x-apisports-key": key } });
    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        content: [
          { type: "text", text: `API-Football error ${res.status}: ${JSON.stringify(json).slice(0, 500)}` },
        ],
        isError: true,
      };
    }

    const f = json?.response?.[0];
    const homeTeam = f?.teams?.home?.name;
    const awayTeam = f?.teams?.away?.name;

    const homeId = f?.teams?.home?.id;
    const awayId = f?.teams?.away?.id;
    const season = f?.league?.season;
    if (!homeId || !awayId || !season) {
      return {
        content: [{ type: "text", text: `Missing team ids/season for fixture id=${input.fixtureId}` }],
        isError: true,
      };
    }

    async function fetchRecent(teamId: number): Promise<TeamMatch[]> {
      const u = new URL("https://v3.football.api-sports.io/fixtures");
      u.searchParams.set("team", String(teamId));
      u.searchParams.set("season", String(season));
      u.searchParams.set("last", "20");
      u.searchParams.set("status", "FT");
      u.searchParams.set("timezone", "Europe/Sofia");
    
      const rr = await fetch(u, { headers: { "x-apisports-key": key } });
      const jj = await rr.json().catch(() => null);
      if (!rr.ok) throw new Error(`recent fixtures error ${rr.status}: ${JSON.stringify(jj).slice(0, 200)}`);
    
      return (jj?.response ?? []).map((m: any) => {
        const isHome = m?.teams?.home?.id === teamId;
        const gf = isHome ? m?.goals?.home : m?.goals?.away;
        const ga = isHome ? m?.goals?.away : m?.goals?.home;
        return {
          goalsFor: Number(gf ?? 0),
          goalsAgainst: Number(ga ?? 0),
          isHome,
          dateISO: m?.fixture?.date,
        } satisfies TeamMatch;
      });
    }
    
    const [homeRecent, awayRecent] = await Promise.all([fetchRecent(homeId), fetchRecent(awayId)]);
    const modelOut = predictFootballMarketsEloPoisson({ homeRecent, awayRecent });
    


    if (!homeTeam || !awayTeam) {
      return {
        content: [{ type: "text", text: `Fixture not found or missing teams for id=${input.fixtureId}` }],
        isError: true,
      };
    }

    const p = predict1x2({ homeTeam, awayTeam });
    const home = p.home;
    const draw = p.draw;
    const away = p.away;

    // Derived markets (MVP heuristics)
    const doubleChance = {
      "1X": r(home + draw),
      "12": r(home + away),
      "X2": r(draw + away),
    };

    // Heuristic: more “balanced” games -> higher BTTS + overs
    const balance = 1 - Math.abs(home - away); // ~0..1
    const bttsYes = r(Math.min(0.75, Math.max(0.35, 0.35 + balance * 0.4)));
    const bttsNo = r(1 - bttsYes);

    const over25 = r(Math.min(0.75, Math.max(0.35, 0.35 + balance * 0.35)));
    const under25 = r(1 - over25);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              fixtureId: input.fixtureId,
              homeTeam,
              awayTeam,
              model: {
                name: modelOut.model,
                homeElo: modelOut.homeElo,
                awayElo: modelOut.awayElo,
                lambdaHome: modelOut.lambdaHome,
                lambdaAway: modelOut.lambdaAway,
              },
              markets: modelOut.markets,
            },
            null,
            2
          ),
        },
      ],
    };
    
  }
);

// console.error("MCP server running (stdio): predictor-mcp");

await server.connect(new StdioServerTransport());
