# CityWeaver MCP 项目信息

更新于2026-11-03。当前本地候选版本为1.37.5，尚未上传。CityWeaver条目159998线上仍为1.37.4（平台版本5），官方SDK此前确认Published、Public，封面、两张截图及双语说明核对通过。本轮未执行订阅载入或真实旧存档迁移验收。

| 组件 | 当前本地版本 | 入口 |
| --- | --- | --- |
| 游戏内 MCP 桥接 | 1.37.5 | CityWeaver.csproj；CityWeaverMCP.dll，程序集版本1.37.5.0 |
| Node.js STDIO 服务 | 1.36.12 | mcp/package.json；mcp/server.mjs直接读取握手版本 |
| 可选独立直升机模组 | 1.1.0 | 同级TransportFever3Helicopters项目；条目165769 |

当前MCP发布配置沿用CityWeaver名称、原条目159998及Public，并已准备1.37.5更新资料；尚未调用发布器。线上1.37.4仍保持公开。独立直升机1.1.0此前已核验Published、Public；本轮未修改它的源码、资源或线上资料。

## 独立构建与可选适配

自1.37.4起，MCP不再编译或运行时强引用CityWeaver.dll、PassengerHelicopters.dll。构建仅需要本项目、游戏及官方工具链，不需要同级直升机目录或HelicopterRuntimeAssembly参数。直接运行build.ps1 -Configuration Release -Stage，输出artifacts/staged/CityWeaverMCP；tools/check-publish.ps1 -RequireStagedBuild -UpdateVersion只验证资料和暂存包，不上传。

通用车门配置、车辆模型数据、模型持久化系统和道路限速数据由src/Persistence中的Mcp前缀类型提供，避免与独立直升机模组已有序列化类型重名。通用模型处理、配色、动画、道路限速、线路管理及存档恢复接口保留。

直升机接口通过可选适配读取已经加载并启用的独立模组。不会搜索磁盘、主动加载DLL或启动直升机模拟；缺少该模组时，状态查询报告未注册，直升机专用写入返回HELICOPTER_MOD_REQUIRED，普通MCP功能不受其缺失影响。独立模组版本不兼容时，专用操作拒绝执行，不跳过校验。

## 内容精简与旧存档

1.37.3已移除12/24车道分隔道路、6车道单向道路、8车道高速及专用标线资源。1.37.4继续移除未调用的道路截面扩展、字体、标线规则及材质辅助类。1.37.5清理已停用公交模型遗留的资产准备脚本、专用测试、说明和本地验证产物；通用车辆接口保留。本项目不附带游戏模型资源。

使用已删除自定义道路的旧存档，须先在旧版换成原生道路再升级；没有自动道路迁移。

旧版存档中的模型、车门及限速数据原属CityWeaver.dll。当前提供可选兼容迁移：原运行库已加载时，复制旧模型数据且保留用户修改和明确禁用；道路限速复制到MCP类型并移除旧缓冲，避免清除新策略后旧值复活。不会为读取旧存档而主动加载该运行库。旧组件必须先能被游戏反序列化，才可能迁移；涉及这些组件的旧存档首次迁移应保留原运行库，另存后再核对。没有真实旧存档迁移或新版本游戏内载入验收，不能将编译和模拟测试当成迁移完成。

## 连接

玩家仍需游戏内桥接、Node.js 20或更高版本、本地MCP服务及支持STDIO的客户端。启动入口为node <本项目绝对路径>/mcp/server.mjs，载入城市后先读取get_game_status与运行时能力。bridge.json是本机连接凭据，不属于发布资料。

## English

Local bridge 1.37.5 is the current local candidate and has not been uploaded. It retains MCP-owned generic model, door and speed persistence with no mandatory assembly reference to the helicopter mod. The Node server remains 1.36.12. Build this project directly with the official game toolchain; no sibling helicopter checkout is required.

Helicopter APIs use optional reflection over an already enabled mod; they never load or start it. Missing or incompatible integrations reject helicopter-specific writes while generic MCP APIs remain available. Five unused road helper classes were removed; no custom roads are bundled.

Legacy migration reads original types only when their runtime is already available. Old serialized components must first be loadable by the game; preserve their original runtime for a first migration and verify a separate save. Real save migration and in-game loading have not been validated in this update. Existing custom roads must be replaced in the previous version before upgrading. Version 1.37.4 remains published on item 159998 as platform version 5; local candidate 1.37.5 has not been uploaded. No in-game subscription or legacy-save migration test was performed.
