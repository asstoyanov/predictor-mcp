import { NextResponse } from "next/server";
import { z } from "zod";
import { findArbitrageForFixture } from "../../_lib/arbitrage.service";

const Q = z.object({
  fixtureId: z.coerce.number().int().positive(),
  minRoi: z.coerce.number().min(0).max(0.5).optional(), // e.g. 0.01 = 1%
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Q.safeParse(Object.fromEntries(url.searchParams.entries()));

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { fixtureId, minRoi } = parsed.data;

  try {
    const data = await findArbitrageForFixture({ fixtureId, minRoi });
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
