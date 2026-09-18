const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const SERVICE_ROLES = {
  residential: [
    { label: '社区学校预留', size_m: { x: 40, z: 32 } },
    { label: '社区诊所预留', size_m: { x: 36, z: 28 } },
  ],
  commercial: [
    { label: '消防与急救设施预留', size_m: { x: 40, z: 32 } },
    { label: '公共停车与换乘设施预留', size_m: { x: 48, z: 32 } },
  ],
  industrial: [
    { label: '工业消防站预留', size_m: { x: 48, z: 40 } },
    { label: '变电与物流服务设施预留', size_m: { x: 48, z: 40 } },
  ],
  office: [
    { label: '公共交通换乘设施预留', size_m: { x: 40, z: 32 } },
    { label: '社区服务设施预留', size_m: { x: 36, z: 28 } },
  ],
};

function blockCenters(grid) {
  const result = [];
  for (let row = 0; row < grid.rows; row++) for (let column = 0; column < grid.columns; column++) result.push({
    column,
    row,
    x: grid.origin.x + (column + .5) * grid.block_width_m,
    z: grid.origin.z + (row + .5) * grid.block_height_m,
  });
  return result;
}

function distinctIndexes(length, count) {
  if (!length) return [];
  const indexes = [];
  for (let index = 0; index < count; index++) {
    const candidate = Math.min(length - 1, Math.floor((index + 1) * length / (count + 1)));
    if (!indexes.includes(candidate)) indexes.push(candidate);
  }
  for (let index = 0; indexes.length < Math.min(count, length); index++) if (!indexes.includes(index)) indexes.push(index);
  return indexes;
}

export function augmentGridProposal(proposalInput, request = {}) {
  const proposal = structuredClone(proposalInput);
  const plan = proposal.plan ?? (proposal.plan = {});
  const grid = plan.grids?.[0];
  if (!grid) throw new Error('A grid proposal is required for multilayer planning.');
  plan.roads ??= [];
  plan.buildings ??= [];
  plan.zones ??= [];
  plan.tracks ??= [];
  plan.utilities ??= [];

  const districtKind = request.district_kind ?? grid.zone_kind ?? 'residential';
  const profile = request.infrastructure_profile ?? 'complete';
  const includeServices = request.include_service_sites ?? profile === 'complete';
  const includeUtilities = request.include_utility_corridors ?? profile !== 'grid_only';
  const includeTransit = request.include_transit_corridor ?? ['transit_ready', 'complete'].includes(profile);
  const width = finite(grid.columns, 1) * finite(grid.block_width_m, 96);
  const height = finite(grid.rows, 1) * finite(grid.block_height_m, 96);
  const origin = grid.origin;
  const generated = { access_roads: 0, service_sites: 0, utility_corridors: 0, transit_corridors: 0 };

  const connectionPoint = proposal.placement?.connection_point;
  const nearestRoadPoint = proposal.placement?.nearest_road_point;
  if (connectionPoint && nearestRoadPoint && Math.hypot(connectionPoint.x - nearestRoadPoint.x, connectionPoint.z - nearestRoadPoint.z) > 8) {
    plan.roads.push({
      id: 'planned-access-connector', label: '规划道路接入口', prefab: grid.road_prefab,
      level: 'surface', width_m: grid.road_width_m ?? 8,
      planning_status: 'conceptual', points: [connectionPoint, nearestRoadPoint],
    });
    generated.access_roads++;
  }

  if (includeServices) {
    const roles = SERVICE_ROLES[districtKind] ?? SERVICE_ROLES.residential;
    const centers = blockCenters(grid);
    for (const [roleIndex, centerIndex] of distinctIndexes(centers.length, roles.length).entries()) {
      const role = roles[roleIndex];
      const center = centers[centerIndex];
      plan.buildings.push({
        id: `concept-service-${roleIndex + 1}`, label: role.label, kind: 'service', planning_status: 'conceptual',
        position: { x: center.x, z: center.z }, rotation_degrees: 0,
        size_m: {
          x: Math.min(role.size_m.x, Math.max(16, grid.block_width_m - 24)),
          z: Math.min(role.size_m.z, Math.max(16, grid.block_height_m - 24)),
        },
      });
      generated.service_sites++;
    }
  }

  if (includeUtilities) {
    const centerZ = origin.z + Math.round(grid.rows / 2) * grid.block_height_m;
    const centerX = origin.x + Math.round(grid.columns / 2) * grid.block_width_m;
    plan.utilities.push({
      id: 'concept-water-sewage-backbone', label: '规划给排水骨干（地下）', network_type: 'water_sewage',
      level: 'underground', width_m: 2, planning_status: 'conceptual',
      points: [{ x: origin.x, z: centerZ }, { x: origin.x + width, z: centerZ }],
    }, {
      id: 'concept-power-corridor', label: '规划电力接入走廊（连接层待绑定）', network_type: 'electricity',
      level: request.power_level ?? 'surface', width_m: 3, planning_status: 'conceptual',
      points: [{ x: centerX, z: origin.z }, { x: centerX, z: origin.z + height }],
    });
    generated.utility_corridors += 2;
  }

  if (includeTransit) {
    const industrial = districtKind === 'industrial';
    const horizontal = width >= height;
    const inset = Math.min(24, Math.min(width, height) / 6);
    const points = horizontal
      ? [{ x: origin.x + inset, z: origin.z + height / 2 }, { x: origin.x + width - inset, z: origin.z + height / 2 }]
      : [{ x: origin.x + width / 2, z: origin.z + inset }, { x: origin.x + width / 2, z: origin.z + height - inset }];
    plan.tracks.push({
      id: 'concept-transit-corridor', label: industrial ? '规划货运铁路走廊' : '规划地铁走廊（地下）',
      track_type: industrial ? 'train' : 'subway', level: industrial ? 'surface' : 'underground',
      width_m: industrial ? 6 : 4, planning_status: 'conceptual', points,
    });
    generated.transit_corridors++;
  }

  return {
    ...proposal,
    proposal_type: 'multilayer_city_plan',
    infrastructure_profile: profile,
    generated_layers: generated,
    construction_ready: false,
    notes: 'Conceptual multilayer plan. Service sites and network corridors require exact live prefab/port binding and independent native previews before construction.',
  };
}
