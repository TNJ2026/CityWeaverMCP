# CityWeaver 1.37.4 公开更新

用户确认“提交”指上传到Paradox Mods并更新既有条目159998。使用官方ModPublisher NewVersion上传1.37.4，保持CityWeaver名称与Public，不创建新条目。发布前官方SDK确认原线上版本1.24.5、平台版本4、Published、Public。

发布包为artifacts/publishing/CityWeaverMCP-1.37.4。Windows内容根目录只有CityWeaverMCP.dll、CityWeaverMCP_win_x86_64.dll、双语README及KNOWN-LIMITATIONS，共4文件。不含CityWeaver.dll、直升机模型、道路资产、Node服务器、PDB、其他平台原生文件或本机连接凭据。图库沿用原封面与两张截图。8个上传源文件（代码、说明、图库和配置）按SHA-256冻结核验。

1.37.4的正式与隔离构建零警告/错误；适用的全套测试通过。真实游戏载入及旧存档迁移未完成，限制明确写入线上介绍、更新日志及包内说明。源码与构建验证见DETACH-RUNTIME-1.37.4-20261101.md。

官方上传器首次NewVersion退出0并报告新版本发布成功，没有重复提交。后台处理后生成平台版本5、Published、Public。初次默认详情尚无用户版本号和截图，显式版本5详情已有封面与两图但UserModVersion仍为空；随后使用同一配置执行官方Update，仅同步展示元数据，不再次上传代码或创建版本。

最终官方SDK默认详情确认ID159998、CityWeaver、1.37.4、平台版本5、Published、Public、包大小452622字节、封面cover_5.jpg及两张截图。短描述与归一化Markdown后的双语长描述和冻结发布配置一致。平台会压缩内容包，线上大小不等同于本地DLL总字节数。

当前本地发布配置同步包含旧存档升级限制；本轮没有替换用户游戏中的模组，也没有执行Git提交或推送。后续需要在游戏中下载1.37.4、按提示重启并验收载入及存档。

证据：

- 最终状态：artifacts/cityweaver-publish-1.37.4-20261101.json。
- SDK发布前/最终详情：artifacts/cityweaver-publish-before-1.37.4-20261101.json、artifacts/cityweaver-publish-final-1.37.4-20261101.json。
- NewVersion日志：artifacts/cityweaver-publish-1.37.4-20261101.log。
- 元数据同步日志：artifacts/cityweaver-metadata-sync-1.37.4-20261101.log。
- 上传清单与哈希：artifacts/publishing/CityWeaverMCP-1.37.4/publication-manifest.json。

模组页：https://mods.paradoxplaza.com/mods/159998/Windows
