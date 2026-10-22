import { queryGame } from '../../mcp/bridge-client.mjs';
const res = await queryGame('list_road_prefabs', { search: 'Small Road', offset: 0, limit: 100 });
console.log((res.data?.items ?? []).map(i => `${i.name} | locked=${i.locked}`).join('\n'));
