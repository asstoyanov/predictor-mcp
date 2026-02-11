import { apiFootballFetchJson } from "./apifootball";

type ApiFootballOddsResponse = {
  response?: Array<{
    bookmakers?: Array<{
      id?: number;
      name?: string;
      bets?: Array<{
        name?: string;
        values?: Array<{
          value?: string;
          odd?: number | string;
        }>;
      }>;
    }>;
  }>;
};

type ArbLeg = {
  market: "ou25" | "btts" | "1x2";
  selection: string; // "over"/"under", "yes"/"no", "home"/"draw"/"away"
  odds: number;
  bookmakerId?: number;
  bookmakerName?: string;
};

type ArbOpportunity = {
  fixtureId: number;
  market: "ou25" | "btts" | "1x2";
  legs: ArbLeg[];
  invSum: number;      // sum(1/odds)
  roi: number;         // (1/invSum - 1)
  stakePlan: Array<{
    selection: string;
    bookmakerName?: string;
    odds: number;
    stakePct: number;  // % of bankroll to stake on this leg to lock profit
  }>;
};

function n2(x: number) {
  return Math.round(x * 100) / 100;
}
function n4(x: number) {
  return Math.round(x * 10000) / 10000;
}

function parseOdd(v: any): number | null {
  const o = Number(v);
  return Number.isFinite(o) && o > 1 ? o : null;
}

function lower(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

/**
 * Normalize API-Football "bets" names to the markets we care about.
 * (This is the #1 place you’ll tweak once you see your real payloads.)
 */
function normalizeMarketName(name: string): "ou25" | "btts" | "1x2" | null {
  const n = lower(name);

  if (n === "match winner" || n === "winner" || n === "1x2") return "1x2";
  if (n === "both teams score" || n === "btts") return "btts";
  if (n === "goals over/under" || n === "over/under") return "ou25";

  return null;
}

function normalizeSelection(market: "ou25" | "btts" | "1x2", sel: string): string | null {
  const s = lower(sel);

  if (market === "1x2") {
    if (s === "home" || s === "1") return "home";
    if (s === "draw" || s === "x") return "draw";
    if (s === "away" || s === "2") return "away";
    return null;
  }

  if (market === "btts") {
    if (s === "yes") return "yes";
    if (s === "no") return "no";
    return null;
  }

  // ou25
  // API-Football often uses "Over 2.5" / "Under 2.5"
  if (s === "over 2.5" || s === "over2.5" || s === "o2.5") return "over";
  if (s === "under 2.5" || s === "under2.5" || s === "u2.5") return "under";
  return null;
}

/**
 * Pull odds for a fixture across ALL bookmakers and return a flat list of legs.
 */
async function getAllLegsForFixture(fixtureId: number): Promise<ArbLeg[]> {
  const { res, json } = await apiFootballFetchJson("/odds", {
    fixture: String(fixtureId),
  });
  
  if (!res.ok) {
    throw new Error(`API-Football odds error: ${res.status}`);
  }
  const apiResponse = json as ApiFootballOddsResponse | null | undefined;
  const resp = apiResponse?.response ?? [];
  if (!Array.isArray(resp) || resp.length === 0) return [];

  // API-Football sometimes wraps bookmakers under response[i].bookmakers
  const bookmakers = resp.flatMap((x: any) => x?.bookmakers ?? []).filter(Boolean);

  const legs: ArbLeg[] = [];

  for (const bk of bookmakers) {
    const bookmakerId = bk?.id;
    const bookmakerName = bk?.name;

    for (const bet of bk?.bets ?? []) {
      const market = normalizeMarketName(bet?.name);
      if (!market) continue;

      for (const val of bet?.values ?? []) {
        const selection = normalizeSelection(market, val?.value);
        if (!selection) continue;

        const odd = parseOdd(val?.odd);
        if (!odd) continue;

        legs.push({
          market,
          selection,
          odds: odd,
          bookmakerId,
          bookmakerName,
        });
      }
    }
  }

  return legs;
}

/**
 * For each market, take BEST odds per outcome (across all books),
 * then test for arbitrage.
 */
function computeArbsForFixture(fixtureId: number, legs: ArbLeg[], minRoi = 0): ArbOpportunity[] {
  const out: ArbOpportunity[] = [];

  const markets: Array<{ market: "ou25" | "btts" | "1x2"; outcomes: string[] }> = [
    { market: "ou25", outcomes: ["over", "under"] },
    { market: "btts", outcomes: ["yes", "no"] },
    { market: "1x2", outcomes: ["home", "draw", "away"] },
  ];

  for (const spec of markets) {
    const byOutcomeBest = new Map<string, ArbLeg>();

    for (const o of spec.outcomes) {
      const candidates = legs.filter((l) => l.market === spec.market && l.selection === o);
      if (!candidates.length) continue;

      candidates.sort((a, b) => b.odds - a.odds);
      byOutcomeBest.set(o, candidates[0]); // best odds for this outcome
    }

    // Need all outcomes present to do a true arb check
    if (byOutcomeBest.size !== spec.outcomes.length) continue;

    const picked = spec.outcomes.map((o) => byOutcomeBest.get(o)!);
    const invSum = picked.reduce((acc, l) => acc + 1 / l.odds, 0);
    const roi = 1 / invSum - 1;

    if (roi <= 0 || roi < minRoi) continue;

    // stake plan: stake_i = (1/odds_i) / invSum  (fractions sum to 1)
    const stakePlan = picked.map((l) => ({
      selection: l.selection,
      bookmakerName: l.bookmakerName,
      odds: l.odds,
      stakePct: n2(((1 / l.odds) / invSum) * 100),
    }));

    out.push({
      fixtureId,
      market: spec.market,
      legs: picked,
      invSum: n4(invSum),
      roi: n4(roi),
      stakePlan,
    });
  }

  return out;
}

export async function findArbitrageForFixture(opts: { fixtureId: number; minRoi?: number }) {
  const { fixtureId, minRoi = 0 } = opts;
  const legs = await getAllLegsForFixture(fixtureId);
  const arbs = computeArbsForFixture(fixtureId, legs, minRoi);

  return {
    fixtureId,
    marketsChecked: ["ou25", "btts", "1x2"],
    legsCount: legs.length,
    arbs,
  };
}
