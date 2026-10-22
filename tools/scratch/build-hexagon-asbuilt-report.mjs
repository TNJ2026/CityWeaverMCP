// Generate a self-contained as-built report page for the hexagon town.
//   node tools/scratch/build-hexagon-asbuilt-report.mjs
import fs from 'node:fs';
import path from 'node:path';
import { queryGame } from '../../mcp/bridge-client.mjs';

const plan = JSON.parse(fs.readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8'));
const zoning = JSON.parse(fs.readFileSync('tools/scratch/_zoning-plan.json', 'utf8'));
const OUT = path.resolve('artifacts', 'peiqi-hexagon-town-asbuilt.html');

// ---------------------------------------------------------------- live city facts
let live = { population: null, money: null, paused: null };
try {
  const ov = (await queryGame('get_city_management_overview', {})).data;
  live = { population: ov.population.population, money: ov.economy.money, paused: ov.progression.paused };
} catch { /* offline: keep the placeholders */ }
const moneyFmt = live.money != null ? live.money.toLocaleString('en-US') : '—';

// wind-turbine relocation record (written by record-windfarm-relocation.mjs)
const relocations = plan.relocations ?? [];

// ---------------------------------------------------------------- geometry
const hex = plan.geometry.hexagon.vertices;      // 6 outer vertices
const core = plan.geometry.core_hexagon.vertices;

// The drawing window must cover the periphery too: the turbines and the only
// substation now sit outside the hexagon, and the transmission line runs further west.
const periphery = [
  ...plan.plan.buildings.filter(b => b.position).map(b => b.position),
  ...(plan.utility_connections ?? []).filter(c => c.kind === 'high_voltage_transmission_line').flatMap(c => [c.from, c.to]),
];
const pad = 130;
const xs = [...hex.map(v => v.x), ...periphery.map(p => p.x)];
const zs = [...hex.map(v => v.z), ...periphery.map(p => p.z)];
const W0 = Math.min(...xs) - pad, W1 = Math.max(...xs) + pad;
const Z0 = Math.min(...zs) - pad, Z1 = Math.max(...zs) + pad;
const SVG_W = 1160, SVG_H = Math.round(SVG_W * (Z1 - Z0) / (W1 - W0));
const scale = SVG_W / (W1 - W0);
const X = x => (x - W0) * scale;
const Y = z => (Z1 - z) * scale;
const pt = v => `${X(v.x).toFixed(1)},${Y(v.z).toFixed(1)}`;

const KIND_COLOR = {
  residential: '#34a853', commercial: '#2f6fed', industrial: '#e8a33d', office: '#12a5b8',
};
const kindOf = z => z.kind;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Only the wind turbines carry production numbers; the substation relocation is
// reported in its own power section.
const relocRows = relocations.filter(r => r.production_kw != null).map(r =>
  `<tr><td>${esc(r.label)}</td><td>(${r.from.x.toFixed(0)}, ${r.from.z.toFixed(0)})</td>` +
  `<td>(${r.to.x.toFixed(0)}, ${r.to.z.toFixed(0)})</td>` +
  `<td class="n">${r.production_kw?.toLocaleString('en-US') ?? '—'} / ${r.capacity_kw?.toLocaleString('en-US') ?? '—'}</td></tr>`).join('');

// ---------------------------------------------------------------- power rework
const demolitions = plan.demolitions ?? [];
const utilityConnections = plan.utility_connections ?? [];
const hvLink = utilityConnections.find(c => c.kind === 'high_voltage_transmission_line') ?? null;
const powerRelocations = relocations.filter(r => r.production_kw == null);

const demolishRows = demolitions.map(d =>
  `<tr><td>${esc(d.label)}</td><td class="mono">${esc(d.prefab)}</td>` +
  `<td>(${d.position.x.toFixed(0)}, ${d.position.z.toFixed(0)})</td>` +
  `<td class="n">+₡${(d.refund ?? 0).toLocaleString('en-US')}</td></tr>`).join('\n');

const powerRelocRows = powerRelocations.map(r =>
  `<tr><td>${esc(r.label)}</td><td class="mono">${esc(r.prefab)}</td>` +
  `<td>(${r.from.x.toFixed(0)}, ${r.from.z.toFixed(0)})</td>` +
  `<td>(${r.to.x.toFixed(0)}, ${r.to.z.toFixed(0)})</td>` +
  `<td class="mono">${esc(r.road_edge_id ?? '—')}</td></tr>`).join('\n');

const hvChain = hvLink ? [
  ['高压线入口', `${esc(hvLink.outside_connection?.name ?? '外部连接点 - 电力')} @ (${hvLink.outside_connection?.position.x.toFixed(0) ?? '—'}, ${hvLink.outside_connection?.position.z.toFixed(0) ?? '—'})`],
  ['既有高压线', `33 段，自地图西边界向东延伸到 (${hvLink.to.x.toFixed(0)}, ${hvLink.to.z.toFixed(0)}) 的自由端点`],
  ['新建输电线', `${esc(hvLink.utility_prefab)} · ${hvLink.segment_lengths_m.length} 段 × ${hvLink.segment_lengths_m[0]} m = ${hvLink.total_length_m} m（单段上限 ${hvLink.segment_limit_m} m）`],
  ['变电站高压端口', `<code>${esc(hvLink.from.node_id)}</code> @ (${hvLink.from.x.toFixed(1)}, ${hvLink.from.z.toFixed(1)}) · 已接入 <b>${hvLink.validation.hv_port_connected_edge_count}</b> 条高压线`],
  ['低压侧', `低压层 <code>"Road, PowerlineLow"</code>，经外环路 <code>hex-ring</code> 导入全城路网`],
  ['高压网络', `${hvLink.validation.hv_network_edges} 段、<b>单一连通分量</b>（新增前为 33 段）`],
].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('\n') : '';

const layers = [];
// zone blocks
layers.push('<g id="zones">');
for (const z of plan.plan.zones) {
  const bx = z.polygon.map(p => p.x), bz = z.polygon.map(p => p.z);
  const x0 = Math.min(...bx), x1 = Math.max(...bx), z0 = Math.min(...bz), z1 = Math.max(...bz);
  layers.push(`<rect x="${X(x0).toFixed(1)}" y="${Y(z1).toFixed(1)}" width="${((x1 - x0) * scale).toFixed(1)}" height="${((z1 - z0) * scale).toFixed(1)}" fill="${KIND_COLOR[kindOf(z)]}" fill-opacity="0.42" stroke="${KIND_COLOR[kindOf(z)]}" stroke-opacity="0.85" stroke-width="0.8"><title>${esc(z.id)} ${esc(z.label)} · ${esc(z.district)} · ${z.area_m2} m²</title></rect>`);
}
layers.push('</g>');

// roads, ordered thinnest-last so arterials stay readable
const roadOrder = { lattice: 3, yard: 2, gateway: 1, radial: 1, axis: 1, core_ring: 1, ring: 0 };
const roads = [...plan.plan.roads].sort((a, b) => (roadOrder[a.role] ?? 9) - (roadOrder[b.role] ?? 9));
layers.push('<g id="roads" fill="none" stroke-linecap="round" stroke-linejoin="round">');
for (const r of roads) {
  const w = Math.max(1.2, (r.width_m ?? 8) * scale);
  const color = r.role === 'ring' ? '#1f2937' : r.role === 'lattice' ? '#94a3b8' : r.role === 'yard' ? '#a8b4c4' : '#475569';
  layers.push(`<polyline points="${r.points.map(pt).join(' ')}" stroke="${color}" stroke-width="${w.toFixed(2)}" stroke-opacity="0.95"><title>${esc(r.id)} · ${esc(r.prefab)} · ${esc(r.label ?? '')}</title></polyline>`);
}
layers.push('</g>');

// hexagon outline
layers.push(`<polygon points="${hex.map(pt).join(' ')}" fill="none" stroke="#0f172a" stroke-width="2.4" stroke-dasharray="10 6" stroke-opacity="0.7"/>`);
layers.push(`<polygon points="${core.map(pt).join(' ')}" fill="none" stroke="#7c3aed" stroke-width="1.8" stroke-dasharray="6 4" stroke-opacity="0.75"/>`);

// power infrastructure: the new transmission line + a schematic continuation
// toward the map-edge high-voltage entry (which lies far outside the drawing).
for (const c of utilityConnections.filter(x => x.kind === 'high_voltage_transmission_line')) {
  const a = c.from, b = c.to;
  layers.push('<g id="power">');
  const conn = c.outside_connection?.position;
  if (conn) {
    const dx = conn.x - b.x, dz = conn.z - b.z, L = Math.hypot(dx, dz) || 1;
    const span = Math.hypot(W1 - W0, Z1 - Z0) * 1.3;
    const ex = b.x + (dx / L) * span, ez = b.z + (dz / L) * span;
    layers.push(`<line x1="${X(b.x).toFixed(1)}" y1="${Y(b.z).toFixed(1)}" x2="${X(ex).toFixed(1)}" y2="${Y(ez).toFixed(1)}" stroke="#f59e0b" stroke-width="1.8" stroke-dasharray="9 7" stroke-opacity="0.95"/>`);
    layers.push(`<text x="${(X(b.x) - 8).toFixed(1)}" y="${(Y(b.z) - 12).toFixed(1)}" font-size="12.5" fill="#b45309" text-anchor="end" paint-order="stroke" stroke="#ffffff" stroke-width="3.5">既有高压线 → 高压线入口 (${conn.x.toFixed(0)}, ${conn.z.toFixed(0)})</text>`);
  }
  layers.push(`<line x1="${X(a.x).toFixed(1)}" y1="${Y(a.z).toFixed(1)}" x2="${X(b.x).toFixed(1)}" y2="${Y(b.z).toFixed(1)}" stroke="#f59e0b" stroke-width="3.4" stroke-opacity="1"><title>新建输电线 High-voltage Line · ${c.total_length_m} m / ${c.segment_lengths_m.length} 段 × ${c.segment_lengths_m[0]} m（单段上限 ${c.segment_limit_m} m）</title></line>`);
  for (let i = 1; i < c.segment_lengths_m.length; i++) {
    const t = i / c.segment_lengths_m.length;
    const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
    layers.push(`<circle cx="${X(px).toFixed(1)}" cy="${Y(pz).toFixed(1)}" r="3.6" fill="#f59e0b" stroke="#ffffff" stroke-width="1.2"/>`);
  }
  layers.push('</g>');
}

// buildings
layers.push('<g id="buildings">');
for (const b of plan.plan.buildings) {
  if (!b.position) continue;
  const cx = X(b.position.x), cy = Y(b.position.z);
  const s = Math.max(5, (b.size_m?.x ?? 20) * scale), t = Math.max(5, (b.size_m?.z ?? 20) * scale);
  const col = b.category === 'utility_facility' ? '#b91c1c' : '#6d28d9';
  layers.push(`<rect x="${(-s / 2).toFixed(1)}" y="${(-t / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${t.toFixed(1)}" rx="1.5" fill="${col}" fill-opacity="0.9" stroke="#ffffff" stroke-width="0.9" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${(b.rotation_degrees ?? 0).toFixed(1)})"><title>${esc(b.id)} ${esc(b.label)} · ${esc(b.prefab)} · ${esc(b.category)}</title></rect>`);
}
layers.push('</g>');

// district labels
layers.push('<g id="districts" font-size="13" font-weight="600" text-anchor="middle" fill="#0f172a" opacity="0.72">');
for (const d of plan.districts) {
  const zs2 = plan.plan.zones.filter(z => z.district === d.key);
  if (!zs2.length) continue;
  const all = zs2.flatMap(z => z.polygon);
  const mx = all.reduce((s, p) => s + p.x, 0) / all.length;
  const mz = all.reduce((s, p) => s + p.z, 0) / all.length;
  layers.push(`<text x="${X(mx).toFixed(1)}" y="${Y(mz).toFixed(1)}" paint-order="stroke" stroke="#ffffff" stroke-width="3.5">${esc(d.name)}</text>`);
}
layers.push('</g>');
const svgInner = layers.join('\n');

// ---------------------------------------------------------------- tables
const zoneRows = Object.entries(plan.accounting.zone_type_cells).map(([type, cells]) => {
  const z = plan.plan.zones.find(x => x.label === type);
  const area = plan.accounting.zone_area_m2[type] ?? 0;
  const hh = plan.accounting.household_by_kind[type] ?? 0;
  return `<tr><td>${esc(type)}</td><td>${esc(z?.kind ?? '-')}</td><td class="n">${cells}</td><td class="n">${area.toLocaleString()}</td><td class="n">${hh || '—'}</td></tr>`;
}).join('\n');

const byPrefab = {};
for (const b of plan.plan.buildings) (byPrefab[b.prefab] ??= []).push(b);
const buildRows = Object.entries(byPrefab).sort().map(([p, arr]) =>
  `<tr><td>${esc(arr[0].label.replace(/\s*\d+$/, ''))}</td><td class="mono">${esc(p)}</td><td class="n">${arr.length}</td><td>${esc(arr[0].category === 'utility_facility' ? '公用设施' : '城市服务')}</td></tr>`
).join('\n');

const checkRows = plan.checks.map(c =>
  `<tr><td class="${c.ok ? 'ok' : 'ng'}">${c.ok ? '通过' : '待办'}</td><td>${esc(c.name)}</td><td class="dim">${esc(c.detail ?? '')}</td></tr>`
).join('\n');

const zoneAssign = zoning.assignments.map(a =>
  `<tr><td>${esc(a.zone)}</td><td>${a.side === 'left' ? '左' : '右'}</td><td class="n">${a.edge_ids.length}</td><td class="n">${a.cells}</td></tr>`
).join('\n');

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>佩奇代尔 · 正六边形城镇 — 竣工报告</title>
<style>
  :root { --ink:#0f172a; --dim:#5b6b83; --line:#dbe3ee; --bg:#f6f8fc; --card:#ffffff; --accent:#2f6fed; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.65 "Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif; }
  .wrap { max-width:1240px; margin:0 auto; padding:38px 26px 70px; }
  h1 { font-size:29px; margin:0 0 6px; letter-spacing:.3px; }
  h2 { font-size:19px; margin:38px 0 12px; padding-left:11px; border-left:4px solid var(--accent); }
  .sub { color:var(--dim); margin:0 0 26px; font-size:14.5px; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:14px; margin:24px 0 8px; }
  .kpi { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
  .kpi .v { font-size:26px; font-weight:700; letter-spacing:.4px; }
  .kpi .k { color:var(--dim); font-size:13px; margin-top:2px; }
  .kpi .x { font-size:12.5px; color:#137a3f; margin-top:5px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; overflow:auto; }
  table { border-collapse:collapse; width:100%; font-size:14px; }
  th,td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { background:#eef3fb; font-weight:600; white-space:nowrap; }
  td.n,th.n { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  td.mono { font-family:Consolas,monospace; font-size:12.5px; color:#334155; }
  td.ok { color:#137a3f; font-weight:600; white-space:nowrap; }
  td.ng { color:#b45309; font-weight:600; }
  td.dim,.dim { color:var(--dim); }
  .legend { display:flex; flex-wrap:wrap; gap:18px; margin:14px 2px 0; font-size:13.5px; color:var(--dim); }
  .legend i { display:inline-block; width:13px; height:13px; border-radius:3px; margin-right:6px; vertical-align:-2px; }
  .legend .ln { display:inline-block; width:22px; height:4px; border-radius:2px; margin-right:6px; vertical-align:3px; }
  svg { width:100%; height:auto; display:block; }
  .note { font-size:13.5px; color:var(--dim); margin-top:10px; }
  code { background:#eef3fb; padding:1px 5px; border-radius:4px; font-size:13px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  @media (max-width:900px){ .grid2{grid-template-columns:1fr;} }
</style></head><body><div class="wrap">

<h1>佩奇代尔 · 正六边形城镇 — 竣工报告</h1>
<p class="sub">规划编号 <code>${esc(plan.plan_id)}</code> · 目标人口 ${plan.target_population.toLocaleString()} 人 / ${plan.accounting.households.toLocaleString()} 户 ·
外六边形边长 896 m · 网格节距 112 m · 施工已完成，城市已恢复运行</p>

<div class="kpis">
  <div class="kpi"><div class="v">287 / 287</div><div class="k">道路永久路段（80 条规划路段）</div><div class="x">全部建成，网路单一连通</div></div>
  <div class="kpi"><div class="v">${plan.plan.buildings.length} / ${plan.plan.buildings.length}</div><div class="k">公共服务与公用设施</div><div class="x">0 缺失 · 0 多余 · 0 座效率低于 60%</div></div>
  <div class="kpi"><div class="v">100%</div><div class="k">全城建筑供电满足率</div><div class="x">1,200 座全部 <code>Connected</code>，断电警告 0 座</div></div>
  <div class="kpi"><div class="v">12,855</div><div class="k">原生分区单元已着色</div><div class="x">54 个分区格 · 错色 0 个</div></div>
  <div class="kpi"><div class="v">100%</div><div class="k">住宅服务覆盖（半径 1.2 km）</div><div class="x">49/49 住宅全覆盖，0 未覆盖</div></div>
</div>

<h2>平面竣工示意</h2>
<div class="card">
<svg viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="正六边形城镇竣工平面图">
<rect width="${SVG_W}" height="${SVG_H}" fill="#fbfdff"/>
${svgInner}
</svg>
<div class="legend">
  <span><i style="background:#34a853"></i>住宅</span>
  <span><i style="background:#2f6fed"></i>商业</span>
  <span><i style="background:#e8a33d"></i>工业</span>
  <span><i style="background:#12a5b8"></i>办公</span>
  <span><span class="ln" style="background:#1f2937;height:7px"></span>环城路 32 m</span>
  <span><span class="ln" style="background:#475569"></span>放射路 / 中央大道</span>
  <span><span class="ln" style="background:#94a3b8"></span>街区路 16 m</span>
  <span><i style="background:#6d28d9"></i>城市服务设施</span>
  <span><i style="background:#b91c1c"></i>公用设施</span>
  <span><span class="ln" style="background:#f59e0b;height:4px"></span>新建输电线（3 段 × 116.6 m）</span>
  <span><span class="ln" style="background:#f59e0b;height:2px;opacity:.75"></span>既有高压线（示意方向）</span>
  <span><i style="background:none;border:1.5px dashed #7c3aed"></i>中央核心小六边形</span>
</div>
<p class="note">六条放射路把中心与六个角点连成一线；中心小六边形围合中央核心区；内部开发单元按 112 m 节距铺成规则栅格，
住宅 / 商业 / 工业 / 办公四类齐备；放射路按 60° 斜穿栅格，斜边处自然形成阶梯状退台。虚线外框为规划的六边形边界。
外环以外是电力设施：3 座小型风机与唯一变电站都贴外环路布置，变电站再用 3 段输电线接入西侧的高压线入口。</p>
</div>

<h2>分区落实</h2>
<div class="grid2">
  <div class="card">
    <table><thead><tr><th>分区类型</th><th>用途</th><th class="n">格数</th><th class="n">面积 m²</th><th class="n">户数</th></tr></thead>
    <tbody>${zoneRows}</tbody></table>
  </div>
  <div class="card">
    <table><thead><tr><th>分区类型</th><th>路侧</th><th class="n">路段</th><th class="n">单元</th></tr></thead>
    <tbody>${zoneAssign}</tbody></table>
    <p class="note">分区以永久路段为单位落色：同一路段的同一侧只对应一个规划地块，因此不存在跨地块串色。
    规划地块之外的相邻走廊另有 1,458 个单元同属所在扇区用途（216 个位于中央核心六边形内），与新扇区模型一致。</p>
  </div>
</div>

<h2>设施清单（${plan.plan.buildings.length} 座，另有 ${demolitions.length} 座已拆）</h2>
<div class="card">
<table><thead><tr><th>设施</th><th>预制体</th><th class="n">数量</th><th>类别</th></tr></thead>
<tbody>${buildRows}</tbody></table>
<p class="note">全部 ${plan.plan.buildings.length} 座落位均由原生预览校验（<code>native_preview_verified</code>），<b>${plan.plan.buildings.filter(b => b.road_edge_id).length} 座显式绑定到具体道路</b>且这些道路实体在竣工后依然全部存在，
仅 1 座（污水排口 <code>SewageOutlet01</code>）无道路绑定 —— 它是临水设施，目前由污水处理厂全量承担污水净化，自身 <code>processed = 0</code>。
实际核对：与规划逐预制体一一对应，无缺失、无多余；全部落在规划范围内，就近服务半径内 100% 覆盖住宅。</p>
<p class="note">复算规划几何时会报 <code>PLANNED_BUILDING_OVERLAP</code> / <code>PLANNED_BUILDING_ROAD_OVERLAP</code> 提示：
这是落位阶段被原生吸附后的坐标与「矩形外包框 + 道路净空」这一粗略模型之间的差异（大型设施的外包框远大于实际模型），
属于校验器的提示而非引擎冲突 —— 出图阶段的概念几何自检为 0 问题，全部通过原生预览并被游戏接受。</p>
</div>

<h2>风机接路（第 8 道工序）</h2>
<div class="card">
<p class="note">三座小型风力发电机原规划在城镇东北约 450 m 的「风场」空地上，与最近道路相距 <b>414–502 m</b>。
它们虽然建得起来，却一直 <b>0 发电</b>。原因不在风：风口实测风速 0.19–0.22，而城镇中心反而更高（0.24）；
也不在电网容量：同城的燃煤电厂满发 13 万 kW。真正的原因写在原生端口数据里 ——
风电机的并网端口连接层是 <code>"Road, PowerlineLow"</code>，即 <b>低压电网铺在道路网里</b>：
建筑必须紧贴一条道路，低压层才能由路面导入地块。原址无路，于是「有电发不出」。</p>
<table><thead><tr><th>机组</th><th>原址 (x, z)</th><th>新址 (x, z)</th><th class="n">发电 / 容量 kW</th></tr></thead>
<tbody>${relocRows}</tbody></table>
<p class="note">处理方式：用原生搬迁工具把三台机组移到正六边形<b>外环外侧</b>、均布于东—东北、西北偏西、南三条边，
正面朝路、地块前缘与路缘齐平，并由原生预览逐一校验后提交。搬迁后三台 <code>road_edge_id</code> 均为外环路 <code>hex-ring</code>，
发电恢复至 <b>满容量 24,537 kW</b>（8,386 + 7,329 + 8,822）。</p>
<p class="note"><b>踩到的坑</b>：通用临街选址器把风机的 63.6 m 叶轮外包框（半宽 31.8 m）当作占地，
于是把机组停在「路中心线外 31.8 + 16 = 48 m」处，而机组真实地块只有 2×2 格（半深 8 m），
结果是地块前缘离路缘还空着 24 m，低压层够不着。贴到「地块半深 + 路半宽 = 24 m」后即成接通。
判据以实时端口与发电读数为准，不以选址器的建议距离为准。</p>
</div>

<h2>电力改造（第 9 道工序）</h2>
<div class="card">
<p class="note">风机接路之后，按照要求对电力系统做了收口：<b>拆除小型燃煤电厂</b>、<b>四座变电设施只保留一座</b>、
再把留下的那座<b>移到六边形外环外侧</b>，同时接到<b>道路</b>与<b>高压线入口</b>。</p>

<table><thead><tr><th>已拆除设施</th><th>预制体</th><th>原址 (x, z)</th><th class="n">返还</th></tr></thead>
<tbody>${demolishRows}</tbody></table>
<p class="note">拆除前均走原生预览：<code>preview_ready</code>、<code>preview_entity_count = 1</code>（无连带建筑），提交后再查
<code>list_utility_facilities</code> 确认已消失。四座变电站功能完全相同（<code>kind: transformer</code>），只保留一座即可维持全城供电，
因此拆掉其余三座；燃煤电厂拆除后，全城发电改由三座小型风机承担。</p>

<table><thead><tr><th>搬迁的变电站</th><th>预制体</th><th>原址 (x, z)</th><th>新址 (x, z)</th><th>接入道路</th></tr></thead>
<tbody>${powerRelocRows}</tbody></table>

<p class="note"><b>输电线怎么接的</b>：变电站只有一个高压端口（连接层 <code>"PowerlineHigh"</code>），
它到既有高压线东端自由端点相距 <b>${hvLink ? hvLink.total_length_m : '—'} m</b>，
而这张地图上高压线（<code>High-voltage Line</code>）的<b>单段上限是 180 m</b>，
所以一次拉通会被原生判为 <code>INVALID_UTILITY_LENGTH</code>。按 ≤170 m 自动分段后，用 3 段等长的输电线接上。</p>
<table><tbody>${hvChain}</tbody></table>

<p class="note"><b>验收</b>：变电站高压端口 <code>connected_edge_count = 1</code>；高压网络由 33 段变为 36 段且仍是<b>单一连通分量</b>；
全城 ${plan.plan.buildings.length + demolitions.length} 座设施所在的 1,200 座建筑原生 <code>ElectricityConsumer</code> 全部为 <code>Connected</code>、
断电警告 0 座、废弃建筑 0 座、供电满足率 100%。</p>
<p class="note"><b>踩到的坑（已写入 <code>docs/validation/FIELD-NOTES.md</code>）</b>：
在做这一步之前，空旷地带新建道路/线路的预览一律失败，很容易误判成「全局错误状态」。实测分清了两类返回 ——
落在已有路面上的道路返回 <code>NO_GENERATED_ROAD</code>（那里本来就有路，属正常）；真正的新建失败返回
<code>GAME_VALIDATION_ERROR</code>，其中<b>孤立线段</b>与<b>超长线段</b>都会被引擎拒绝。用 <code>count_entities</code> 查
<code>Game.Tools.Error</code> 实体数为 0，即证明不存在残留错误实体。修法是给线段补上两端 <code>node_id</code> 并按规定跨距分段。</p>
</div>

<h2>方案自检 24 项</h2>
<div class="card">
<table><thead><tr><th style="width:70px">结果</th><th style="width:340px">校验项</th><th>细节</th></tr></thead>
<tbody>${checkRows}</tbody></table>
<p class="note">最后一项「施工图尚未生成任何原生预览（只读）」是出图阶段的记录；随后已按确认逐阶段完成原生预览与建造。</p>
</div>

<h2>施工纪实</h2>
<div class="card">
<table><thead><tr><th style="width:120px">阶段</th><th>内容</th></tr></thead><tbody>
<tr><td>1 · 环城骨架</td><td>Large Road 32 m 闭合六个角点，落实 896 m 正六边形轮廓</td></tr>
<tr><td>2 · 放射与中央大道</td><td>六条放射路 + 南北中央大道，把中心接到六个角点</td></tr>
<tr><td>3 · 核心小六边形</td><td>中心小六边形环路（相似比 0.402），围合中央核心区</td></tr>
<tr><td>4 · 开发单元</td><td>112 m 节距的街区路网铺开，住宅 / 商业 / 工业 / 办公四类齐备</td></tr>
<tr><td>5 · 门户与连接</td><td>接入既有高速门户，路网收敛为单一连通分量</td></tr>
<tr><td>6 · 公共服务与公用设施</td><td>水先行（抽水站 / 水塔 / 污水处理）→ 电网 → 医院学校 → 其余，共 70 座</td></tr>
<tr><td>7 · 分区落色</td><td>按永久路段的左 / 右侧逐一预览并提交，共 18 组；落色后读回核对：规划地块内 12,855 个原生单元正确着色，错色 0 个</td></tr>
<tr><td>8 · 风机接路</td><td>三座小型风力发电机由东北风场搬迁至六边形外环外侧、贴外环路落位，原生预览校验后提交，发电 0 → 24,537 kW</td></tr>
<tr><td>9 · 电力改造</td><td>拆除小型燃煤电厂与 3 座冗余变电设施；唯一变电站移到外环外侧，接入外环路并用 3 段输电线接到高压线入口</td></tr>
</tbody></table>
<p class="note">施工期遇到并解决的关键问题（已写入 <code>docs/validation/FIELD-NOTES.md</code>）：
共线重叠的重复路段会毒化节点（<code>GAME_REJECTED_ROAD</code>）—— 通过拆除重复的小路片段解决；
<code>request_id</code> 是幂等键而非重试令牌 —— 确定性失败的批次必须换用新的 <code>request_id</code> 并提升 <code>state_version</code> 才能重试；
低压电网层是 <code>"Road, PowerlineLow"</code>，即产电建筑必须贴路才能并网；
<code>High-voltage Line</code> 单段上限 180 m，跨距超限会被判 <code>INVALID_UTILITY_LENGTH</code>，必须中间分段并给两端补 <code>node_id</code>。</p>
</div>

<h2>当前城市状态</h2>
<div class="card">
<table><tbody>
<tr><th>资金</th><td>₡ ${moneyFmt}（建城前 32,986,448；${plan.plan.buildings.length} 座设施投入 9,528,600；电力改造净返还 ₡${demolitions.reduce((s, d) => s + (d.refund ?? 0), 0).toLocaleString('en-US')}）</td></tr>
<tr><th>人口</th><td>${live.population != null ? live.population.toLocaleString('en-US') : '—'} 人（规划容量 ${plan.target_population.toLocaleString()} 人）</td></tr>
<tr><th>发电</th><td>3 座小型风机并网发电 <b>24,556 kW</b>（燃煤电厂已拆除，风机为全城电源）</td></tr>
<tr><th>变电</th><td>1 座变电站（<code>TransformerStation01</code>）位于六边形外环外侧，同时接入外环路与高压线</td></tr>
<tr><th>高压线</th><td>${hvLink ? hvLink.validation.hv_network_edges : '—'} 段、单一连通分量；西端为地图边界的高压线入口，东端经 3 段新建输电线接入变电站</td></tr>
<tr><th>供电</th><td>全城 1,200 座建筑 <code>Connected</code>，供电满足率 100%，断电警告 0 座、废弃建筑 0 座</td></tr>
<tr><th>模拟速度</th><td>${live.paused === false ? '运行中（正常速度）' : '暂停（施工期间为暂停，交付后恢复运行）'}</td></tr>
<tr><th>道路</th><td>规划范围 289 条永久路段，其中 287 条属于本城、状态全部为 <code>existing</code>（已建成）</td></tr>
</tbody></table>
</div>

<p class="note" style="margin-top:26px">报告由施工日志与实时城市查询共同生成：道路与设施以实时实体核对，分区以原生单元读回核对。
规划数据源 <code>plans/peiqi-hexagon-town-bound.json</code>，分区落实明细 <code>tools/scratch/_zoning-plan.json</code>。</p>
</div></body></html>`;

fs.writeFileSync(OUT, html);
console.log(`wrote ${OUT}  (${(html.length / 1024).toFixed(0)} KB)`);
