export type LeagueKey =
  // Europe
  | "epl"
  | "laliga"
  | "seriea"
  | "bundesliga"
  | "ligue1"
  | "ucl"
  | "uel"

  // South America – international
  | "libertadores"
  | "sudamericana"

  // South America – domestic
  | "br_serie_a"
  | "ar_primera"
  | "cl_primera"
  | "co_primera_a"
  | "pe_liga1"
  | "uy_primera"
  | "ec_serie_a"
  | "py_primera"
  | "bo_primera"
  | "ve_primera";

export const LEAGUES: Record<
  LeagueKey,
  { id: number; name: string; country?: string; type?: "League" | "Cup" }
> = {
  // =========================
  // EUROPE
  // =========================
  epl: { id: 39, name: "Premier League", country: "England", type: "League" },
  laliga: { id: 140, name: "La Liga", country: "Spain", type: "League" },
  seriea: { id: 135, name: "Serie A", country: "Italy", type: "League" },
  bundesliga: { id: 78, name: "Bundesliga", country: "Germany", type: "League" },
  ligue1: { id: 61, name: "Ligue 1", country: "France", type: "League" },

  ucl: { id: 2, name: "UEFA Champions League", type: "Cup" },
  uel: { id: 3, name: "UEFA Europa League", type: "Cup" },

  // =========================
  // SOUTH AMERICA – INTERNATIONAL
  // =========================
  libertadores: { id: 13, name: "CONMEBOL Libertadores", type: "Cup" },
  sudamericana: { id: 11, name: "CONMEBOL Sudamericana", type: "Cup" },

  // =========================
  // SOUTH AMERICA – DOMESTIC (TOP)
  // =========================
  br_serie_a: { id: 71, name: "Serie A", country: "Brazil", type: "League" },
  ar_primera: { id: 128, name: "Primera Division", country: "Argentina", type: "League" },
  cl_primera: { id: 265, name: "Primera Division", country: "Chile", type: "League" },
  co_primera_a: { id: 239, name: "Primera A", country: "Colombia", type: "League" },
  pe_liga1: { id: 281, name: "Liga 1", country: "Peru", type: "League" },
  uy_primera: { id: 268, name: "Primera Division", country: "Uruguay", type: "League" },
  ec_serie_a: { id: 242, name: "Serie A", country: "Ecuador", type: "League" },
  py_primera: { id: 250, name: "Primera Division", country: "Paraguay", type: "League" },
  bo_primera: { id: 253, name: "Primera Division", country: "Bolivia", type: "League" },
  ve_primera: { id: 297, name: "Primera Division", country: "Venezuela", type: "League" },
};
