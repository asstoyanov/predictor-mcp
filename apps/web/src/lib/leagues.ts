export type LeagueKey =
  | "laliga"
  | "laliga2"
  | "epl"
  | "championship"
  | "league1"
  | "league2"
  | "seriea"
  | "serieb"
  | "bundesliga"
  | "bundesliga2"
  | "ligue1"
  | "ligue2"
  | "libertadores"
  | "sudamericana"
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

export const LEAGUES: Record<LeagueKey, { id: number; label: string }> = {
  laliga: { id: 140, label: "Spain — La Liga" },
  laliga2:{ id: 141, label: "Spain — La Liga 2" },
  epl: { id: 39, label: "England — Premier League" },

  championship: { id: 40, label: "England — Championship" },
  league1:      { id: 41, label: "England — League One" },
  league2:      { id: 42, label: "England — League Two" },
  // Germany
  bundesliga:  { id: 78, label: "Germany — Bundesliga" },
  bundesliga2: { id: 79, label: "Germany — 2. Bundesliga" },

  // Italy
  seriea: { id: 135, label: "Italy — Serie A" },
  serieb: { id: 136, label: "Italy — Serie B" },

  // France
  ligue1: { id: 61, label: "France — Ligue 1" },
  ligue2: { id: 62, label: "France — Ligue 2" },

  libertadores: { id: 13, label: "South America — Libertadores" },
  sudamericana: { id: 11, label: "South America — Sudamericana" },

  br_serie_a: { id: 71, label: "Brazil — Serie A" },
  ar_primera: { id: 128, label: "Argentina — Primera Division" },
  cl_primera: { id: 265, label: "Chile — Primera Division" },
  co_primera_a: { id: 239, label: "Colombia — Primera A" },
  pe_liga1: { id: 281, label: "Peru — Liga 1" },
  uy_primera: { id: 268, label: "Uruguay — Primera Division" },
  ec_serie_a: { id: 242, label: "Ecuador — Serie A" },
  py_primera: { id: 250, label: "Paraguay — Primera Division" },
  bo_primera: { id: 253, label: "Bolivia — Primera Division" },
  ve_primera: { id: 297, label: "Venezuela — Primera Division" },
};
