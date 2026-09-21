# 捕鱼码头附着预览修复（待游戏验证）

2026-09-21：布斯蒂存档中，从 Fishing Pier 水侧永久节点向外延伸 20、80、160 米均返回 OverlapExisting；没有提交施工。12 米被 MCP 自身的 16 米下限拦截，不能据此断言原生游戏不支持。

对当前 Game.dll 的 NetToolSystem.GetOwnerDefinition / UpdateOwnerObject 反编译发现：原生工具除更新码头 owner，还会沿 Attachment.m_Attached 更新附着枢纽，设置 CreationDefinition.m_Attached 和 CreationFlags.Attach，并保留相关 SubNet、SubArea。旧 MCP 分支只表示直接 owner 和网络边。

本次补齐附着枢纽、相关网络边和区域原样预览，使用 owner 局部变换。预览建筑白名单仅接纳原有直接 owner 或附着枢纽，要求 prefab、坐标及旋转一致，拒绝删除；碰撞、预算、原生提交和永久回读门禁保留。

操作结果新增 validation_entities（最多 64 项），在预览清理前保存承载错误/警告的实体、原始实体、owner、prefab 实体和可用位置。这些字段是错误承载实体，不保证是碰撞另一方；不能将其包装成已获得原生 ErrorData 的完整碰撞对。

验收：部署后重新发现会话与节点，执行同方向短段和长段预览。核验附着建筑、原有码头和养鱼场不被拆除或位移；错误仍存在则结合 validation_entities 追踪，不绕过检查。只在用户另行授权施工时提交；预览成功不代表永久连接或捕鱼运营已验证。

部署后于 2026-09-21 14:19 UTC 在布斯蒂复测：新增 160 米 Fishing Pier 直线段，operation `363f4aa9865044249849e8563043021f` 返回 `preview_ready`、`can_commit=true`、费用 904，errors 和 validation_entities 均为空。没有提交施工；永久连接和捕鱼运营仍未验证。失败预览仍自动清理，没有新增保留错误预览的功能。
