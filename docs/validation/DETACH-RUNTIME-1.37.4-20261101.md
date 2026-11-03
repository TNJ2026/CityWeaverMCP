# 移除运行库强依赖与未用道路辅助代码

用户要求移除前次审计发现的两处残留：独立直升机运行库强依赖，以及未调用的道路辅助类。本地桥接更新为1.37.4，Node服务保持1.36.12；原条目159998、Public及既有双语资料保持。本轮只生成暂存包，没有安装到游戏或上传。

## 实现

删除csproj中的CityWeaver程序集引用、HelicopterRuntimeAssembly路径和构建前置条件。移除MCP启动时调用独立模组RegisterPersistence的代码，改为注册MCP自有的McpVehicleModelPersistenceSystem。模型保存数据、车门元数据、道路限速缓冲使用Mcp前缀类型，避免与独立模组序列化类型重名。原共用的查询异常、乘客计数、站点有效性读取也由MCP自身实现。

保留直升机查询、建线、预览诊断和模型组合预设接口，通过OptionalHelicopterRuntime访问已经加载的兼容独立模组。只枚举已加载程序集，不从磁盘加载DLL，不调用另一模组的Load。普通线路校验无需直升机模组；缺少或不兼容时，直升机专用写入拒绝执行。通用车辆导入、替换、配色、动画、存档恢复、道路编辑和限速接口保留。

为旧组件提供可选兼容读取：旧运行库已存在时导入车辆设置，保留新设置、禁用记录及一次性迁移标记；旧限速缓冲复制到MCP类型后消费旧缓冲，避免用户清除新策略后旧值再次恢复。旧车门配置读取后转换为MCP元数据。迁移不主动加载旧运行库。原组件须先能被游戏反序列化，旧存档首次迁移应保留原运行库并另存核对；本轮没有真实旧存档或游戏内载入验收。

删除五个未调用的道路辅助类：DividedRoadSectionRules、NativeRoadFont、NativeRoadFontRules、RoadSpeedMarkingRules、RoadMarkingMaterialProfile，以及其专用测试。通用限速单位、标志刷新、车道名称解析和道路编辑代码继续保留。通用测试不再读取同级直升机源码或资源。

## 验证

- 正式Stage构建：零警告、零错误。
- 将本项目源码、配置和构建脚本复制到artifacts下隔离目录，其上层没有TransportFever3Helicopters项目，正式Stage构建再次零警告、零错误。
- 程序集审计确认不引用CityWeaver或PassengerHelicopters，MCP自有持久化类型和通用/可选接口存在；旧共享类型与五个辅助类不在MCP程序集内。
- 可选适配测试先在没有直升机程序集时验证普通线路、专用拒绝和空诊断，再显式加载测试用兼容程序集，验证延迟发现、系统诊断、泛型校验、模型归属和组合预设；适配器没有启动另一模组。
- 全套Node测试覆盖模型持久化生命周期、禁用/迁移标记、车门深复制、限速序列化、配色、线路引用及真实STDIO工具发现，全部检查通过。
- 发布资料和正式暂存DLL版本均为1.37.4，check-publish通过。独立直升机项目的入口/运行库工程、HelicopterRuntime源码及冻结1.1.0发布清单哈希未变。

## 记录

修改前288个文件逐项备份及核验，目录artifacts/backups/detach-runtime-20261101-151101-029。最终状态及二进制哈希见artifacts/detach-runtime-1.37.4-20261101.json。

构建：artifacts/detach-runtime-build-1.37.4-20261101.log。

隔离构建：artifacts/detach-runtime-isolated-build-1.37.4-20261101.log及artifacts/detach-runtime-isolated-build-20261101.json。

全套测试：artifacts/detach-runtime-full-tests-1.37.4-20261101.log。针对新适配和持久化的检查另见detach-runtime-compatibility-tests、detach-runtime-generic-tests日志。

开发中的首轮构建揭示其余共用类型（QueryException、TransportStopHealth、PassengerManifestCounts与机场组合预设），已完成本地化或可选适配后重新构建通过。首轮针对性测试中模型持久化的源码路径被类型替换误改，已修正并通过针对性和全套测试；最终结果以上述完整日志为准。
