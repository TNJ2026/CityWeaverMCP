// Ownership/availability comes from native ContentPrefab.IsAvailable, not lock state.
export function planningContentDecision(prefab) {
  if (prefab?.locked) return { allowed: false, reason: 'locked' };
  const source = prefab?.source;
  if (!source || source.requirements_complete !== true || source.content_available == null || source.category === 'unknown')
    return { allowed: false, reason: 'content_unknown' };
  if (source.content_available !== true) return { allowed: false, reason: 'content_unavailable' };
  if (source.is_builtin_asset !== true || source.is_subscribed_mod !== false || !['dlc', 'no_declared_requirement'].includes(source.category))
    return { allowed: false, reason: 'not_builtin_or_dlc' };
  return { allowed: true, reason: source.category === 'dlc' ? 'available_dlc' : 'builtin_without_requirement' };
}
