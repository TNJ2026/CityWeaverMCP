import { queryGame } from '../../mcp/bridge-client.mjs';

const pts = [];
const labels = [];
// 失败走廊：x=160, z=-1260..-1100
for (let z = -1260; z <= -1100; z += 8) { pts.push({ x: 160, z }); labels.push('fail x160 z' + z); }
// 对照：成功路段 x=160, z=-1696..-1584（已建成）
for (let z = -1700; z <= -1580; z += 8) { pts.push({ x: 160, z }); labels.push('ok   x160 z' + z); }

const res = await queryGame('sample_terrain', { points: pts });
const samples = res.data?.samples ?? res.data?.points ?? res.data?.heights ?? res.data;
console.log('keys', Object.keys(res.data ?? {}));
if (Array.isArray(samples)) {
  let prev = null;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const h = typeof s === 'number' ? s : (s.height_m ?? s.height ?? s.y ?? s.elevation_m);
    const d = prev === null ? 0 : Math.abs(h - prev);
    console.log(labels[i].padEnd(22), 'h=' + Number(h).toFixed(3), 'slope_8m=' + d.toFixed(3));
    prev = h;
  }
} else {
  console.log(JSON.stringify(res.data, null, 2).slice(0, 2000));
}
