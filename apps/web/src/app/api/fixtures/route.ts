import { NextResponse } from "next/server";
import { z } from "zod";
import { LEAGUES } from "@/lib/leagues";

const InputSchema = z.object({
  leagueKey: z.string(),
  season: z.coerce.number().int().min(1900).max(2100),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(req: Request) {
  const key = process.env.APIFOOTBALL_API_KEY;
  if (!key) return NextResponse.json({ error: "Missing APIFOOTBALL_API_KEY" }, { status: 500 });

  const url = new URL(req.url);
  const parsed = InputSchema.safeParse({
    leagueKey: url.searchParams.get("leagueKey"),
    season: url.searchParams.get("season"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });

  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { leagueKey, season, from, to } = parsed.data;
  const spec = (LEAGUES as any)[leagueKey];
  if (!spec) return NextResponse.json({ error: `Unknown leagueKey: ${leagueKey}` }, { status: 400 });

  const fxUrl = new URL("https://v3.football.api-sports.io/fixtures");
  fxUrl.searchParams.set("league", String(spec.id));
  fxUrl.searchParams.set("season", String(season));
  fxUrl.searchParams.set("from", from);
  fxUrl.searchParams.set("to", to);
  fxUrl.searchParams.set("timezone", "Europe/Sofia");

  const res = await fetch(fxUrl, { headers: { "x-apisports-key": key } });
  const json = await res.json().catch(() => null);

  if (!res.ok) return NextResponse.json({ error: json }, { status: res.status });

  const fixtures = (json?.response ?? []).map((f: any) => ({
    fixtureId: f?.fixture?.id,
    date: f?.fixture?.date,
    status: f?.fixture?.status?.short,
    league: f?.league?.name,
    round: f?.league?.round,
    home: f?.teams?.home?.name,
    away: f?.teams?.away?.name,
  }));

  return NextResponse.json({ count: fixtures.length, fixtures });
}
