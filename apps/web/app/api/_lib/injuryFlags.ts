import type { InjuryImpactFlag } from "./injuryTypes";

export function buildInjuryFlags(opts: {
  teamId: number;
  teamName: string;
  outPlayers: Array<{ playerId: number; name: string; position?: string }>;
  leaders: {
    topScorer?: { playerId: number; name: string; goals: number };
    topAssister?: { playerId: number; name: string; assists: number };
    firstChoiceGK?: { playerId: number; name: string; minutes: number; appearances: number };
  };
}) {
  const { teamId, teamName, outPlayers, leaders } = opts;
  const outIds = new Set(outPlayers.map(p => p.playerId));

  const flags: InjuryImpactFlag[] = [];

  if (leaders.topScorer && outIds.has(leaders.topScorer.playerId)) {
    flags.push({
      code: "TOP_SCORER_OUT",
      teamId,
      teamName,
      playerId: leaders.topScorer.playerId,
      playerName: leaders.topScorer.name,
      stat: { rank: 1, goals: leaders.topScorer.goals },
    });
  }

  if (leaders.topAssister && outIds.has(leaders.topAssister.playerId)) {
    flags.push({
      code: "TOP_ASSISTER_OUT",
      teamId,
      teamName,
      playerId: leaders.topAssister.playerId,
      playerName: leaders.topAssister.name,
      stat: { rank: 1, assists: leaders.topAssister.assists },
    });
  }

  if (leaders.firstChoiceGK && outIds.has(leaders.firstChoiceGK.playerId)) {
    flags.push({
      code: "FIRST_CHOICE_GK_OUT",
      teamId,
      teamName,
      playerId: leaders.firstChoiceGK.playerId,
      playerName: leaders.firstChoiceGK.name,
      stat: { rank: 1, minutes: leaders.firstChoiceGK.minutes, appearances: leaders.firstChoiceGK.appearances },
    });
  }

  // Core-out flags (simple heuristic by position string if available)
  const def = outPlayers.filter(p => (p.position ?? "").toLowerCase().includes("back") || (p.position ?? "").toLowerCase().includes("def"));
  const att = outPlayers.filter(p => (p.position ?? "").toLowerCase().includes("forward") || (p.position ?? "").toLowerCase().includes("wing") || (p.position ?? "").toLowerCase().includes("att"));

  if (def.length >= 2) {
    flags.push({
      code: "DEF_CORE_OUT",
      teamId,
      teamName,
      players: def.slice(0, 3).map(p => ({ playerId: p.playerId, playerName: p.name, position: p.position })),
      stat: { count: def.length },
    });
  }

  if (att.length >= 2) {
    flags.push({
      code: "ATTACK_CORE_OUT",
      teamId,
      teamName,
      players: att.slice(0, 3).map(p => ({ playerId: p.playerId, playerName: p.name, position: p.position })),
      stat: { count: att.length },
    });
  }

  return flags;
}
