# 组合导入模块（1.36.8）

## 1.36.8 修复

1.36.7 实机首次预览在创建操作/写入资产之前失败：JToken.FromObject 对 Unity.Mathematics.float3/quaternion 递归遍历 swizzle 属性，引发 Self referencing loop（xxxx）。改为明确输出 XYZ 和 XYZW 数组，不反射序列化数学类型。新增直接引用游戏 Unity.Mathematics.dll 与 Newtonsoft.Json.dll 的回归测试，检查真实类型、分量往返及变更后的签名差异；16 项相关测试通过。随后在 1.36.8 实机复验中，三个组合资产均创建成功；首次失败记录保留以供追溯。

`preview_model_composition` 将 2–16 个已有的 CityWeaver 静态导入对象组合为新的静态预制体。它保留每个 ObjectMeshInfo 的位置、旋转、状态条件和独立 RenderPrefab 引用；不合并顶点、材质或纹理，不再次执行原生导入器。

```json
{"request_id":"compose-example-001","sources":["CityWeaver_<32位来源ID>","CityWeaver_<另一来源ID>"],"construction_cost":0}
```

名称须来自 `list_imported_models`。只接受包围盒就绪的本模组静态导入对象；拒绝建筑、原版资产、重复来源/重复网格、无效变换、超过 32 个渲染网格。每个网格限 1–8 个材质且不能附带额外 LOD 链，采用保守限制避开原生每组 16 批次上限；不要将跨网格材质数直接当作单网格批次数。

游戏/编辑器须暂停且处于普通选择工具。预览不写资产；返回 `composition_modules` 可审阅来源、几何、材质和变换。以相同 request_id 调用 `apply_asset_file_operation`，max_input_bytes 为 0，再轮询 `get_asset_file_operation`。提交前重新核对来源签名；来源变更、过期、换档或恢复模拟均不能继续原预览。

新根 prefab 保存于独立 ImportedData/CityWeaver/<operation_id>，复用已有模块资产；`completed` 需实际注册并确认原生包围盒及 PlaceableObject 就绪。异常可能留下部分输出，记为 outcome_unknown，不能自动重试。可取消未提交预览，不能通过取消删除已保存资产。

本功能不自动建造或保存城市，不改变现有实例或车辆，不配置道路入口、站点、旋翼、舱门、机场经济或交通行为。所有源模块的本地资产仍为依赖，移动存档时必须保留。重载后重新查询实体 ID。

机场、航站楼和 Mi-26 的具体来源请求见 artifacts/native-import-20261027/composition-requests.json。1.36.8 正式构建和 16 项相关测试通过。实机已完成三个组合资产创建，独立网格、材质数量和原生包围盒检查通过；Mi-26 已选入放置预览，未建造。完整外观、透明材质显示和组合根资产重载仍待验证。具体根 prefab 和操作日志见该目录 README.md 的“1.36.8 组合验收”。
