// 生成器输出的精简摘要：只打印未通过的检查与关键核算，避免刷屏。
//   node tools/scratch/generate-pentagon-city-plan.mjs | node tools/scratch/summarize-pentagon-plan.mjs
let raw = '';
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  const report = JSON.parse(raw);
  const accounting = report.accounting ?? {};
  console.log(JSON.stringify({
    ok: report.ok,
    plan_id: report.plan_id,
    bounds: report.bounds,
    failed_checks: (report.checks ?? []).filter(check => !check.ok),
    checks: (report.checks ?? []).map(check => `${check.ok ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`),
    people: accounting.people,
    people_range: accounting.people_range,
    households: accounting.households,
    household_by_kind: accounting.household_by_kind,
    zone_count: accounting.zone_count,
    building_count: accounting.building_count,
    road_count: accounting.road_count,
    road_length_m: accounting.road_length_m,
    road_segment_m: accounting.road_segment_m,
    pentagon_area_m2: accounting.pentagon_area_m2,
    density_people_per_km2: accounting.density_people_per_km2,
    sector_block_histogram: accounting.sector_block_histogram,
    notes: report.notes,
  }, null, 2));
});
