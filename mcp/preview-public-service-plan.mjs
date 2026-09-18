import { queryGame } from './bridge-client.mjs';

const targets = [
  {
    prefab: 'PoliceStation02', domain: 'city_service',
    candidates: [
      { position: { x: -1576, y: 512.0078, z: 535.75 }, rotation_degrees: 0, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:180915:1' },
      { position: { x: -1576, y: 512.0078, z: 508.25 }, rotation_degrees: 180, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:180912:1' },
    ],
  },
  {
    prefab: 'FireHouse02', domain: 'city_service',
    candidates: [
      { position: { x: -1503.99988, y: 512.0078, z: 596.249939 }, rotation_degrees: -179.999969, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:180934:1' },
      { position: { x: -1503.99915, y: 512.0078, z: 504.25 }, rotation_degrees: 180, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:59020:1' },
    ],
  },
  {
    prefab: 'MedicalClinic02', domain: 'city_service',
    candidates: [
      { position: { x: -1431.999, y: 512.0078, z: 600.249939 }, rotation_degrees: 179.999954, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:180934:1' },
      { position: { x: -1367.75012, y: 512.0078, z: 552.0021 }, rotation_degrees: -90.00013, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:180947:1' },
    ],
  },
  {
    prefab: 'Hospital01', domain: 'city_service',
    candidates: [
      { position: { x: -1248.00012, y: 512.0078, z: 620.25 }, rotation_degrees: -179.999985, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:59042:1' },
      { position: { x: -1300.00024, y: 512.0078, z: 620.250061 }, rotation_degrees: 179.999908, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:59041:1' },
    ],
  },
  {
    prefab: 'CityPark03', domain: 'city_service',
    candidates: [
      { position: { x: -1872, y: 512.0078, z: 612.25 }, rotation_degrees: -180, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:59046:1' },
      { position: { x: -1872, y: 512.0078, z: 523.75 }, rotation_degrees: 0.0000125118349, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:59046:1' },
    ],
  },
  {
    prefab: 'CommunityPool01', domain: 'city_service',
    candidates: [
      { position: { x: -927.99884, y: 512.0078, z: 608.249939 }, rotation_degrees: 180, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:59039:1' },
      { position: { x: -927.99884, y: 512.0078, z: 527.749939 }, rotation_degrees: 0, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:59039:1' },
    ],
  },
  {
    prefab: 'BusDepot01', domain: 'transport_facility',
    candidates: [
      { position: { x: -1536, y: 512.0078, z: 1023.75 }, rotation_degrees: 0, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:59816:1' },
      { position: { x: -1280, y: 512.0078, z: 1023.75 }, rotation_degrees: 0, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:54324:1' },
    ],
  },
  {
    prefab: 'Landfill01', domain: 'city_service',
    candidates: [
      { position: { x: -1192.25, y: 512.0078, z: 1271.99976 }, rotation_degrees: 90, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:54322:1' },
      { position: { x: -1192.25012, y: 512.0078, z: 1320.00916 }, rotation_degrees: 90, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:54325:1' },
    ],
  },
  {
    prefab: 'Cemetery02', domain: 'city_service',
    candidates: [
      { position: { x: -1840.00012, y: 512.0078, z: 1108.25 }, rotation_degrees: -180, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:180922:1' },
      { position: { x: -1871.99988, y: 512.0078, z: 1108.25 }, rotation_degrees: -180, road_edge_id: 'c304cbd7c9054a0d9d502dd7a9a95215:180923:1' },
    ],
  },
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(tool, operationId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await queryGame(tool, { operation_id: operationId });
    if (['preview_ready', 'failed', 'cancelled', 'expired', 'outcome_unknown'].includes(response.data?.state)) return response.data;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for preview ${operationId}.`);
}

const status = await queryGame('get_game_status', {});
await queryGame('set_simulation_speed', { speed: 'normal' });
await sleep(400);
await queryGame('set_simulation_speed', { speed: 'paused' });
const results = [];

for (const target of targets) {
  const tools = target.domain === 'transport_facility'
    ? { preview: 'preview_transport_facility_placement', get: 'get_transport_facility_operation', cancel: 'cancel_transport_facility_preview' }
    : { preview: 'preview_city_service_placement', get: 'get_city_service_operation', cancel: 'cancel_city_service_preview' };
  const attempts = [];
  let selected = null;
  for (const [index, candidate] of target.candidates.entries()) {
    const requestId = `planfix-${target.prefab.toLowerCase()}-${index + 1}`;
    const queued = await queryGame(tools.preview, { request_id: requestId, building_prefab: target.prefab, ...candidate });
    const operation = ['preview_ready', 'failed', 'cancelled', 'expired', 'outcome_unknown'].includes(queued.data?.state)
      ? queued.data
      : await waitFor(tools.get, queued.data?.operation_id);
    attempts.push({
      candidate,
      operation_id: operation.operation_id,
      state: operation.state,
      cost: operation.cost,
      warnings: operation.warnings ?? [],
      errors: operation.errors ?? [],
      error: operation.error ?? null,
    });
    if (operation.state === 'preview_ready') {
      await queryGame(tools.cancel, { operation_id: operation.operation_id });
      selected = candidate;
      break;
    }
    if (operation.state === 'outcome_unknown') break;
  }
  results.push({ prefab: target.prefab, domain: target.domain, selected, attempts });
  if (attempts.at(-1)?.state === 'outcome_unknown') break;
}

process.stdout.write(`${JSON.stringify({ city: status.data?.city_name, session_id: status.meta?.session_id, results }, null, 2)}\n`);
