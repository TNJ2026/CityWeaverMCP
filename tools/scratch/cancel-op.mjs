import { queryGame } from '../../mcp/bridge-client.mjs';
const id = process.argv[2];
try { const r = await queryGame('cancel_road_preview', { operation_id: id }); console.log('cancelled', JSON.stringify(r.data).slice(0, 300)); }
catch (e) { console.log('ERR', e.code, e.message); }
