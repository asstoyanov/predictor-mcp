// apps/web/app/api/agent/route.ts
import OpenAI from "openai";
import { NextResponse } from "next/server";

import { PREDICTOR_AGENT_SYSTEM_PROMPT, PREDICTOR_AGENT_EXPLAIN_PROMPT } from "../_lib/agentPrompt";
import { predictFixture } from "../_lib/predict.service";
import { getFixtures } from "../_lib/fixtures.service";


export const runtime = "nodejs"; // OpenAI SDK needs Node runtime
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type AgentRequest = {
  message: string;
  mode?: "engine" | "explain";
};

function clampMinEdge(x: unknown, fallback = 0.07) {
    const n = typeof x === "number" ? x : Number(x);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(0.25, n)); // keep sane
  }
  
  function assertYyyyMmDd(s: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Invalid date: ${s}`);
  }
  
  function daysBetween(from: string, to: string) {
    const a = new Date(from + "T00:00:00Z").getTime();
    const b = new Date(to + "T00:00:00Z").getTime();
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
  }
  
  // max 3 days range for fixtures_list (deterministic, no heavy scans)
  const MAX_FIXTURE_RANGE_DAYS = 3;
  

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AgentRequest;

    const userText = (body?.message ?? "").trim();
    if (!userText) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const tools: OpenAI.Responses.Tool[] = [
      {
        type: "function",
        name: "fixtures_list",
        strict: true,
        description:
          "List fixtures for a league and date range. Use this to resolve 'today's games' or find fixtureId(s) before calling predict_fixture.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            leagueKey: { type: "string" },
            season: { type: "integer" },
            from: { type: "string", description: "YYYY-MM-DD" },
            to: { type: "string", description: "YYYY-MM-DD" },
          },
          required: ["leagueKey", "season", "from", "to"],
        },
      },
      {
        type: "function",
        name: "predict_fixture",
        strict: true,
        description:
          "Predict a single fixture and return model + Bet365 odds + computed value edges.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            fixtureId: { type: "integer" },
            minEdge: {
              type: "number",
              description: "Minimum edge filter. Default 0.07.",
            },
          },
          required: ["fixtureId", "minEdge"],
        },
      },
    ];
    
      

    const mode = body?.mode ?? "engine";
    const systemPrompt =
      mode === "explain" ? PREDICTOR_AGENT_EXPLAIN_PROMPT : PREDICTOR_AGENT_SYSTEM_PROMPT;

    const input: OpenAI.Responses.ResponseInputItem[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ];

    const toolTrace: Array<{
        name: string;
        args: any;
        ok: boolean;
        ms: number;
        error?: string;
      }> = [];

    let lastPredictFixtureToolOutput: any = null;

    // Tool-calling loop (deterministic: no parallel tool calls)
    for (let i = 0; i < 8; i++) {
      const response = await openai.responses.create({
        model: "gpt-5-mini", // you can switch later
        input,
        tools,
        parallel_tool_calls: false,
      });

      // Add model output items to conversation state
      input.push(...(response.output as any));

      // Execute any function calls
      let didCallTool = false;

      for (const item of response.output as any[]) {
        if (item?.type !== "function_call") continue;
      
        didCallTool = true;
      
        // 1) fixtures_list
        if (item.name === "fixtures_list") {
          const args = JSON.parse(item.arguments ?? "{}") as {
            leagueKey: string;
            season: number;
            from: string;
            to: string;
          };
      
          const t0 = Date.now();
          try {
            if (!args?.leagueKey) throw new Error("fixtures_list: missing leagueKey");
            if (!Number.isInteger(args?.season)) throw new Error("fixtures_list: invalid season");
      
            assertYyyyMmDd(args.from);
            assertYyyyMmDd(args.to);
      
            const d = daysBetween(args.from, args.to);
            if (d < 0) throw new Error("fixtures_list: 'to' must be >= 'from'");
            if (d > MAX_FIXTURE_RANGE_DAYS) {
              throw new Error(
                `fixtures_list: date range too large (${d} days). Max is ${MAX_FIXTURE_RANGE_DAYS}.`
              );
            }
      
            const result = await getFixtures({
              leagueKey: args.leagueKey as any,
              season: args.season,
              from: args.from,
              to: args.to,
            });
      
            toolTrace.push({ name: "fixtures_list", args, ok: true, ms: Date.now() - t0 });
      
            input.push({
              type: "function_call_output",
              call_id: item.call_id,
              output: JSON.stringify(result),
            } as any);
          } catch (e: any) {
            toolTrace.push({
              name: "fixtures_list",
              args,
              ok: false,
              ms: Date.now() - t0,
              error: e?.message ?? "tool error",
            });
      
            input.push({
              type: "function_call_output",
              call_id: item.call_id,
              output: JSON.stringify({ error: e?.message ?? "tool error" }),
            } as any);
          }
      
          continue;
        }
      
        // 2) predict_fixture
        if (item.name === "predict_fixture") {
          const args = JSON.parse(item.arguments ?? "{}") as {
            fixtureId: number;
            minEdge?: number;
          };
      
          const t0 = Date.now();
          try {
            const result = await predictFixture({
              fixtureId: args.fixtureId,
              minEdge: clampMinEdge(args.minEdge, 0.07),
            });
      
            toolTrace.push({ name: "predict_fixture", args, ok: true, ms: Date.now() - t0 });

            const injurySummary =
              (result as any)?.injuries?.available
                ? `injuries.available=true; home.outCount=${(result as any)?.injuries?.home?.outCount ?? "n/a"}; away.outCount=${(result as any)?.injuries?.away?.outCount ?? "n/a"}`
                : "injuries.available=false";

                const r: any = result;

                const sanitized =
                  mode === "engine"
                    ? {
                        ...r,
                        injuries: r?.injuries
                          ? {
                              ...r.injuries,
                              home: r.injuries.home
                                ? { ...r.injuries.home, outPlayers: [] }
                                : r.injuries.home,
                              away: r.injuries.away
                                ? { ...r.injuries.away, outPlayers: [] }
                                : r.injuries.away,
                            }
                          : r?.injuries,
                        _agentMeta: { injurySummary },
                      }
                    : {
                        ...r, // full data including player names
                        _agentMeta: { injurySummary },
                      };

                
                lastPredictFixtureToolOutput = sanitized;
      
            input.push({
              type: "function_call_output",
              call_id: item.call_id,
              output: JSON.stringify(sanitized),
              // output: JSON.stringify({ ...result, _agentMeta: { injurySummary } }),
            } as any);
          } catch (e: any) {
            toolTrace.push({
              name: "predict_fixture",
              args,
              ok: false,
              ms: Date.now() - t0,
              error: e?.message ?? "tool error",
            });
      
            input.push({
              type: "function_call_output",
              call_id: item.call_id,
              output: JSON.stringify({ error: e?.message ?? "tool error" }),
            } as any);
          }
      
          continue;
        }
      
        // 3) unknown tool
        input.push({
          type: "function_call_output",
          call_id: item.call_id,
          output: JSON.stringify({ error: `Unknown tool: ${item.name}` }),
        } as any);
      }
      

      // If no tool calls were made, we should have a final answer in response.output_text
      if (!didCallTool) {
        return NextResponse.json({
          text: response.output_text ?? "",
          responseId: response.id,
          toolTrace,
          // debug: {
          //   predictFixtureHasAgentMeta: Boolean(lastPredictFixtureToolOutput?._agentMeta),
          //   injurySummary: lastPredictFixtureToolOutput?._agentMeta?.injurySummary ?? null,
          // },
        });
      }
    }

    return NextResponse.json(
      { error: "Agent exceeded tool loop limit" },
      { status: 500 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Agent error" },
      { status: 500 }
    );
  }
}
