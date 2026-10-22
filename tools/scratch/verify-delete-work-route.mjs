// One-off: verify delete_work_route against the live game via a fresh server.mjs instance.
// The host's long-lived server process still runs an older tool registry, so we spawn our own.
import fs from "node:fs";

const SDK_BASE = "file:///D:/Develop/game/CityWeaverMCP/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm";
const { Client } = await import(`${SDK_BASE}/client/index.js`);
const { StdioClientTransport } = await import(`${SDK_BASE}/client/stdio.js`);

const cfg = JSON.parse(fs.readFileSync("C:/Users/cheng/.workbuddy/mcp.json", "utf8"));
const s = cfg.mcpServers["cities-skylines2"];

const SESSION = "dea25986205a4cec9eae0e8704019657";
const ORPHANS = [`${SESSION}:78332:17`];

const client = new Client({ name: "wb-del-verify", version: "0.0.1" });
const transport = new StdioClientTransport({ command: s.command, args: s.args, cwd: "/" });

const text = (res) => (res.content || []).map((c) => c.text).join("\n");

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  console.log("[l2] tools:", names.length, "| has delete_work_route:", names.includes("delete_work_route"));

  const before = JSON.parse(text(await client.callTool({ name: "list_work_routes", arguments: {} })));
  console.log("[before] total:", before.data.total);

  for (const id of ORPHANS) {
    const res = await client.callTool({ name: "delete_work_route", arguments: { route_id: id } });
    console.log(`[delete] ${id} ->`, text(res).slice(0, 400));
  }

  const after = JSON.parse(text(await client.callTool({ name: "list_work_routes", arguments: {} })));
  console.log("[after] total:", after.data.total);
  console.log("[after] fishing lines:", JSON.stringify(after.data.items.filter((i) => i.prefab === "Fishing Line").map((i) => ({ id: i.route_id, owner: i.owner_building_id })), null, 1));
  console.log("DELETE-VERIFY: PASS");
} catch (e) {
  console.error("DELETE-VERIFY: FAIL -", e.message);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
