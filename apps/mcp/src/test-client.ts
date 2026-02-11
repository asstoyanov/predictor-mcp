import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "./node_modules/.bin/tsx",
    args: ["src/index.ts"],
    env: process.env,
  });

  const client = new Client(
    { name: "mcp-test-client", version: "0.0.1" },
    { capabilities: {} }
  );

  await client.connect(transport);

  const tools = await client.listTools();
  console.log("tools:", tools.tools.map((t) => t.name));

  const res = await client.callTool({
    name: "match.predict",
    arguments: { input: { homeTeam: "Barcelona", awayTeam: "River Plate" } },
  });

  const fx = await client.callTool({
    name: "fixtures.list",
    arguments: { input: { leagueKey: "epl", season: 2025, from: "2026-02-01", to: "2026-02-07" } },
  });

  const edge = await client.callTool({
    name: "odds.edge_fixture",
    arguments: { input: { fixtureId: 1379216, minEdge: 0.05 } },
  });
  console.log("edge_fixture:", edge);
  
  

  const byFx = await client.callTool({
    name: "match.predict_fixture",
    arguments: { input: { fixtureId: 1379216 } },
  });

  const mk = await client.callTool({
    name: "match.predict_markets",
    arguments: { input: { fixtureId: 1379216 } },
  });
  

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
