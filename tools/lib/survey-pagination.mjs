export async function readAllSurfaceWaterCells(queryGame, args, pageSize = 1024) {
  const cells = [];
  let offset = 0;
  let metadata = null;
  for (;;) {
    const response = await queryGame('read_surface_water_mask', { ...args, offset, limit: pageSize });
    if (!response?.ok) throw new Error(response?.error?.code ?? 'WATER_MASK_FAILED');
    const data = response.data ?? {};
    metadata ??= data;
    cells.push(...(data.cells ?? []));
    if (data.next_offset == null) break;
    const next = Number(data.next_offset);
    if (!Number.isInteger(next) || next <= offset) throw new Error('WATER_MASK_PAGINATION_INVALID');
    offset = next;
  }
  return { ...metadata, cells };
}

export async function readAllOwnedTiles(queryGame) {
  const response = await queryGame('list_map_tiles', { state: 'owned', offset: 0, limit: 529 });
  if (!response?.ok) throw new Error(response?.error?.code ?? 'TILE_QUERY_FAILED');
  return response.data?.items ?? [];
}
