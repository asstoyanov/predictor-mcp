import { NextResponse } from "next/server";
import { PredictInputSchema, predict1x2 } from "@predictor/core";

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = PredictInputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = predict1x2(parsed.data);
  return NextResponse.json(result);
}
