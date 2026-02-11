import { NextResponse } from "next/server";
import { z } from "zod";
import { getFixtures } from "../_lib/fixtures.service";
import type { LeagueKey } from "../../../src/lib/leagues";

const InputSchema = z.object({
  leagueKey: z.custom<LeagueKey>(),
  season: z.coerce.number().int().min(1900).max(2100),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = InputSchema.safeParse({
    leagueKey: url.searchParams.get("leagueKey"),
    season: url.searchParams.get("season"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    return NextResponse.json(await getFixtures(parsed.data));
  } catch (e: any) {
    if (e?.message?.startsWith("Unknown leagueKey")) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e?.message === "API-Football request failed") {
      return NextResponse.json(
        { error: e.message, status: e.status, body: e.body },
        { status: e.status ?? 500 }
      );
    }
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
