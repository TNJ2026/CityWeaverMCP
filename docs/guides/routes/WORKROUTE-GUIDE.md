# 工作路线（WorkRoute / Fishing Line）工具实现

## 概述

提供 7 个工具，通过 API 查询、预检、创建和删除工作路线（例如捕鱼线路）。先做水域、归属和船型预检，再由原生 GenerateRoutes/GenerateWaypoints/ApplyRoutes 流程预览与提交。`preview_ready` 要求泊位绑定和每段寻路均通过；不保证派船或实际生产成功。

## 新增工具

| 工具名 | 功能 | 权限 |
|--------|------|------|
| `list_work_routes` | 列出所有工作路线，可按 owner_building_id 过滤 | 只读 |
| `get_work_route` | 读取单个工作路线的航点、路段、完成状态 | 只读 |
| `preview_work_route` | 预览创建工作路线（不实际创建） | 写 |
| `get_work_route_operation` | 轮询预览操作状态 | 只读 |
| `apply_work_route_operation` | 提交预览就绪的路线创建操作 | 写 |
| `cancel_work_route_preview` | 取消未提交的预览 | 写 |
| `delete_work_route` | 删除指定工作路线，不接受公交、铁路等普通线路 | 写 |

## 参数规范

### preview_work_route
```json
{
  "request_id": "fishing-route-west-001",
  "owner_building_id": "<session>:<index>:<version>",
  "route_prefab": "Fishing Line",
  "waypoints": [
    { "x": 3344.8, "y": 531.35, "z": 2197.2 },
    { "x": 3120, "y": 525, "z": 2560 },
    { "x": 3040, "y": 525, "z": 2690 },
    { "x": 2990, "y": 525, "z": 2750 },
    { "x": 2970, "y": 525, "z": 2500 },
    { "x": 3120, "y": 525, "z": 2300 }
  ]
}
```

- `waypoints`: 2–64 个点；路线自动闭合，不要重复首点作为尾点。`y` 可省略，省略时按实时水面计算。
- `route_prefab`: 默认为 "Fishing Line"，可选其他 WorkRoute prefab
- 城市必须暂停
- 预检要求：坐标在 ±7168 米地图范围内；首点距离工作泊位不超过 64 米；每个航点及每段直线航段位于水面；航点高度接近水面；owner 建筑与路线 prefab 兼容；存在匹配的已解锁工作船 prefab。
- 提交时重新执行预检。创建路线不计施工费用，但 `completed` 要求永久路线与路径回读通过，**不代表船只出库或实际生产成功**。
- 预览有效期为 5 分钟。到期后的 `get_work_route_operation` 和相同 `request_id` 查询都会返回 `expired`、`can_commit=false`；提交会报 `WORK_ROUTE_PREVIEW_EXPIRED`，且不创建线路。已完成、已取消等终态不会被到期检查改写。
- 提交后恢复模拟，回读 `get_work_route`、路线段的 `PathInformation` / `PathElement` 及 `RouteVehicle`，确认实际可用。若失败，停止后续创建并诊断原路线。

### get_work_route
```json
{
  "route_id": "<session>:<index>:<version>"
}
```

返回：
```json
{
  "route_id": "...",
  "name": null,
  "prefab": "Fishing Line",
  "complete": true,
  "owner_building_id": "...",
  "waypoint_count": 6,
  "segment_count": 6,
  "waypoints": [
    { "index": 0, "waypoint_id": "...", "position": { "x": 3344.8, "y": 531.35, "z": 2197.2 } },
    ...
  ]
}
```

## 实现文件

- `src/Transport/WorkRouteQueries.cs` — C# 桥接实现
- `src/Core/GameQueryService.cs` — 添加 case 分支和初始化
- `mcp/server.mjs` — MCP 工具注册和 zod schema

## 构建与部署

游戏关闭后执行：
```powershell
cd D:/Develop/game/CityWeaverMCP
./build.ps1
```

或仅编译不部署：
```powershell
./build.ps1 -Stage
```

## 使用场景

### 规划捕鱼路线
1. 读取 fish 资源分布：`read_environment_grid(system="Game.Simulation.NaturalResourceSystem")`
2. 确定高鱼群区域的航点
3. 预览路线：`preview_work_route`
4. 确认 `preview_ready`、无错误且 `validation_scope` 说明已阅读，再提交：`apply_work_route_operation`
5. 恢复模拟后回读线路段寻路和派船结果。

### 连接诊断

`get_work_route.connectivity` 与操作的 `connection_details` 返回航点绑定、每段路径长度/状态及车辆数量。`WORK_ROUTE_STOP_LANE_MISSING` 表示泊位未接到可用航道，`WORK_ROUTE_SEGMENT_PATH_MISSING` 表示尚未形成有效路径。失败时不会提交永久线路，须修复物理航道后重新预览。航点仅吸附同一主体的工作泊位，提交前重新校验泊位是否被删除或移动。

### 查询现有路线
```json
{ "tool": "list_work_routes", "arguments": { "owner_building_id": "..." } }
```

## 已知限制

1. **原生校验需要部署新版模组**：工具仍要求暂停；轮询原 operation，只有 `preview_ready` 才提交。同一提交复用预览的 `request_id`。
2. **可能拒绝可绕行线路**：直线航段必须全在水上；若实际航道绕过陆地，需要添加水域航点。
3. **无成本计算**：工作路线创建不计施工费用。
4. **游戏中已有的同类线路并非必需**：无现有线路时，按工作路线的地图特征与船型尺寸寻找匹配工作船 prefab。

## 后续改进

- 添加 `append_work_route_waypoint` 支持延长路线

---
创建于 2026-09-22，基于奥本山水产建筑捕鱼路线需求。
