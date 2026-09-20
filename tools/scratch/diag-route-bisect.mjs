// 二分诊断 preview_road_route：逐个加长折线，找出被拒的点数/位置。
import { queryGame } from '../../mcp/bridge-client.mjs';

const X = 128;
const zs = [-1440, -1600, -1760, -1920, -2080, -2240];
const sleep = ms => new Promise(res => setTimeout(res, ms));

async function tryRoute(zList, tag) {
  const made = await queryGame('preview_road_route', {
    request_id: `diag-route-${tag}`,
    road_prefab: 'Small Road',
    points: zList.map(z => ({ x: X, z })),
  });
  const op0 = made.data ?? {};
  let state = op0.state;
  let info = { cost: op0.cost, err: op0.error, edges: op0.segments?.length };
  for (let k = 0; k < 12 && state !== 'preview_ready' && state !== 'failed'; k++) {
    await sleep(250);
    const g = await queryGame('get_road_operation', { operation_id: op0.operation_id });
    state = g.data?.state;
    info = { cost: g.data?.cost, err: g.data?.error, errors: g.data?.errors, edges: g.data?.segments?.length };
  }
  console.log(`${tag} (z ${zList[0]}..${zList[zList.length - 1]}, ${zList.length} 点): ${state} ${JSON.stringify(info)}`);
  if (state === 'preview_ready') await queryGame('cancel_road_preview', { operation_id: op0.operation_id });
  return state;
}

// 判别实验：显式把交叉点写进折线（5 点，含 -1664 与 -1904 两个交叉）
await tryRoute([-1600, -1664, -1760, -1904, -1920], 'e-显式交叉点');
// 对照：同样范围但不带交叉点路标
await tryRoute([-1600, -1760, -1920], 'f-不带路标');
