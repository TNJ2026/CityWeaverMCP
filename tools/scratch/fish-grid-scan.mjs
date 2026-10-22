// Scan Game.Simulation.NaturalResourceSystem grid for fish concentration
// around a world-space window, print compact ASCII map + top cells.
// Usage: node fish-grid-scan.mjs [minX maxX minZ maxZ]
import { spawn } from 'node:child_process';

const NODE = process.execPath;
const SERVER = 'D:/Develop/game/CityWeaverMCP/mcp/server.mjs';

const minX = Number(process.argv[2] ?? 2800);
const maxX = Number(process.argv[3] ?? 3400);
const minZ = Number(process.argv[4] ?? 2500);
const maxZ = Number(process.argv[5] ?? 3000);

const WORLD = 14336, RES = 256, CELL = WORLD / RES; // 56m
const gxOf = (x) => Math.floor((x + WORLD / 2) / CELL);
const gzOf = (z) => Math.floor((z + WORLD / 2) / CELL);
const wxOf = (gx) => -WORLD / 2 + (gx + 0.5) * CELL;
const wzOf = (gz) => -WORLD / 2 + (gz + 0.5) * CELL;

const gx0 = Math.max(0, gxOf(minX)), gx1 = Math.min(RES - 1, gxOf(maxX));
const gz0 = Math.max(0, gzOf(minZ)), gz1 = Math.min(RES - 1, gzOf(maxZ));

const child = spawn(NODE, [SERVER], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
const pending = new Map();
let nextId = 1;

child.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function call(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

async function tool(name, args) {
  const res = await call('tools/call', { name, arguments: args });
  const text = res?.content?.[0]?.text;
  return text ? JSON.parse(text) : res;
}

const fish = new Map(); // "gx,gz" -> {base, used}

async function main() {
  await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fish-grid-scan', version: '1.0.0' },
  });
  await call('notifications/initialized', {}).catch(() => {});

  // read full rows gz0..gz1 in pages of 1024
  const startOffset = gz0 * RES;
  const endOffset = (gz1 + 1) * RES;
  for (let off = startOffset; off < endOffset; off += 1024) {
    const limit = Math.min(1024, endOffset - off);
    const r = await tool('read_environment_grid', {
      system: 'Game.Simulation.NaturalResourceSystem',
      offset: off,
      limit,
    });
    const items = r?.data?.cells?.items ?? [];
    for (let i = 0; i < items.length; i++) {
      const index = off + i;
      const gx = index % RES, gz = Math.floor(index / RES);
      if (gx < gx0 || gx > gx1) continue;
      const c = items[i];
      fish.set(`${gx},${gz}`, { base: c.m_Fish.m_Base, used: c.m_Fish.m_Used });
    }
  }

  // ASCII map: rows gz0 (top=north? print gz ascending) ; scale chars by base
  const scale = ' .:-=+*#%@';
  let maxBase = 0;
  for (const v of fish.values()) maxBase = Math.max(maxBase, v.base);
  console.log(`window x[${wxOf(gx0).toFixed(0)}..${wxOf(gx1).toFixed(0)}] z[${wzOf(gz0).toFixed(0)}..${wzOf(gz1).toFixed(0)}] maxFishBase=${maxBase}`);
  console.log('    ' + Array.from({ length: gx1 - gx0 + 1 }, (_, i) => String(wxOf(gx0 + i).toFixed(0)).padStart(6)).join(''));
  for (let gz = gz0; gz <= gz1; gz++) {
    let row = String(wzOf(gz).toFixed(0)).padStart(4) + ' ';
    for (let gx = gx0; gx <= gx1; gx++) {
      const v = fish.get(`${gx},${gz}`) ?? { base: 0, used: 0 };
      const avail = v.base - v.used;
      const ch = maxBase > 0 ? scale[Math.min(9, Math.floor((avail / maxBase) * 9.999))] : ' ';
      row += ` ${ch}${String(avail).padStart(4)}`;
    }
    console.log(row);
  }

  // top cells by available fish
  const tops = [...fish.entries()]
    .map(([k, v]) => ({ k, avail: v.base - v.used, base: v.base, used: v.used }))
    .sort((a, b) => b.avail - a.avail)
    .slice(0, 15);
  console.log('\nTOP cells (avail=base-used):');
  for (const t of tops) {
    const [gx, gz] = t.k.split(',').map(Number);
    console.log(`  (${wxOf(gx).toFixed(0)}, ${wzOf(gz).toFixed(0)}) avail=${t.avail} base=${t.base} used=${t.used}`);
  }
  child.kill();
  process.exit(0);
}

main().catch((e) => { console.error('FAIL', e); child.kill(); process.exit(1); });
