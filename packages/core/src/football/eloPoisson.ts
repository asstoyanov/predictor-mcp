export type TeamMatch = {
    // match from the team’s perspective
    goalsFor: number;
    goalsAgainst: number;
    // optional; if you later want home/away split
    isHome?: boolean;
    dateISO?: string;
  };
  
  export type FootballMarkets = {
    "1x2": { home: number; draw: number; away: number };
    doubleChance: { "1X": number; "12": number; "X2": number };
    btts: { yes: number; no: number };
    ou25: { over: number; under: number };
  };
  
  const r = (n: number) => Math.round(n * 1000) / 1000;
  
  function clamp(n: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, n));
  }
  
  function poissonPmf(k: number, lambda: number) {
    // P(X=k) = e^-λ * λ^k / k!
    // k small (0..10), safe with iterative factorial
    let fact = 1;
    for (let i = 2; i <= k; i++) fact *= i;
    return Math.exp(-lambda) * Math.pow(lambda, k) / fact;
  }
  
  /**
   * Compute 1X2, O/U 2.5, BTTS using Poisson goal model.
   * We cap at maxGoals to approximate the tails.
   */
  function poissonMarkets(lambdaHome: number, lambdaAway: number, maxGoals = 10): FootballMarkets {
    let homeWin = 0;
    let draw = 0;
    let awayWin = 0;
  
    let bttsYes = 0;
    let over25 = 0;
  
    for (let hg = 0; hg <= maxGoals; hg++) {
      const ph = poissonPmf(hg, lambdaHome);
      for (let ag = 0; ag <= maxGoals; ag++) {
        const pa = poissonPmf(ag, lambdaAway);
        const p = ph * pa;
  
        if (hg > ag) homeWin += p;
        else if (hg === ag) draw += p;
        else awayWin += p;
  
        if (hg >= 1 && ag >= 1) bttsYes += p;
        if (hg + ag >= 3) over25 += p;
      }
    }
  
    // Normalize (tail truncation)
    const sum = homeWin + draw + awayWin;
    homeWin /= sum;
    draw /= sum;
    awayWin /= sum;
  
    const dc1x = homeWin + draw;
    const dc12 = homeWin + awayWin;
    const dcx2 = draw + awayWin;
  
    const bttsNo = 1 - bttsYes;
    const under25 = 1 - over25;
  
    return {
      "1x2": { home: r(homeWin), draw: r(draw), away: r(awayWin) },
      doubleChance: { "1X": r(dc1x), "12": r(dc12), "X2": r(dcx2) },
      btts: { yes: r(bttsYes), no: r(bttsNo) },
      ou25: { over: r(over25), under: r(under25) },
    };
  }
  
  /**
   * Elo from a list of matches. Minimal Elo:
   * - start at 1500
   * - K=20
   * - update vs opponent “average” 1500 (since we don’t have full league graph yet)
   *
   * This is still a meaningful baseline once you feed last N results.
   */
  export function eloFromMatches(matches: TeamMatch[], initial = 1500) {
    let elo = initial;
    const K = 20;
  
    for (const m of matches) {
      const scored = m.goalsFor;
      const conceded = m.goalsAgainst;
  
      const result = scored > conceded ? 1 : scored === conceded ? 0.5 : 0;
  
      const opp = 1500; // baseline opponent strength for MVP
      const expected = 1 / (1 + Math.pow(10, (opp - elo) / 400));
  
      const gd = Math.abs(scored - conceded);
        const mult = 1 + Math.min(2, gd) * 0.25; // 1.0 .. 1.5 (caps)
        elo = elo + K * mult * (result - expected);

    }
  
    return elo;
  }
  
  /**
   * Build lambdas from Elo diff (very common baseline idea):
   * - start from reasonable base lambdas
   * - adjust by Elo difference
   */
  function lambdasFromElo(homeElo: number, awayElo: number) {
    const diff = homeElo - awayElo;
  
    // Base expected goals (typical-ish)
    let lh = 1.45;
    let la = 1.15;
  
    // Adjust by elo diff: 400 Elo ≈ noticeable shift
    const delta = clamp(diff / 400, -1.5, 1.5) * 0.35;
    lh = clamp(lh + delta, 0.2, 3.2);
    la = clamp(la - delta, 0.2, 3.2);
  
    return { lambdaHome: lh, lambdaAway: la };
  }
  
  /**
   * Main: given recent matches for each team, produce markets.
   */
  export function predictFootballMarketsEloPoisson(args: {
    homeRecent: TeamMatch[];
    awayRecent: TeamMatch[];
  }) {
    const homeElo = eloFromMatches(args.homeRecent);
    const awayElo = eloFromMatches(args.awayRecent);
  
    const { lambdaHome, lambdaAway } = lambdasFromElo(homeElo, awayElo);
  
    const markets = poissonMarkets(lambdaHome, lambdaAway);
  
    return {
      model: "elo+poisson",
      homeElo: r(homeElo),
      awayElo: r(awayElo),
      lambdaHome: r(lambdaHome),
      lambdaAway: r(lambdaAway),
      markets,
    };
  }
  