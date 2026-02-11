import { NextResponse } from "next/server";
import { z } from "zod";
import type { LeagueKey } from "../../../src/lib/leagues";
import { scanFixtures } from "../_lib/scan.service";

const InputSchema = z.object({
  leagueKey: z.custom<LeagueKey>(),
  season: z.coerce.number().int().min(1900).max(2100),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

  minEdge: z.coerce.number().min(0).max(0.5).default(0.05),

  // Optional filters
  onlyValue: z.coerce.boolean().optional(),
  minOdds: z.coerce.number().min(1).max(1000).optional(),
  market: z.enum(["all", "1x2", "btts", "ou25", "draw"]).optional(),

  // Perf controls
  concurrency: z.coerce.number().int().min(1).max(12).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const q = (key: string) => sp.get(key) ?? undefined;

  const parsed = InputSchema.safeParse({
    leagueKey: q("leagueKey"),
    season: q("season"),
    from: q("from"),
    to: q("to"),

    minEdge: q("minEdge"),

    onlyValue: q("onlyValue"),
    minOdds: q("minOdds"),
    market: q("market"),

    concurrency: q("concurrency"),
    limit: q("limit"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const out = await scanFixtures(parsed.data);
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
