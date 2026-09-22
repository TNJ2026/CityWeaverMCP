# 工作路线（WorkRoute / Fishing Line）工具实现

## 概述

提供 7 个工具，通过 API 查询、预检、创建和删除工作路线（例如捕鱼线路）。预检并非游戏原生临时路线预览；`preview_ready` 只表示已通过模组的保守前置检查，不保证游戏寻路或派船成功。

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
- 提交时重新执行预检。创建路线不计施工费用，但 `completed` 仅代表永久路线实体已创建，**不代表航段寻路、船只出库或实际生产成功**。
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

### 查询现有路线
```json
{ "tool": "list_work_routes", "arguments": { "owner_building_id": "..." } }
```

## 已知限制

1. **不调用原生路线预览工具**：当前是水域、边界、建筑兼容性、船型等保守预检；不检查完整原生寻路、净空或派船。
2. **可能拒绝可绕行线路**：直线航段必须全在水上；若实际航道绕过陆地，需要添加水域航点。
3. **无成本计算**：工作路线创建不计施工费用。
4. **游戏中已有的同类线路并非必需**：无现有线路时，按工作路线的地图特征与船型尺寸寻找匹配工作船 prefab。

## 后续改进

- 接入原生 `ApplyRoutesSystem` 进行路径查找和校验
- 添加 `append_work_route_waypoint` 支持延长路线
- 接入原生临时路线预览与完整航道连接性验证

---
创建于 2026-09-22，基于奥本山水产建筑捕鱼路线需求。
