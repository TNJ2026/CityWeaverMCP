import { validateCityPlan } from '../../mcp/planning-validator.mjs';

const testPlan = {
  grids: [
    {
      id: 'grid-com',
      origin: { x: 384, z: 832 },
      columns: 2,
      rows: 1,
      block_width_m: 96,
      block_height_m: 96,
      road_prefab: 'Small Road',
      zone_type: 'EU Commercial High',
      zone_kind: 'commercial'
    },
    {
      id: 'grid-off',
      origin: { x: 384, z: 736 },
      columns: 2,
      rows: 1,
      block_width_m: 96,
      block_height_m: 96,
      road_prefab: 'Small Road',
      zone_type: 'Office High',
      zone_kind: 'office'
    }
  ],
  roads: [],
  buildings: [],
  zones: [],
  tracks: [],
  utilities: []
};

const bounds = { min_x: -1500, max_x: 1500, min_z: -900, max_z: 2800 };
const result = validateCityPlan({ bounds }, testPlan, bounds);
console.log('Result:', result.valid, 'errors:', result.error_count, 'warnings:', result.warning_count);
for (const issue of result.issues) {
  console.log(issue);
}
