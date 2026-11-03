# 1.36.71 地图编辑器现有道路拆除
用户要求添加拆除已经存在道路功能。城市模式原有preview_road_demolition/preview_road_batch_demolition及原生工具流水线已存在。本版将这两个入口及null事务的demolish/batch_demolish明确加入编辑器白名单与提交模式门禁。
沿用现有永久Road+Edge+Curve验证、重复ID拒绝、原生Delete预览、建筑清除阻断、快照校验及一次提交、Deleted/实体不存在回读完成判断。MCP单次批量上限64条。默认选择工具及暂停仍为前提；不新增直接销毁实体路径。
editor-access回归测试覆盖允许单段/批量拆除、城市模式仍经过原城市检查、不相干事务/操作仍拒绝，一项通过。正式暂存构建1.36.71零警告零错误。未部署，未拆除当前任何道路；待部署后用独立短测试路验证单段/批量删除与邻路保留。
已确认游戏关闭并部署1.36.71.0。完整备份：D:\Develop\game\CityWeaverMCP\artifacts\backups\CityWeaver-before-1.36.71-20261029-083545。六个安装文件SHA256与暂存包一致，安装DLL版本正确。待加载实机验证。

实机测试通过，会话e8608bce798e4bc093d0151cfeb0176b，编辑器1.36.71。新增四条独立200米测试道路：A单段预览并取消后仍存在；A单段正式拆除completed；B/C两条批量拆除completed；旁边对照道路保留，再单段清理completed。所有测试路均清理。比较测试前后原200条永久道路：实体ID、Edge、Curve及PrefabRef一致，额外道路0。结果artifacts/demolition71-journal.json和demolition71-final-check.json。过程中用户切换Lane Connector Tool导致TOOL_BUSY，等待用户返回Default Tool后继续，未覆盖其工具操作。地图保持暂停，未自动保存。
