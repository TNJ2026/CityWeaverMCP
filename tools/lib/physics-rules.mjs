/**
 * CityWeaver Game Physics & Geometry Rules Engine
 * 
 * Solidifies Cities: Skylines II mechanics, spatial grid constants,
 * slope physics, fluid pollution dispersion, and utility networks.
 */

// === 1. Fundamental Constants ===

export const CELL_SIZE = 8.0; // 1 CS2 grid cell = 8m x 8m
export const MAX_ZONING_DEPTH_CELLS = 6; // Max zoning depth = 6 cells
// 6 cells * 8m = 48m，量自「路面外缘」而非中心线。
// 依据：反编译 Game.Zones.BlockSystem 把块中心放在 道路外缘 + 24m(=3格, 块深一半)，
// 且 block.m_Size.y 恒为 6；沿线格宽同为 8m，单块最长 10 格(80m)、至少 2 格(16m)。
export const MAX_ZONING_DEPTH_M = 48.0;
// 两条对开道路“路缘到路缘”96m 时进深刚好背靠背对接；换算中心线间距要加两条半宽。
export const OPTIMAL_BLOCK_WIDTH_M = 96.0; // 2 * 48m = 12 cells (100% zoning efficiency)
export const OPTIMAL_BLOCK_WIDTH_NOTE = 'edge-to-edge gap; centreline = 96 + (W1 + W2) / 2';
export const OPTIMAL_RESIDENTIAL_BLOCK_HEIGHT_M = 160.0; // 20 cells
export const OPTIMAL_COMMERCIAL_BLOCK_HEIGHT_M = 96.0; // 12 cells

export const MAX_ROAD_SEGMENT_LENGTH_M = 200.0; // Safe threshold before curvature/sag
export const MIN_ROAD_SEGMENT_LENGTH_M = 16.0; // Recommended minimum segment length
export const ABSOLUTE_MIN_ROAD_LENGTH_M = 8.0; // Engine hard minimum
export const SNAP_TOLERANCE_M = 8.0; // Auto-merge radius for road nodes

// Road specifications dictionary
export const ROAD_SPECIFICATIONS = {
  'Small Road': {
    width_m: 16.0,
    cells_width: 2,
    lanes: 2,
    max_slope_percent: 15.0,
    speed_kmh: 50,
    has_low_voltage: true,
    has_water_pipes: true,
    noise_radius_m: 10.0
  },
  'Medium Road': {
    width_m: 24.0,
    cells_width: 3,
    lanes: 4,
    max_slope_percent: 15.0,
    speed_kmh: 60,
    has_low_voltage: true,
    has_water_pipes: true,
    noise_radius_m: 30.0
  },
  'Large Road': {
    width_m: 32.0,
    cells_width: 4,
    lanes: 6,
    max_slope_percent: 15.0,
    speed_kmh: 60,
    has_low_voltage: true,
    has_water_pipes: true,
    noise_radius_m: 45.0
  },
  'Highway': {
    width_m: 24.0,
    cells_width: 3,
    lanes: 3,
    max_slope_percent: 10.0,
    speed_kmh: 100,
    has_low_voltage: false, // High-speed corridors lack pedestrian and under-road utility zoning
    has_water_pipes: false,
    noise_radius_m: 60.0
  },
  'Train Track': {
    width_m: 10.0,
    cells_width: 1.25,
    lanes: 2,
    max_slope_percent: 5.0,
    speed_kmh: 120,
    has_low_voltage: false,
    has_water_pipes: false,
    noise_radius_m: 50.0
  }
};

// Pollution and environmental dispersion parameters
export const POLLUTION_RULES = {
  air_cone_half_angle_deg: 30.0, // Air pollution dispersion cone: +/- 30 degrees
  air_danger_radius_m: 450.0, // Significant atmospheric impact depth
  soil_pollution_radius_m: 150.0, // Radial ground pollution around industrial/landfill
  water_well_safe_clearance_m: 250.0 // Minimum distance from industrial to ground water wells
};

// === 2. Discrete Grid & Snapping Math ===

/**
 * Snap a 1D scalar coordinate to the nearest 8m cell boundary.
 */
export function snapToCell(val, cellSize = CELL_SIZE) {
  return Math.round(val / cellSize) * cellSize;
}

/**
 * Snap a 2D or 3D point to the nearest 8m grid.
 */
export function snapPoint(p, cellSize = CELL_SIZE) {
  return {
    x: snapToCell(p.x, cellSize),
    y: p.y !== undefined ? Number(p.y.toFixed(2)) : 0,
    z: snapToCell(p.z, cellSize)
  };
}

/**
 * Calculate distance between two 2D/3D points on the XZ horizontal plane.
 */
export function horizontalDistance(p1, p2) {
  const dx = p2.x - p1.x;
  const dz = p2.z - p1.z;
  return Math.hypot(dx, dz);
}

// === 3. Road & Slope Physics ===

/**
 * Calculate grade (percentage slope) between two 3D points.
 * Grade = (|dy| / horizontalDistance) * 100
 */
export function calculateGrade(p1, p2) {
  const hDist = horizontalDistance(p1, p2);
  if (hDist < 0.001) return 0;
  const dy = Math.abs((p2.y ?? 0) - (p1.y ?? 0));
  return (dy / hDist) * 100.0;
}

/**
 * Validate road segment geometry and slope against physical limits.
 */
export function validateRoadSegment(p1, p2, roadPrefab = 'Small Road') {
  const spec = ROAD_SPECIFICATIONS[roadPrefab] || ROAD_SPECIFICATIONS['Small Road'];
  const length = horizontalDistance(p1, p2);

  if (length < ABSOLUTE_MIN_ROAD_LENGTH_M) {
    return {
      valid: false,
      length,
      grade: 0,
      reason: `ROAD_TOO_SHORT: Length ${length.toFixed(1)}m is below engine limit ${ABSOLUTE_MIN_ROAD_LENGTH_M}m`
    };
  }

  const grade = calculateGrade(p1, p2);
  if (grade > spec.max_slope_percent) {
    return {
      valid: false,
      length,
      grade,
      reason: `SLOPE_TOO_STEEP: Grade ${grade.toFixed(1)}% exceeds ${roadPrefab} limit (${spec.max_slope_percent}%)`
    };
  }

  return {
    valid: true,
    length,
    grade,
    warning: length > MAX_ROAD_SEGMENT_LENGTH_M ? `Segment exceeds recommended length ${MAX_ROAD_SEGMENT_LENGTH_M}m; subdivision recommended.` : null
  };
}

/**
 * Subdivide a multi-point road path into safe segments (< maxLen).
 */
export function subdivideRoute(points, maxLen = MAX_ROAD_SEGMENT_LENGTH_M) {
  if (!points || points.length < 2) return points;
  const result = [snapPoint(points[0])];

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dx = p2.x - p1.x;
    const dy = (p2.y ?? 0) - (p1.y ?? 0);
    const dz = p2.z - p1.z;
    const dist = Math.hypot(dx, dz);

    if (dist <= maxLen) {
      result.push(snapPoint(p2));
    } else {
      const steps = Math.ceil(dist / maxLen);
      for (let s = 1; s < steps; s++) {
        const ratio = s / steps;
        result.push(snapPoint({
          x: p1.x + dx * ratio,
          y: (p1.y ?? 0) + dy * ratio,
          z: p1.z + dz * ratio
        }));
      }
      result.push(snapPoint(p2));
    }
  }
  return result;
}

// === 4. Grid Footprint & Bounding Box Collision ===

/**
 * Calculate the bounding box and metrics for a grid district.
 */
export function calculateGridFootprint(origin, cols, rows, blockW, blockH) {
  const ox = snapToCell(origin.x);
  const oz = snapToCell(origin.z);
  const totalW = cols * blockW;
  const totalH = rows * blockH;

  return {
    minX: ox,
    maxX: ox + totalW,
    minZ: oz,
    maxZ: oz + totalH,
    centerX: ox + totalW / 2,
    centerZ: oz + totalH / 2,
    width: totalW,
    height: totalH,
    columns: cols,
    rows: rows,
    total_blocks: cols * rows,
    total_area_m2: totalW * totalH
  };
}

/**
 * Check if two 2D axis-aligned bounding boxes overlap (with optional margin).
 */
export function checkAABBOverlap(boxA, boxB, marginM = 0) {
  const overlapX = (boxA.minX - marginM) < (boxB.maxX + marginM) && (boxA.maxX + marginM) > (boxB.minX - marginM);
  const overlapZ = (boxA.minZ - marginM) < (boxB.maxZ + marginM) && (boxA.maxZ + marginM) > (boxB.minZ - marginM);
  return overlapX && overlapZ;
}

// === 5. Fluid & Air Pollution Dispersion ===

/**
 * Test whether candidatePoint is positioned downwind of sourcePoint given windVector.
 * Returns:
 *   - is_downwind: true if D . W > 0
 *   - in_danger_cone: true if candidate falls within the +/- 30 deg pollution cone and within danger radius
 *   - angle_deg: angle between displacement vector and wind vector
 *   - distance: horizontal distance in meters
 */
export function evaluateWindRelationship(sourcePoint, candidatePoint, windVector) {
  const dx = candidatePoint.x - sourcePoint.x;
  const dz = candidatePoint.z - sourcePoint.z;
  const dist = Math.hypot(dx, dz);
  const windMagnitude = Math.hypot(windVector.x, windVector.z);

  if (dist < 0.001 || windMagnitude < 0.001) {
    return { is_downwind: false, in_danger_cone: false, angle_deg: 0, distance: dist };
  }

  // Normalized dot product: cos(theta) = (D . W) / (|D| * |W|)
  const dot = dx * windVector.x + dz * windVector.z;
  const cosTheta = Math.max(-1, Math.min(1, dot / (dist * windMagnitude)));
  const angleDeg = (Math.acos(cosTheta) * 180.0) / Math.PI;

  const isDownwind = dot > 0;
  const inDangerCone = isDownwind &&
                       angleDeg <= POLLUTION_RULES.air_cone_half_angle_deg &&
                       dist <= POLLUTION_RULES.air_danger_radius_m;

  return {
    is_downwind: isDownwind,
    in_danger_cone: inDangerCone,
    angle_deg: Number(angleDeg.toFixed(1)),
    distance: Number(dist.toFixed(1))
  };
}

/**
 * Calculate an optimal, safe Industrial District location strictly downwind of city settlements.
 */
export function calculateSafeIndustrialLocation(cityCenter, windVector, distanceM = 500.0, gridFootprint = { width: 288, height: 192 }) {
  const windMag = Math.hypot(windVector.x, windVector.z);
  if (windMag < 0.001) {
    throw new Error("Invalid wind vector: zero magnitude");
  }

  // Normalize wind vector
  const uX = windVector.x / windMag;
  const uZ = windVector.z / windMag;

  // Center of new industrial district placed along the wind vector
  const targetCenterX = cityCenter.x + uX * distanceM;
  const targetCenterZ = cityCenter.z + uZ * distanceM;

  // Derive top-left (or southwest) origin aligned to 8m grid
  const originX = snapToCell(targetCenterX - gridFootprint.width / 2);
  const originZ = snapToCell(targetCenterZ - gridFootprint.height / 2);

  return {
    origin: { x: originX, z: originZ },
    footprint: calculateGridFootprint(
      { x: originX, z: originZ },
      Math.round(gridFootprint.width / OPTIMAL_BLOCK_WIDTH_M),
      Math.round(gridFootprint.height / OPTIMAL_BLOCK_WIDTH_M),
      OPTIMAL_BLOCK_WIDTH_M,
      OPTIMAL_BLOCK_WIDTH_M
    ),
    wind_offset_distance: distanceM,
    wind_alignment_verified: true
  };
}

// === 6. District Configuration Pre-Flight Validator ===

/**
 * Pre-flight validation of district deployment configuration.
 * Catches geometric mismatches before hitting the game engine.
 */
export function validateDistrictConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config.origin || typeof config.origin.x !== 'number' || typeof config.origin.z !== 'number') {
    errors.push("Missing or invalid 'origin' { x, z }");
  }

  const cols = config.columns ?? 3;
  const rows = config.rows ?? 3;
  if (cols < 1 || cols > 5) errors.push(`Columns (${cols}) out of supported bounds [1..5]`);
  if (rows < 1 || rows > 5) errors.push(`Rows (${rows}) out of supported bounds [1..5]`);

  const blockW = config.block_width_m ?? OPTIMAL_BLOCK_WIDTH_M;
  const blockH = config.block_height_m ?? OPTIMAL_BLOCK_WIDTH_M;

  if (blockW % CELL_SIZE !== 0) {
    errors.push(`Block width (${blockW}m) must be a multiple of ${CELL_SIZE}m cell size.`);
  }
  if (blockH % CELL_SIZE !== 0) {
    errors.push(`Block height (${blockH}m) must be a multiple of ${CELL_SIZE}m cell size.`);
  }

  if (blockW !== OPTIMAL_BLOCK_WIDTH_M) {
    warnings.push(`Block width (${blockW}m) deviates from 96m golden standard. Suboptimal zoning depth may occur.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitized: {
      origin: config.origin ? snapPoint(config.origin) : { x: 0, z: 0 },
      columns: cols,
      rows: rows,
      block_width_m: snapToCell(blockW),
      block_height_m: snapToCell(blockH),
      efficiency_rating: blockW === OPTIMAL_BLOCK_WIDTH_M ? '100% (Golden Standard)' : 'Suboptimal (<100%)'
    }
  };
}
