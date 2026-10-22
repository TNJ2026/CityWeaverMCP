import { queryGame } from '../../mcp/bridge-client.mjs';
const opId = process.argv[2];
for (let i = 0; i < 40; i++) {
  const res = await queryGame('get_road_operation', { operation_id: opId });
  const d = res.data ?? {};
  if (d.state && d.state !== 'queued' && d.state !== 'executing' && d.state !== 'pending') {
    console.log('state', d.state, 'can_commit', d.can_commit, 'cost', d.cost);
    console.log('errors', JSON.stringify(d.errors ?? d.error));
    console.log('warnings', JSON.stringify(d.warnings ?? null));
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, 120));
}
console.log('timeout');
