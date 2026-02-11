import { NextResponse } from "next/server";
import { z } from "zod";
import { predictFixture } from "../_lib/predict.service";

const InputSchema = z.object({
  fixtureId: z.coerce.number().int().positive(),
  minEdge: z.coerce.number().min(0).max(0.5).default(0.05),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = InputSchema.safeParse({
    fixtureId: url.searchParams.get("fixtureId"),
    minEdge: url.searchParams.get("minEdge"),
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const out = await predictFixture(parsed.data);
    return NextResponse.json(out);
  } catch (e: any) {
    // old route returned fxJson directly in { error } when fixtures call failed
    if (e?.message === "API-Football fixtures request failed") {
      return NextResponse.json({ error: e.body ?? null }, { status: e.status ?? 500 });
    }
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
