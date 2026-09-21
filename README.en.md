# CityWeaver

[简体中文](README.md) | English

CityWeaver is a Cities: Skylines II code mod and local MCP bridge for inspecting, planning, and building in a live city. The game mod runs inside the game; a separate Node.js STDIO MCP server connects your agent to it. The mod does not call a model API on its own.

The optional [cities-skylines2 skill](skills/cities-skylines2/SKILL.md) provides tool routing and operating safeguards. It can be installed in your personal skills directory and invoked explicitly with `$cities-skylines2`, but it does not replace the mod or MCP server. See the [documentation index](docs/README.md) and [MCP guide](mcp/README.md) for the complete workflows. The available tool list comes from the connected server's runtime `tools/list`, not a fixed list in this README.

## Quick start

CityWeaver has not yet been published to Paradox Mods. To use the source checkout:

1. Install the official Cities: Skylines II code-modding toolchain, .NET SDK 8, and Node.js 20 or newer. Save your city and exit the game, then run `./build.ps1 -Configuration Release` from the repository root. This builds and deploys the game mod to your Cities: Skylines II user directory. `./build.ps1 -Stage` only stages build artifacts; it does **not** install the mod.
2. From PowerShell in the repository root, install the MCP server dependencies and register the server with Codex:

   ```powershell
   $mcpServer = Join-Path (Get-Location).Path 'mcp\server.mjs'
   npm --prefix .\mcp ci
   codex mcp add cities-skylines2 -- node $mcpServer
   ```

   For another MCP-compatible client, configure a STDIO server with `node` as the command and the **absolute path** to `mcp/server.mjs` as its argument. Installing the game mod alone does not install this server.
3. Start the game and load a playable city. Ask your agent to check the CityWeaver connection and game status without changing the city. If the new tools are not visible, restart the MCP connection or client. You can also run `node .\mcp\query.mjs get_game_status` from the repository root to check the local bridge.

The mod creates and discovers a local connection credential automatically. Do not commit or share `bridge.json` or its token. See the [MCP guide](mcp/README.md) for troubleshooting and further commands.

## Example prompts

Send these to an agent with the MCP server connected. Add “Use the `$cities-skylines2` skill” if you installed the optional skill. Ask the agent to discover coordinates, roads, zone names, and building prefabs from the current city rather than guessing them.

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

## Build and verify

```powershell
.\build.ps1 -Configuration Release
# Build to artifacts/staged without deploying while the game is running:
.\build.ps1 -Stage
```

The normal build runs the official Mod Post Processor and deploys to `%USERPROFILE%\AppData\LocalLow\Colossal Order\Cities Skylines II\Mods\CityWeaver`. The official deployment replaces that mod directory, so keep your source checkout elsewhere. The game may lock the DLL while running; save and exit before deploying.

After building, launch or restart the game and check that CityWeaver appears in the settings menu. Load a city and use the read-only connection prompt above. For automated MCP tests, run `npm --prefix .\mcp test`; for live checks, see [MCP testing and diagnostics](mcp/README.md). Current coverage and known in-game validation gaps are recorded in [validation notes](docs/validation/VALIDATION.md).

The mod is not published on Paradox Mods yet. Follow the [publishing guide](docs/workflows/publishing.md) when preparing a release, and provide a separate download location for the MCP service.
