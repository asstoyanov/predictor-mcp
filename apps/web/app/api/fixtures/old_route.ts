import { NextResponse } from "next/server";
import { z } from "zod";
import { LEAGUES } from "../../../src/lib/leagues";

const CACHE_TTL_MS = 60_000; // 60s
const fixturesCache = new Map<string, { at: number; data: any }>();


const InputSchema = z.object({
  leagueKey: z.string().min(1),
  season: z.coerce.number().int().min(1900).max(2100),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(req: Request) {
  const apiKey = process.env.APIFOOTBALL_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing APIFOOTBALL_API_KEY in apps/web/.env.local" }, { status: 500 });
  }

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

  const { leagueKey, season, from, to } = parsed.data;

  const cacheKey = `${leagueKey}|${season}|${from}|${to}`;
  const now = Date.now();

  const hit = fixturesCache.get(cacheKey);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...hit.data, cached: true });
  }


  const spec = (LEAGUES as any)[leagueKey];
  if (!spec?.id) {
    return NextResponse.json({ error: `Unknown leagueKey: ${leagueKey}` }, { status: 400 });
  }

  const fxUrl = new URL("https://v3.football.api-sports.io/fixtures");
  fxUrl.searchParams.set("league", String(spec.id));
  fxUrl.searchParams.set("season", String(season));
  fxUrl.searchParams.set("from", from);
  fxUrl.searchParams.set("to", to);
  fxUrl.searchParams.set("timezone", "Europe/Sofia");

  const res = await fetch(fxUrl.toString(), {
    headers: { "x-apisports-key": apiKey },
    // avoid Next caching during dev
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    return NextResponse.json(
      { error: "API-Football request failed", status: res.status, body: json },
      { status: res.status }
    );
  }

  const fixtures = (json?.response ?? []).map((f: any) => ({
    fixtureId: f?.fixture?.id,
    date: f?.fixture?.date,
    status: f?.fixture?.status?.short,
    league: f?.league?.name,
    round: f?.league?.round,
    home: f?.teams?.home?.name,
    away: f?.teams?.away?.name,
  }));

  const payload = { count: fixtures.length, fixtures, cached: false };
  fixturesCache.set(cacheKey, { at: now, data: payload });
  return NextResponse.json(payload);

}
