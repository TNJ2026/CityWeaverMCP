# 线路配色资产复用与磁盘去重 1.36.91

2026-10-30，用户要求修复 CityWeaver 导入资产占用异常。审计指定目录逻辑大小 43.72 GiB，788 个纹理文件 SHA-256 只有 33 种不同内容。根因是存档/全局默认恢复使用新操作 ID，ApplyVehicleRouteColors 每次再次生成 RouteMask / RouteBase。

新增 RouteColorCacheRules / VehicleRouteColorCache：以内容及宽高、线性/sRGB、采样/环绕、纹理用途、mip 策略和版本生成 SHA-256 键。纹理统一保存至 `ImportedData/CityWeaver/RouteColorCache/v1`。每次先调用用户资产库 Exists，缓存命中后检查 GPU 可用性和尺寸，直接复用，不分配新的大纹理，不覆盖已有缓存条目。原私有 Surface 继续按操作生成以隔离材质修改；玻璃保护、线路颜色语义及像素精度不变。操作回读新增 route_color_cache_hits / route_color_cache_writes，便于实机复核重载复用。

6 项相关测试通过：生产缓存逻辑的跨操作/模拟重载复用、像素与 alpha、宽高/采样/颜色空间区分、零遮罩共享、缓存损坏拒绝；车辆配色、车辆模型、保存恢复与线路引用回归；NTFS 同内容纹理原子硬链接合并及 .cid 不变、越界/内容变化/运行状态拒绝。正式构建零警告、零错误。

## 旧数据处理

检测到游戏已关闭后执行 `tools/deduplicate-route-textures.mjs --apply`。范围严格限定用户指定的 ImportedData/CityWeaver，合并前逐组重新读取 SHA-256，仅处理同卷、非符号链接且字节完全相同的 .Texture；保留所有路径及每个路径自己的 .cid。先创建硬链接，再原子替换重复物理副本，带逐文件操作日志及游戏进程复查。不删除模型、材质、目录或旧存档引用。资产未做有损压缩。

共合并 755 份重复物理纹理，释放 45,589,626,182 字节，约 42.46 GiB。788 个纹理路径现在指向 33 份物理内容，实际纹理内容占 1,352,594,806 字节，约 1.26 GiB。最终逐 inode 重算哈希，全部 788 个纹理内容与审计一致，755 个受影响 .cid 哈希不变，所有被审计路径仍存在。C 盘可用空间读数从此前约 70.22 GB 增至 115.62 GB（期间其他进程也可能有磁盘写入）。目录属性按路径累加仍可能显示原逻辑大小，应看卷空闲空间或去重感知的物理统计。

硬链接共享的是旧纹理内容。后续材质编辑继续使用创建新 Texture/Surface 的既有流程；本修复不原地重写共享纹理。不得使用原地文件编辑方式修改这些资产二进制。

1.36.91 已备份部署，六个文件校验一致。备份及安装清单位于 `artifacts/deployment-1.36.91.json`。磁盘证据为 `artifacts/route-texture-dedup-result.json`、`artifacts/route-texture-dedup-verification.json`、`artifacts/route-texture-dedup-journal.jsonl`。尚待用户载入城市核验模型/线路配色，再保存重载确认原生缓存命中、不再新增大纹理。

## 首次实机缓存验证

2026-10-30 首次载入奥尔顿，session `1854b308348f4e57b7ad7ddd1ed50a33`，版本 1.36.91。Bus01/02/03 及两种客运直升机均自动恢复 completed、无错误、线路引用同步。当前 Bus01 39 辆、直升机 3 架；7 材质/9 骨骼/4 扇门的公交配置及 6 材质/3 骨骼的直升机配置保留。全部 6 条交通线路 active、complete、path_complete、stops_valid、service_ready。

本次冷启动共缓存命中 28 次、写入 6 次；Bus02/03 及第二种直升机全部命中、零写入。缓存只有 6 张纹理及 6 个 cid，合计 380,283,940 字节（约 362.67 MiB）。记录 `artifacts/route-cache-live-first-load.json`、`artifacts/route-cache-first-load-validation.json`、`artifacts/route-cache-first-load-hashes.json`。待再次重载核对跨会话零写入及文件哈希不变。

## 保存重载验收通过

用户保存并重新载入同一城市，session 改为 `b271241f413c432e832580cd6102c264`。五种车辆全部恢复 completed、无错误、线路引用同步；共缓存命中 34 次、写入 0 次。仍为 6 张纹理，逐文件名称、长度及 SHA-256 与首次载入完全一致，纹理文件本体合计 380,283,748 字节，未新增或重写大贴图。当前 41 辆公交、3 架直升机的模型恢复完成，6 条线路 ready、path_complete、stops_valid 均正常。保持用户本次载入后的正常运行状态。最终证据 `artifacts/route-cache-reload-validation.json`。重复生成问题的实机跨重载验收完成。
