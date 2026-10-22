import { queryGame } from '../../mcp/bridge-client.mjs';

const names = ['Hospital01', 'SmallCoalPowerPlant01', 'Landfill01', 'WindTurbine02', 'GroundwaterPumpingStation01', 'WelfareOffice01', 'College01', 'SewageOutlet01'];
for (const n of names) {
  try {
    const r = await queryGame('list_building_prefabs', { search: n, kind: 'all', unlocked_only: false, offset: 0, limit: 100 });
    const item = (r.data?.items ?? []).find(i => i.name === n);
    if (!item) { console.log(n.padEnd(30), 'NOT FOUND'); continue; }
    console.log(n.padEnd(30), 'cost=' + item.construction_cost,
      'size=' + JSON.stringify(item.size_m),
      'lot=' + JSON.stringify(item.lot_size),
      'requires_road=' + item.requires_road,
      'flags=' + JSON.stringify(item.placement_flags ?? item.placement_mode));
  } catch (e) { console.log(n.padEnd(30), 'ERR', e.code); }
}
