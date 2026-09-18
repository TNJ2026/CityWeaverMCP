# 地图和区域指南

自 MCP 1.13.0 起新增 12 个地图格工具，并与既有地形、土地分区和行政区接口组成完整的地图与区域控制层。当前 MCP 工具总数以运行时 `tools/list` 为准，不在文档中固化。

## 地图工具

| 工具 | 功能 |
| --- | --- |
| `get_map_overview` | 世界边界、地图格数量/面积/许可/维护费、区域数量、海平面和实时气候 |
| `list_map_tiles` | 按全部、已购、未购、当前可购状态分页读取地图格 |
| `get_map_tile` | 单格完整边界、面积、起始格、资源和邻接格 |
| `find_map_tile_at` | 由世界 x/z 坐标定位地图格 |
| `get_map_tile_neighbors` | 读取共享边界的上下左右相邻地图格 |
| `analyze_map_tile_features` | 汇总并排名面积、可建设土地、肥沃土地、森林、石油、矿石、水和鱼类 |
| `analyze_buildable_area` | 分别统计已购、未购或全图的原生可建设土地指标 |
| `preview_map_tile_purchase` | 对 1–64 个未购格校验连通性、许可、资金、价格和维护费 |
| `get_map_tile_operation` | 读取购买事务状态 |
| `apply_map_tile_purchase` | 重新核对快照后扣款并解锁所选地图格 |
| `cancel_map_tile_purchase` | 取消尚未提交的购买预览 |
| `unlock_all_map_tiles` | 通过游戏地图格解锁路径免费解锁所有剩余地图格 |

地图格购买必须从已拥有土地沿共享边界连续扩张。预览会拒绝重复、已拥有、失效、孤立、许可不足或资金不足的地图格。提交前再次核对所有权、许可、价格和资金；发生写入异常时恢复已经解锁的格子并退款。

购买价格按游戏 1.6.0 的 `MapTilePurchaseSystem` 公式计算：使用每格 `MapFeatureElement`、预设 `MapFeatureData`、`TilePurchaseCostFactor`、当前已购格数量和地图维护费曲线。应用阶段调用 `MapTilePurchaseSystem.UnlockTile`，由 `Native` 状态转换为已拥有地图格并添加 `Updated`。

## 区域和地形

既有接口一并覆盖：

- 行政区：创建、重画边界、删除、命名、政策、坐标定位、成员覆盖和市政服务覆盖范围，见 [行政区指南](DISTRICT-GUIDE.md)。
- 土地分区：分区类型、道路两侧逐格分析、划区、替换和清除，见 [分区指南](ZONING-GUIDE.md)。
- 地形：高度采样、抬高、降低、平整、平滑、坡面、全陆地抬升和全图平整，见 [地形指南](TERRAIN-GUIDE.md)。
- 环境：地表水、地下水、污染、土地价值、自然资源及其他 CPU 环境栅格继续由 `list_environment_layers` 和 `read_environment_grid` 分页读取。

## 示例

```text
找出当前未购买且可连接的地图格，按可建设土地排序前 10 个。
分析坐标 (1000, -3000) 所在地图格的全部资源和相邻格。
预览购买三个连续地图格，返回总价、许可消耗和维护费变化。
列出全图石油、矿石、肥沃土地和森林最丰富的地图格。
```

```json
{"request_id":"expand-east-001","tile_ids":["<tile-id-1>","<tile-id-2>"]}
```

## 当前验证

- Release 官方后处理和 Windows/macOS/Linux Burst 构建通过，0 警告、0 错误。
- 8 项 MCP 自动测试通过；1.13.0 时期真实 MCP 握手确认 232 个工具（该数字为当时的快照，工具总数随版本增长）。
- “沃本”实测地图范围约 `-7168..7168` 米，529 格全部读取成功，总面积约 205.52 平方公里。
- 单格完整边界、九类特征、四邻接、中心点反查、资源排名、可建设面积、海平面、天气、行政区、分区类型和地形高度实测通过。
- 运行中修改正确返回 `CITY_MUST_BE_PAUSED`；暂停后全部地图格解锁在 529/529 状态下幂等成功；已拥有格购买正确返回 `MAP_TILE_ALREADY_OWNED`；最终恢复正常速度。
- 当前存档没有未购地图格，因此购买预览的成功报价、取消、实际扣款和首次解锁尚未取得真实实例验证。代码已完成对应连通、许可、资金、冲突和回滚路径。
- 记录见 `artifacts/map-area-live-1.13.0.log`、`artifacts/deploy-build-1.13.0.log`。
