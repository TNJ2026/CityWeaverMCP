import { queryGame } from '../../mcp/bridge-client.mjs';

async function probe(label, tool, args) {
  try {
    const r = await queryGame(tool, args);
    console.log(label.padEnd(30), 'OK', JSON.stringify(r.data ?? {}).slice(0, 500));
  } catch (e) {
    console.log(label.padEnd(30), 'ERR', e.code, e.message);
  }
}

await probe('get_road_operation {}', 'get_road_operation', {});
await probe('get_road_operation reuse', 'get_road_operation', { operation_id: 'probe-center' });
await probe('cancel_road_preview {}', 'cancel_road_preview', {});
await probe('cancel_road_preview any', 'cancel_road_preview', { operation_id: 'any' });
await probe('preview_road same rid', 'preview_road', { request_id: 'probe-center-cleanup-1', road_prefab: 'Small Road', start: { x: 0, z: 0 }, end: { x: 0, z: 112 } });
