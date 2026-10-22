import { queryGame } from '../../mcp/bridge-client.mjs';
const a = JSON.parse(process.argv[2]);
const tool = process.argv[3] || 'preview_road';
const rid = process.argv[4] || 'probe-road-0001';
const res = await queryGame(tool, { ...a, request_id: rid, response_detail: 'full' });
console.log(JSON.stringify(res.data, null, 2).slice(0, 4000));
