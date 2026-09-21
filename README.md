# CityWeaver

English | [简体中文](README.zh-CN.md)

CityWeaver is a Cities: Skylines II code mod and local MCP bridge for inspecting, planning, and building in a live city. The game mod runs inside the game; a separate Node.js STDIO MCP server connects your agent to it. The mod does not call a model API on its own.

The optional [cities-skylines2 skill](skills/cities-skylines2/SKILL.md) provides tool routing and operating safeguards for Agent clients that support compatible skills. Its [English planning and construction guide](skills/cities-skylines2/references/planning-construction.en.md) covers the core write-safety workflow. Install and invoke the skill according to your client's instructions (`$cities-skylines2` is one invocation example); it does not replace the mod or MCP server. See the [documentation index](docs/README.md) and [MCP guide](mcp/README.md) for the complete workflows. The available tool list comes from the connected server's runtime `tools/list`, not a fixed list in this README.

## Main features

| Category | Main capabilities | Guide |
| --- | --- | --- |
| Live city inspection | Connection and session status, city summary, entity queries, component schemas, and detailed data reads | [Inspection](docs/guides/inspection/DEEP-QUERY-GUIDE.md) |
| Planning and construction maps | Survey purchased land, terrain, water, and existing infrastructure; render interactive plans and separate plans from native previews and permanent work | [Planning maps](docs/guides/planning/PLANNING-MAP-GUIDE.md) |
| Roads and street grids | Preview and build roads, junctions, rings, and connected grids; inspect lanes, traffic, parking, and road zoning cells | [Roads](docs/guides/roads/ROAD-GUIDE.md) |
| Buildings and upgrades | Discover live prefabs, site and preview buildings, apply changes, read back permanent entities, and manage supported building areas | [Buildings](docs/guides/buildings/BUILDING-GUIDE.md) |
| Maps, districts, and zoning | Inspect map tiles and buildable land; create districts and apply or inspect zoning by road-side cells | [Map and areas](docs/guides/areas/MAP-AREA-GUIDE.md) · [Zoning](docs/guides/areas/ZONING-GUIDE.md) |
| Utilities | Inspect and connect electricity, water, sewage, and other supported networks and facilities | [Utility infrastructure](docs/guides/transport/UTILITY-INFRASTRUCTURE-GUIDE.md) |
| Public services | Site and manage education, healthcare, emergency, waste, deathcare, parks, postal, and other supported facilities | [City services](docs/guides/city/CITY-SERVICE-GUIDE.md) |
| Public transport | Plan and manage lines, stops, depots, stations, and supported rail, metro, tram, and waterway infrastructure | [Lines](docs/guides/transport/TRANSPORT-GUIDE.md) · [Infrastructure](docs/guides/transport/TRANSPORT-INFRASTRUCTURE-GUIDE.md) |
| City management | Read demand, population, jobs, budgets, policies, progress, and related economic data; use supported management operations | [Development](docs/guides/city/DEVELOPMENT-GUIDE.md) · [Economy](docs/guides/economy/ECONOMY-GUIDE.md) |
| Environment and disasters | Survey terrain, resources, wind, pollution, weather, and water; inspect and manage supported disaster workflows | [Environment](docs/guides/areas/ENVIRONMENT-LANDSCAPE-GUIDE.md) · [Disasters](docs/guides/disasters/DISASTER-GUIDE.md) |

Some tools are read-only, while others change the city and spend in-game funds. Availability depends on the loaded game, unlocks, and runtime capabilities. Native preview and permanent readback are required for construction; see the linked guides for limits and in-game validation status.

## Quick start

The player setup uses the game mod from Paradox Mods and the separate local MCP server from this repository. The mod is **not yet listed on Paradox Mods**; until it is available, build the game mod using [Develop from this repository](#develop-from-this-repository) below. Once it is listed, let a local Agent handle the MCP setup and checks wherever its tools allow:

1. Subscribe to and enable **CityWeaver** in the game's Paradox Mods interface, restart the game if prompted, and load a playable city. If your Agent can control the game UI, you may ask it to help; otherwise do this part yourself. The published mod installs only the in-game bridge, not the MCP server or AI client, and does **not** require the code-modding toolchain or .NET SDK.
2. In an Agent client with local command access, send the [MCP setup prompt](#example-prompts). Give it the path to an existing checkout or ask it to obtain the [CityWeaverMCP repository](https://github.com/TNJ2026/CityWeaverMCP). Have the Agent check or install Node.js 20+, install MCP dependencies, resolve `mcp/server.mjs`, and configure a local STDIO MCP server named `cities-skylines2` (command `node`, sole argument: the script's **absolute path**). If the Agent cannot change the client's settings or complete an installation, it should give you the exact remaining steps. For manual setup, run from the repository root:

   ```powershell
   npm --prefix .\mcp ci
   (Resolve-Path .\mcp\server.mjs).Path
   ```

   The exact settings UI or config format depends on the client. For example, in Codex:

   ```powershell
   $mcpServer = (Resolve-Path .\mcp\server.mjs).Path
   codex mcp add cities-skylines2 -- node $mcpServer
   ```

3. Send the Agent the [connection prompt](#example-prompts). Have it reconnect or restart its MCP client if needed, discover the live tools, call `get_game_status`, and report whether the city session is ready. If connection fails, send the [troubleshooting prompt](#example-prompts); the Agent can also run `node .\mcp\query.mjs get_game_status` from the repository root to distinguish client configuration from the game bridge. The Agent should ask you only for actions it cannot perform itself.

The mod creates and discovers a local connection credential automatically. Do not commit or share `bridge.json` or its token. See the [MCP guide](mcp/README.md) for troubleshooting and further commands.

## Example prompts

The first three prompts also work before the MCP server is connected. Replace `<repository path>` with your local checkout path, or tell the Agent to obtain the repository from the link above. The server uses STDIO: the Agent client starts `node` when it opens the MCP connection; do not run `node mcp/server.mjs` as a separate background service. Add “Use the `$cities-skylines2` skill” if you installed the optional skill. Ask the agent to discover coordinates, roads, zone names, and building prefabs from the current city rather than guessing them.

**Set up and start the MCP server**

> On this Windows PC, the CityWeaverMCP repository is at `<repository path>`; if it is not present, obtain it from https://github.com/TNJ2026/CityWeaverMCP in a new user-writable folder without overwriting existing files. Check that Node.js 20+ is installed; install it if your environment permits, otherwise tell me the required action. Install MCP dependencies with `npm --prefix .\mcp ci` from the repository root if needed, and resolve the absolute path to `mcp/server.mjs`. Configure this Agent client to launch a local STDIO MCP server named `cities-skylines2` with command `node` and that absolute path as its sole argument. If you cannot change this client's MCP settings, show me the exact values to enter. Restart or reconnect the MCP client as needed. Do not build or redeploy the game mod, change the city, or print connection tokens.

**Connect to the game**

> Connect to the configured `cities-skylines2` MCP server, discover its available tools, then call `get_game_status`. Confirm that the game bridge is reachable and a playable city session is loaded; report the city name and session status. If the MCP tools are missing, tell me whether the client needs an MCP reconnect or restart. Read only; do not change the city.

**Troubleshoot an MCP connection failure**

> Diagnose the CityWeaver MCP connection on this Windows PC without changing the city. Check, in order: Node.js version and the configured `node` command; the absolute `mcp/server.mjs` path and installed dependencies; whether the Agent client actually launched the STDIO server and exposes its tools; `node .\mcp\query.mjs get_game_status` from the repository root; whether Cities: Skylines II has the CityWeaver mod enabled and a city loaded; and whether the local `bridge.json` file exists. Do not display or share the file contents or token. Distinguish MCP configuration/launch errors from game-bridge and city-not-ready errors, report the evidence and the smallest safe fix, and ask before rebuilding or redeploying the mod.

**Connection and read-only status**

> Use CityWeaver MCP to check the game connection, city session, map theme, population, funds, and simulation speed. Read only; do not modify the city.

**City diagnosis**

> Analyze current residential, employment, and commercial demand, finances, healthcare capacity, and the most congested roads. Show the supporting data and prioritize possible fixes. Do not build anything yet.

**Planning map and grid preview**

> Within purchased land only, plan a 2×3 low-density residential grid. Inspect terrain, water, existing roads, connection points, and budget; produce a construction plan and run native previews. Do not commit construction or buy map tiles.

**Public-service siting**

> Based on current population, live prefab discovery, and the road network, find a road-connected site for one medical clinic. Check its full footprint and upgrade reserve, cost, collisions, and service coverage. Show candidates and a preview only; wait for my confirmation before construction.

**Phased construction**

> Build roads and service facilities from the approved construction plan, in phases and within purchased land. For every change, run a native preview, wait until it is ready, and check cost, collisions, and errors. If valid, apply it, wait for completion, and read back the permanent objects. On failed, expired, or outcome_unknown, stop and investigate the original operation; do not blindly retry with a new request_id. Do not add money or buy map tiles. Report actual cost and remaining funds after each phase.

**Bus-only transit planning**

> Read existing roads and residential and employment locations. Plan bus stops and a round-trip line only; do not build rail transit. Check stop-road attachment, route reachability, and budget, then show a preview and explain how to verify operations. Do not apply yet.

A ready preview, submitted request, or completed operation is not proof that long-term city outcomes have been achieved. Recheck population, happiness, pollution, and traffic after simulation runs. See the [planning map guide](docs/guides/planning/PLANNING-MAP-GUIDE.md) and [operation and transaction guide](docs/workflows/operations.md).

## What is included

- `src/`: game-side mod code for inspection, roads, buildings, zoning, maps, transport, utilities, city services, economy, population, disasters, and planning. See the [source layout](src/README.md).
- `mcp/`: the local Node.js STDIO MCP server, diagnostics, and tests. See the [MCP guide](mcp/README.md).
- `tools/`: planning, spatial inspection, grid deployment, rules, and test utilities. See the [tools guide](tools/README.md).
- `docs/`: detailed workflows and feature guides, starting at the [documentation index](docs/README.md).
- `CityWeaver.csproj` and `build.ps1`: the official build/post-processing and deployment workflow.
- `Properties/`: Paradox Mods publishing metadata; see the [publishing guide](docs/workflows/publishing.md).

The planning tools can produce SVG/interactive construction maps from purchased land, water, slope, and existing infrastructure. Planning output, native preview, and permanent construction are separate stages. The MCP server also covers prefab discovery, road grids, zoning, public services, utilities, transit, and many read-only city diagnostics. Tool-specific requirements and validation status are documented in the linked guides; a successful build or interface test does not imply in-game placement has been verified.

## Develop from this repository

To modify the game mod, work from a source checkout of this repository. Install the official Cities: Skylines II code-modding toolchain, .NET SDK 8, and the .NET 6 runtime required by the official post-processor. These development dependencies are **not** required when installing a published mod from Paradox Mods. Install Node.js 20 or newer for MCP development and tests.

Edit `src/` for game-side code and `mcp/` for the local server; consult the linked guides before changing tool behavior. MCP-only changes do not require rebuilding the game mod.

Save your city and exit the game before deploying a local build. Do not enable the Paradox Mods copy and a locally deployed CityWeaver copy at the same time.

```powershell
.\build.ps1 -Configuration Release
# Build to artifacts/staged without deploying while the game is running:
.\build.ps1 -Stage
```

The normal build runs the official Mod Post Processor and deploys to `%USERPROFILE%\AppData\LocalLow\Colossal Order\Cities Skylines II\Mods\CityWeaver`. The official deployment replaces that mod directory, so keep your source checkout elsewhere. The game may lock the DLL while running; save and exit before deploying.

After building, launch or restart the game and check that CityWeaver appears in the settings menu. Load a city and use the read-only connection prompt above. For automated MCP tests, run `npm --prefix .\mcp ci` first, then `npm --prefix .\mcp test`; for live checks, see [MCP testing and diagnostics](mcp/README.md). Current coverage and known in-game validation gaps are recorded in [validation notes](docs/validation/VALIDATION.md).

The mod is not published on Paradox Mods yet. Follow the [publishing guide](docs/workflows/publishing.md) when preparing a release, and provide a separate download location for the MCP service.
