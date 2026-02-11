import type { LeagueKey } from "../../../src/lib/leagues";
import { createTtlCache } from "./cache";
import { getFixtures } from "./fixtures.service";
import { predictFixture } from "./predict.service";

const CACHE_TTL_MS = 60_000;
const scanCache = createTtlCache<any>(CACHE_TTL_MS);

type MarketKey = "1x2" | "btts" | "ou25" | "draw" | "all";

type ScanOpts = {
  leagueKey: LeagueKey;
  season: number;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  minEdge: number;

  // Optional filters
  onlyValue?: boolean; // default false
  minOdds?: number; // default undefined
  market?: MarketKey; // default "all"

  // Perf controls
  concurrency?: number; // default 6
  limit?: number; // limit fixtures processed (for safety)
};

function makeKey(opts: ScanOpts) {
  const {
    leagueKey,
    season,
    from,
    to,
    minEdge,
    onlyValue,
    minOdds,
    market,
    concurrency,
    limit,
  } = opts;

  return JSON.stringify({
    leagueKey,
    season,
    from,
    to,
    minEdge,
    onlyValue: !!onlyValue,
    minOdds: minOdds ?? null,
    market: market ?? "all",
    concurrency: concurrency ?? 6,
    limit: limit ?? null,
  });
}

function passesFilters(
  bet: any,
  opts: Pick<ScanOpts, "onlyValue" | "minOdds" | "market">
) {
  if (!bet) return false;

  if (opts.market && opts.market !== "all" && bet.market !== opts.market) return false;

  if (opts.onlyValue && !bet.value) return false;

  if (typeof opts.minOdds === "number" && Number.isFinite(opts.minOdds)) {
    if (!(Number(bet.odds) >= opts.minOdds)) return false;
  }

  return true;
}

function severityFromBet(bet: any) {
  const edge = Number(bet?.edge);
  const odds = Number(bet?.odds);

  // huge disagreement: big edge AND not a short price
  if (Number.isFinite(edge) && edge >= 0.1 && Number.isFinite(odds) && odds >= 3) {
    return "huge";
  }

  if (bet?.value) return "value";
  return "none";
}

// Type guard: only this branch guarantees pred.top exists
function hasOddsTop(x: any): x is { oddsAvailable: true; top: any[] } {
  return x?.oddsAvailable === true && Array.isArray(x?.top);
}

export async function scanFixtures(opts: ScanOpts) {
  const cacheKey = makeKey(opts);
  const cached = scanCache.get(cacheKey);
  if (cached) return { ...cached, cached: true };

  const {
    leagueKey,
    season,
    from,
    to,
    minEdge,
    onlyValue = false,
    minOdds,
    market = "all",
    concurrency = 6,
    limit,
  } = opts;

  // 1) Load fixtures (internally cached by getFixtures)
  const fx = await getFixtures({ leagueKey, season, from, to });
  const fixturesAll = fx.fixtures ?? [];
  const fixtures =
    typeof limit === "number" ? fixturesAll.slice(0, Math.max(0, limit)) : fixturesAll;

  // 2) Fan-out predictions with concurrency control
  let index = 0;
  const results: any[] = [];
  const errors: Array<{ fixtureId: number; error: string }> = [];

  async function worker() {
    while (index < fixtures.length) {
      const item = fixtures[index++];
      const fixtureId = Number(item?.fixtureId);
      if (!Number.isFinite(fixtureId)) continue;

      try {
        const pred = await predictFixture({ fixtureId, minEdge });

        // IMPORTANT:
        // - If odds exist (oddsAvailable === true), keep bookmaker + keep top.
        // - Apply filters, but if filters wipe top, fall back to original top
        //   so your UI still shows a bookmaker + picks like before.
        if (hasOddsTop(pred)) {
          const originalTop = pred.top;
        
          const topFiltered = originalTop.filter((b: any) =>
            passesFilters(b, { onlyValue, minOdds, market })
          );
        
          const topFinal = (topFiltered.length ? topFiltered : originalTop).map((b: any) => ({
            ...b,
            severity: severityFromBet(b),
          }));
        
          results.push({
            fixtureId,
            prediction: {
              ...pred,
              top: topFinal,
            },
          });
        } else {
          results.push({ fixtureId, prediction: pred });
        }
      } catch (e: any) {
        errors.push({ fixtureId, error: e?.message ?? String(e) });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker())
  );

  // Sort results by "best edge found" (if any)
  results.sort((a, b) => {
    const ae = a?.prediction?.top?.[0]?.score ?? a?.prediction?.top?.[0]?.edge ?? -999;
    const be = b?.prediction?.top?.[0]?.score ?? b?.prediction?.top?.[0]?.edge ?? -999;
    return be - ae;
  });
  

  const payload = {
    leagueKey,
    season,
    from,
    to,
    count: fixtures.length,
    fixtures,
    results,
    errors,
    filters: {
      minEdge,
      onlyValue,
      minOdds: minOdds ?? null,
      market,
    },
    cached: false,
  };

  scanCache.set(cacheKey, payload);
  return payload;
}
