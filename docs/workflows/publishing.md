# Paradox Mods 发布 CityWeaver

CityWeaver 是游戏内代码模组，`mcp/` 中的 Node.js MCP 服务是独立组件。Paradox Mods 的代码模组包只包含游戏端构建产物；发布游戏模组不会自动分发 MCP 服务。公开发布前，应给玩家一个可获取且版本兼容的 MCP 服务安装渠道和使用说明，否则仅订阅模组无法使用城市查询或施工工具。

## 首次发布前

1. 确认游戏版本、已验证功能和已知限制；不要把编译或接口测试等同于全部实机验收。
2. 检查 `CityWeaver.csproj`、`src/Core/GameQueryService.cs` 的 `bridge_version` 和 `Properties/PublishConfiguration.xml` 的 `ModVersion` 一致。`mcp/package.json` 是独立服务版本，不要求与模组版本相同。
3. 检查发布页名称、说明、兼容游戏版本、缩略图、更新日志和公开级别。首次发布时 `ModId` 留空；之后更新必须填写平台返回的真实 ID。
4. 保存并退出游戏后运行 `./build.ps1 -Configuration Release -Stage`，再运行 `./tools/check-publish.ps1 -RequireStagedBuild`。此命令只验证和暂存，不上传。
5. 确认暂存目录只包含预期的游戏端 DLL/Burst 文件，不包含桥接令牌、日志、存档、规划图和开发脚本。
6. 在 Visual Studio 或 Rider 中选 `PublishNewMod` 发布配置，登录自己的 Paradox 账户，并在确认公开内容后执行发布。上传成功后回读页面、下载包和模组 ID，在另一套安装环境验证订阅安装。

官方说明：代码模组通过 IDE 的 Publish 功能上传到 Paradox Mods；缩略图现为必需。参见 [代码模组开发日志](https://www.paradoxinteractive.com/games/cities-skylines-ii/modding/dev-diary-3-code-modding)和[春季清理补丁说明](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/patch-notes-spring-cleaning)。

## 后续更新

- 新版本：更新模组版本与变更日志，使用 `PublishNewVersion`；不要重新创建同名模组。
- 仅修改发布页资料：使用 `UpdatePublishedConfiguration`。
- 每次上传后核对商店显示的版本、兼容游戏版本、下载内容及公开状态。
- `build.ps1` 的普通部署、`-Stage` 暂存和 IDE 的 Publish 是三种不同操作；不能把本地构建成功当成已上传。
