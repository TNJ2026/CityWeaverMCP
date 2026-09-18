/**
 * 模拟速度的状态捕获与还原（tools 脚本层）。
 *
 * 为什么需要它：脚本为了稳定执行原生预览，会把城市临时置为暂停；跑完必须还原成
 * 用户原本的速度，否则就是静默改变了用户的游戏状态（表现为「跑完脚本游戏自己停住」）。
 *
 * 关键事实（2026-09-18 实机实测，非推断）：
 *   `set_simulation_speed` 收字符串枚举 paused / normal / fast / fastest；
 *   `get_game_status` 报的是数字 `selected_speed`。两者**不是** 0/1/2/3 顺次对应：
 *     paused -> 0, normal -> 1, fast -> 2, fastest -> 4   （跳过 3）
 *   若按直觉写成 0/1/2/3，把 fastest 还原时会退化成 fast —— 静默降速。
 *
 * 本映射在 `mcp/` 的 6 个工作流里各有一份等价的本地拷贝（`speedOf` / `citySpeed`）。
 * 那一层刻意保持模块自包含，因此这里为 tools 脚本另立单一来源，并用离线测试钉住，
 * 不要在多处重复这个映射。
 *
 * 本模块只做纯计算，不发起任何查询，便于离线测试。
 */

/** 实测得到的枚举 ↔ 数字对应；`fastest` 是 4，不是 3。 */
export const SIMULATION_SPEEDS = Object.freeze([
  Object.freeze({ speed: 'paused', code: 0, paused: true }),
  Object.freeze({ speed: 'normal', code: 1, paused: false }),
  Object.freeze({ speed: 'fast', code: 2, paused: false }),
  Object.freeze({ speed: 'fastest', code: 4, paused: false }),
]);

const BY_CODE = new Map(SIMULATION_SPEEDS.map(entry => [entry.code, entry]));

/**
 * 把 `get_game_status` 的 data 归一成可读状态。
 * `speed` 为 null 表示该数字不在实测映射里（未知速度），此时不要假装知道它是什么。
 */
export function describeSimulationSpeed(gameStatusData) {
  const raw = gameStatusData?.selected_speed;
  const code = Number.isFinite(Number(raw)) ? Number(raw) : null;
  const entry = code === null ? undefined : BY_CODE.get(code);
  // 暂停优先：实测里暂停时报 selected_speed = 0，但即使数字缺失，paused 也足以判定。
  const paused = gameStatusData?.paused === true || entry?.paused === true;
  return { paused, code, speed: entry?.speed ?? null };
}

/**
 * 给出把城市还原回 `before` 所需的枚举，以及是否属于「无法精确还原」的降级。
 * 未知速度回退到 `normal` 并标记 `fallback`，而不是猜一个看起来精确的值。
 */
export function speedToRestore(before) {
  if (before?.paused === true) return { speed: 'paused', fallback: false, unknown_code: null };
  if (before?.speed) return { speed: before.speed, fallback: false, unknown_code: null };
  return { speed: 'normal', fallback: true, unknown_code: before?.code ?? null };
}
