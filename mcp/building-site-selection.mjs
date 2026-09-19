// Planning proxies only. Native previews remain the authority for buildability.
const value = n => Number.isFinite(n) ? Math.max(0, n) : 0;

export function siteProfile(category, prefab) {
  if (category === 'city_service') {
    if (prefab.kind === 'education') return 'education';
    if (prefab.kind === 'garbage') return 'separation';
    return 'coverage';
  }
  if (category === 'transport_facility') return prefab.cargo || prefab.depot ? 'engineering' : 'transport';
  if (category === 'utility_facility') return prefab.kind === 'sewage' ? 'separation' : 'engineering';
  return prefab.placement?.unique ? 'attraction' : 'engineering';
}

export function rankBuildingSites(candidates, impacts, { category, prefab, radius = 500, strategy = 'greedy' }) {
  const profile = siteProfile(category, prefab);
  const requiredMetric = { coverage: 'uncovered_residential_buildings', education: 'matching_students_in_range',
    transport: 'residential_buildings_in_range', attraction: 'nearby_buildings', separation: 'residential_buildings_in_range' }[profile];
  const fallback = strategy !== 'greedy' || profile === 'engineering' ||
    impacts.some(impact => !impact || impact.unavailable ||
      !Number.isFinite(impact[requiredMetric]));
  // Never compare measured benefits with silently assumed zero benefits on failed reads.
  return candidates.map((candidate, index) => {
    const impact = impacts[index];
    const nativeScore = Number.isFinite(candidate.score) ? candidate.score : value(candidate.distance_from_request_m);
    const engineeringPenalty = nativeScore / Math.max(1, radius);
    let benefit = 0;
    let model = 'native_site_score';
    if (!fallback) {
      if (profile === 'coverage') {
        benefit = Math.log1p(value(impact.uncovered_households) + value(impact.uncovered_residential_buildings));
        model = 'marginal_residential_coverage_proxy';
      } else if (profile === 'education') {
        const schools = (impact.schools ?? []).filter(s => s.education_level === prefab.education_level);
        // Students include enrolled students; subtract total matching capacity,
        // not just spare seats, or enrolled demand would be counted twice.
        const capacity = schools.reduce((sum, school) => sum + value(school.student_capacity), 0);
        benefit = Math.log1p(Math.min(value(prefab.student_capacity), Math.max(0, value(impact.matching_students_in_range) - capacity)));
        model = 'student_capacity_proxy';
      } else if (profile === 'transport') {
        benefit = Math.log1p(value(impact.residential_buildings_in_range)) / (1 + value(impact.nearby_stop_count)) +
          Math.log1p(value(impact.nearby_waiting_passengers));
        model = 'transport_catchment_proxy';
      } else if (profile === 'attraction') {
        benefit = Math.log1p(value(impact.nearby_buildings)) / (1 + value(impact.nearby_parks) + value(impact.nearby_unique_buildings));
        model = 'attraction_proximity_proxy';
      } else if (profile === 'separation') {
        benefit = -Math.log1p(value(impact.residential_buildings_in_range));
        model = 'residential_exposure_proxy';
      }
    }
    return { candidate, impact, source_index: index, selection: {
      strategy, profile, model, benefit, engineering_penalty: engineeringPenalty,
      score: benefit - engineeringPenalty, fallback: fallback && strategy === 'greedy',
      note: fallback ? 'Native site score used; demand metrics are unavailable, disabled, or unsuitable for this prefab.'
        : 'Planning proxy only; native pathfinding, operating state and actual service assignment are not simulated.',
    } };
  }).sort((a, b) => b.selection.score - a.selection.score || a.source_index - b.source_index);
}
