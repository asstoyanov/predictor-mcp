import { z } from "zod";

/**
 * Minimal input for a match prediction.
 * (Pure + deterministic; no API calls.)
 */
export const PredictInputSchema = z.object({
  homeTeam: z.string().min(1),
  awayTeam: z.string().min(1),
});

export type PredictInput = z.infer<typeof PredictInputSchema>;

/**
 * MVP placeholder predictor (pure function).
 * Returns 1X2 probabilities that always sum to 1.
 */
export function predict1x2(input: PredictInput) {
  // deterministic “seed” from team names
  const seed =
    [...`${input.homeTeam}|${input.awayTeam}`].reduce(
      (acc, ch) => acc + ch.charCodeAt(0),
      0
    ) % 1000;

  // map seed -> home advantage in [0.40..0.60]
  const home = 0.4 + (seed / 1000) * 0.2;
  const draw = 0.1; // constant for MVP
  const away = 1 - home - draw;

  // normalize to be safe
  const sum = home + draw + away;

  const h = home / sum;
  const d = draw / sum;
  const a = away / sum;

  // sanity check (dev safety)
  const check = h + d + a;
  if (Math.abs(check - 1) > 1e-9) {
    throw new Error("Probabilities do not sum to 1");
  }

  return {
    market: "1x2" as const,
    home: h,
    draw: d,
    away: a,
  };
}

