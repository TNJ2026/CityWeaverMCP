import { BridgeError } from './bridge-client.mjs';
import { contentHash } from './planning-store.mjs';

const catalogTools = new Set(['list_road_prefabs', 'list_building_prefabs', 'list_city_service_prefabs', 'list_transport_facility_prefabs', 'list_utility_facility_prefabs', 'list_utility_network_prefabs', 'list_zone_types', 'list_transport_track_prefabs', 'list_waterway_prefabs']);
const invalidatingWrites = /^(unlock_|set_city_configuration$|set_experience_points$|set_development_points$|purchase_development_node$)/;
const catalogFailure = /PREFAB.*(?:NOT_FOUND|LOCKED|MISMATCH)|(?:BUILDING_CATEGORY|NETWORK_TYPE|ZONE_THEME)_MISMATCH|ZONE_TYPE_(?:NOT_FOUND|LOCKED)/;
const sessionFailure = /^(CITY_SESSION_CHANGED|CITY_NOT_READY|GAME_UNAVAILABLE|BRIDGE_NOT_FOUND)$/;
const services = new WeakMap();
const sessionOf = r => r?.meta?.session_id ?? r?.data?.session_id ?? null;

/** Session-local observations, not a persistent static-asset authority. */
export function createPrefabCatalog(queryGame, { now = Date.now, ttlMs = 30000, negativeTtlMs = 5000, maxEntries = 512 } = {}) {
  let session = null, generation = 0;
  const cache = new Map(), pending = new Map(), geometry = new Map();
  const stats = { hits: 0, misses: 0, shared_queries: 0, invalidations: 0, discarded: 0 };
  const rawQuery = queryGame;
  stats.bridge_queries = 0; stats.bridge_duration_ms = 0;
  queryGame = async (...args) => {
    stats.bridge_queries++;
    const started = performance.now();
    try { return await rawQuery(...args); }
    finally { stats.bridge_duration_ms += performance.now() - started; }
  };
  function invalidateSession(nextSession = session) {
    if (nextSession !== session) geometry.clear();
    generation++; session = nextSession; cache.clear(); pending.clear(); stats.invalidations++;
  }
  function observe(response) {
    const actual = sessionOf(response);
    if (actual && actual !== session) invalidateSession(actual);
    if (response?.data?.city_loaded === false) invalidateSession(null);
  }
  async function query(tool, args = {}, { force_refresh = false } = {}) {
    if (!catalogTools.has(tool)) {
      // Invalidate before a mutation, including ambiguous/timeout outcomes.
      if (invalidatingWrites.test(tool)) invalidateSession();
      const started = generation;
      try {
        const response = await queryGame(tool, args);
        if (started === generation) observe(response);
        if (catalogFailure.test(JSON.stringify({ error: response?.data?.error, errors: response?.data?.errors, code: response?.error?.code }))) invalidateSession();
        return response;
      } catch (error) {
        if (sessionFailure.test(error.code ?? '')) invalidateSession(null);
        else if (catalogFailure.test(error.code ?? '')) invalidateSession();
        throw error;
      }
    }
    const defaults = tool === 'list_road_prefabs' ? { search: '', offset: 0, limit: 50 } : tool === 'list_zone_types' ? { search: '', unlocked_only: true } : {};
    args = { ...defaults, ...Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) };
    if (!session) {
      const response = await queryGame('get_game_status', {});
      observe(response);
      if (!session) throw new BridgeError('CITY_NOT_READY', 'A city session is required for prefab caching.');
    }
    if (force_refresh) invalidateSession();
    const started = generation, expectedSession = session;
    const key = `${session}:${tool}:${contentHash(args)}`;
    const entry = cache.get(key);
    if (entry && now() < entry.expires) { stats.hits++; return structuredClone(entry.response); }
    if (pending.has(key)) { stats.shared_queries++; return structuredClone(await pending.get(key)); }
    stats.misses++;
    const task = (async () => {
      const response = await queryGame(tool, args);
      if (started !== generation || sessionOf(response) !== expectedSession) {
        stats.discarded++;
        // A late response never switches the cache back to an old session.
        if (started === generation && sessionOf(response)) invalidateSession(sessionOf(response));
        throw new BridgeError('CATALOG_CHANGED_DURING_QUERY', 'Session or cache generation changed; discard this catalog result.');
      }
      const data = response.data;
      const items = data?.items;
      const geometryFields = ['width_m', 'size_m', 'lot_cells', 'placement', 'placement_flags', 'placement_mode', 'requires_road', 'connection_layers', 'max_length_m', 'max_slope', 'elevation_range_m', 'lanes', 'one_way'];
      for (const item of items ?? []) {
        const identity = `${tool}:${item.name}`;
        const hash = contentHash(Object.fromEntries(geometryFields.filter(k => Object.hasOwn(item, k)).map(k => [k, item[k]])));
        if (geometry.has(identity) && geometry.get(identity) !== hash) {
          geometry.set(identity, hash);
          invalidateSession();
          throw new BridgeError('CATALOG_GEOMETRY_CHANGED', `Prefab geometry changed for ${item.name}; revalidate the approved plan before continuing.`);
        }
        geometry.set(identity, hash);
        while (geometry.size > maxEntries * 20) geometry.delete(geometry.keys().next().value);
      }
      const complete = data?.truncated !== true && data?.next_offset == null && (!Number.isFinite(data?.total) || (args.offset ?? 0) + (items?.length ?? 0) >= data.total);
      const empty = Array.isArray(items) && items.length === 0;
      if (response.ok !== false && Array.isArray(items) && (!empty || complete)) {
        // Filtered and locked observations expire quickly; never cache errors as absence.
        const lifetime = empty || args.unlocked_only === true || items.some(x => x.locked === true) ? negativeTtlMs : ttlMs;
        cache.delete(key);
        cache.set(key, { response: structuredClone(response), expires: now() + lifetime });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      }
      return response;
    })();
    pending.set(key, task);
    try { return structuredClone(await task); }
    catch (error) {
      if (started === generation && sessionFailure.test(error.code ?? '')) invalidateSession(null);
      throw error;
    }
    finally { if (pending.get(key) === task) pending.delete(key); }
  }
  async function exact(tool, name, args = {}, options = {}) {
    let offset = 0;
    const seen = new Set();
    for (let pages = 0; pages < 100; pages++) {
      const response = await query(tool, { ...args, search: name, offset, limit: 100 }, { force_refresh: pages === 0 && options.force_refresh });
      const data = response.data ?? {};
      const matches = (data.items ?? []).filter(x => x.name === name);
      if (matches.length > 1) throw new BridgeError('AMBIGUOUS_PREFAB', 'Multiple entries have the same exact prefab name.');
      if (matches.length) return matches[0];
      let next = data.next_offset;
      if (next == null && Number.isFinite(data.total) && offset + (data.items?.length ?? 0) < data.total) next = offset + (data.items?.length ?? 0);
      if (next == null) {
        if (data.truncated) throw new BridgeError('INCOMPLETE_CATALOG', 'Truncated catalog cannot establish prefab absence.');
        return null;
      }
      if (next <= offset || seen.has(next)) throw new BridgeError('INCOMPLETE_CATALOG', 'Catalog pagination did not advance.');
      seen.add(next); offset = next;
    }
    throw new BridgeError('INCOMPLETE_CATALOG', 'Catalog pagination limit reached.');
  }
  return {
    query, exact, invalidateSession,
    refreshDynamicState: () => invalidateSession(),
    getRoad: (name, options) => exact('list_road_prefabs', name, {}, options),
    getBuilding: (category, name, options) => {
      const tool = { building: 'list_building_prefabs', city_service: 'list_city_service_prefabs', transport_facility: 'list_transport_facility_prefabs', utility_facility: 'list_utility_facility_prefabs' }[category];
      if (!tool) throw new BridgeError('INVALID_CATEGORY', 'Explicit prefab category required.');
      return exact(tool, name, { kind: category === 'building' ? 'building' : 'all', unlocked_only: false }, options);
    },
    getUtility: (name, options) => exact('list_utility_network_prefabs', name, { network_type: 'all', unlocked_only: false, include_markers: false }, options),
    getZone: (name, options) => exact('list_zone_types', name, { unlocked_only: false }, options),
    resolveMany: requests => Promise.all(requests.map(r => exact(r.tool, r.name, r.args, r))),
    inspect: () => ({ session_id: session, generation, entries: cache.size, pending: pending.size, ttl_ms: ttlMs, negative_ttl_ms: negativeTtlMs, ...stats, persistence: 'process_session_only', revision_source: 'none' }),
  };
}

export function prefabCatalogFor(queryGame) {
  if (!services.has(queryGame)) {
    const service = createPrefabCatalog(queryGame);
    services.set(queryGame, service);
    services.set(service.query, service);
  }
  return services.get(queryGame);
}
export const withPrefabCatalog = queryGame => prefabCatalogFor(queryGame).query;
