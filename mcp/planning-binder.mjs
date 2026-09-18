function exact(items, name) {
  return items.find(item => item.name === name) ?? null;
}

function roadScore(road, districtKind, targetWidth) {
  let score = Math.abs(Number(road.width_m ?? targetWidth) - targetWidth) * 8;
  if (road.one_way) score += 40;
  if (road.includes_parking) score += 8;
  if (road.uses_highway_rules) score += 100;
  if (road.structure_type !== 'standard') score += 100;
  const name = String(road.name ?? '').toLowerCase();
  if (districtKind === 'industrial') {
    if (name.includes('medium') || name.includes('large')) score -= 12;
    if (name.includes('alley') || name.includes('gravel')) score += 25;
  } else {
    if (name === 'alley') score -= 16;
    if (name.includes('gravel')) score += 12;
    if (name.includes('highway') || name.includes('large') || name.includes('xl')) score += 35;
  }
  return score;
}

function zoneMatchesKind(zone, districtKind) {
  if (districtKind === 'office') return zone.office === true;
  if (districtKind === 'industrial') return zone.area_type === 'Industrial' && zone.office !== true;
  const expected = districtKind[0].toUpperCase() + districtKind.slice(1);
  return zone.area_type === expected && zone.office !== true;
}

function zoneCandidates(zoneTypes, preferences) {
  const density = preferences.density ?? 'low';
  const districtKind = preferences.district_kind ?? 'residential';
  const configuredStyle = preferences.theme_preference ?? 'auto';
  const cityTheme = String(preferences.city_theme ?? '').toLowerCase();
  const themeStyle = cityTheme.includes('north american') ? 'na' : cityTheme.includes('european') ? 'eu' : 'auto';
  const style = configuredStyle === 'auto' ? themeStyle : configuredStyle;
  const excluded = ['waterfront', 'mixed', 'old town', 'row', 'lowrent'];
  return zoneTypes.filter(zone => !zone.locked && zoneMatchesKind(zone, districtKind))
    .filter(zone => Number(zone.max_height ?? 0) > 0)
    .filter(zone => String(zone.name).toLowerCase().includes(density))
    .filter(zone => !excluded.some(word => String(zone.name).toLowerCase().includes(word)))
    .filter(zone => !['residential', 'commercial'].includes(districtKind) || style === 'auto' || String(zone.name).toLowerCase().startsWith(`${style.toLowerCase()} `));
}

export function bindGridProposal(proposalInput, catalogs = {}, preferences = {}) {
  const proposal = structuredClone(proposalInput);
  const grid = proposal.plan?.grids?.[0];
  if (!grid) throw new Error('A grid proposal is required for prefab binding.');
  const roadPrefabs = catalogs.road_prefabs ?? [];
  const zoneTypes = catalogs.zone_types ?? [];
  const districtKind = preferences.district_kind ?? grid.zone_kind ?? 'residential';

  let road = null;
  let roadBinding;
  if (preferences.road_prefab) {
    road = exact(roadPrefabs, preferences.road_prefab);
    roadBinding = road && !road.locked
      ? { status: 'bound', source: 'explicit', name: road.name, candidates: [road.name] }
      : { status: 'not_found', source: 'explicit', name: null, candidates: [] };
  } else {
    const ranked = roadPrefabs.filter(item => !item.locked && item.zoning_enabled && !item.bridge_prefab)
      .map(item => ({ item, score: roadScore(item, districtKind, Number(grid.road_width_m ?? 8)) }))
      .sort((left, right) => left.score - right.score || left.item.name.localeCompare(right.item.name));
    road = ranked[0]?.item ?? null;
    roadBinding = road
      ? { status: 'bound', source: 'auto', name: road.name, candidates: ranked.slice(0, 5).map(entry => entry.item.name) }
      : { status: 'not_found', source: 'auto', name: null, candidates: [] };
  }

  let zone = null;
  let zoneBinding;
  if (preferences.zone_type) {
    zone = exact(zoneTypes, preferences.zone_type);
    zoneBinding = zone && !zone.locked && zoneMatchesKind(zone, districtKind)
      ? { status: 'bound', source: 'explicit', name: zone.name, candidates: [zone.name] }
      : { status: 'not_found', source: 'explicit', name: null, candidates: [] };
  } else {
    const candidates = zoneCandidates(zoneTypes, { ...preferences, district_kind: districtKind });
    if (candidates.length === 1) {
      zone = candidates[0];
      zoneBinding = { status: 'bound', source: preferences.theme_preference === 'auto' && preferences.city_theme ? 'city_theme' : 'auto', name: zone.name, candidates: [zone.name] };
    } else {
      zoneBinding = { status: candidates.length ? 'ambiguous' : 'not_found', source: 'auto', name: null, candidates: candidates.map(item => item.name) };
    }
  }

  if (road) {
    grid.road_prefab = road.name;
    if (Number.isFinite(Number(road.width_m)) && Number(road.width_m) > 0) grid.road_width_m = Number(road.width_m);
  }
  if (zone) grid.zone_type = zone.name;
  const bindingsReady = Boolean(road && zone);
  const previewDraft = bindingsReady ? {
    origin: grid.origin, columns: grid.columns, rows: grid.rows,
    block_width_m: grid.block_width_m, block_height_m: grid.block_height_m,
    road_prefab: road.name, zone_type: zone.name,
    auto_connect: true, connection_search_radius_m: 96, minimum_connections: 1, maximum_connections: 2,
    depth_cells: 6, overwrite: true, survey_mode: 'full', check_conflicts: true, clearance_m: 16,
  } : null;

  return {
    ...proposal,
    plan: proposal.plan,
    bindings: { road: roadBinding, zone: zoneBinding, city_theme: preferences.city_theme ?? null },
    bindings_ready: bindingsReady,
    missing_bindings: [!road ? 'road_prefab' : null, !zone ? 'zone_type' : null].filter(Boolean),
    preview_draft: previewDraft,
    construction_ready: false,
    notes: bindingsReady
      ? 'Exact live names are bound. The draft still requires native preview and explicit construction authorization.'
      : 'Binding is incomplete or ambiguous. Select an exact live candidate before native preview.',
  };
}
