import fs from "node:fs";

const SDK_BASE = "file:///D:/Develop/game/CityWeaverMCP/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm";
const { Client } = await import(`${SDK_BASE}/client/index.js`);
const { StdioClientTransport } = await import(`${SDK_BASE}/client/stdio.js`);

const cfg = JSON.parse(fs.readFileSync("C:/Users/cheng/.workbuddy/mcp.json", "utf8"));
const s = cfg.mcpServers["cities-skylines2"];
console.log("[layer1] exe exists:", fs.existsSync(s.command), "| server exists:", fs.existsSync(s.args[0]));

const client = new Client({ name: "wb-verify", version: "0.0.1" });
const transport = new StdioClientTransport({ command: s.command, args: s.args, cwd: "/" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  console.log("[layer2] handshake OK, tools:", names.length);
  console.log("[layer2] sample:", names.slice(0, 8).join(", "), "...");

  const has = names.includes("get_game_status");
  if (!has) throw new Error("get_game_status not registered");
  const res = await client.callTool({ name: "get_game_status", arguments: {} });
  const text = (res.content || []).map((c) => c.text).join("\n");
  console.log("[layer3] get_game_status ->", text.slice(0, 600));
  console.log("VERIFY: PASS");
} catch (e) {
  console.error("VERIFY: FAIL -", e.message);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
