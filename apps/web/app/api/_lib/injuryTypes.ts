export type InjuryImpactFlag =
  | { code: "TOP_SCORER_OUT"; teamId: number; teamName: string; playerId: number; playerName: string; stat: { rank: 1; goals: number } }
  | { code: "TOP_ASSISTER_OUT"; teamId: number; teamName: string; playerId: number; playerName: string; stat: { rank: 1; assists: number } }
  | { code: "FIRST_CHOICE_GK_OUT"; teamId: number; teamName: string; playerId: number; playerName: string; stat: { rank: 1; minutes: number; appearances: number } }
  | { code: "DEF_CORE_OUT"; teamId: number; teamName: string; players: Array<{ playerId: number; playerName: string; position?: string }>; stat: { count: number } }
  | { code: "ATTACK_CORE_OUT"; teamId: number; teamName: string; players: Array<{ playerId: number; playerName: string; position?: string }>; stat: { count: number } };
