# 规划数据引用与紧凑响应

规划/施工高层接口默认 `response_detail="summary"`。几何、完整结果与网页保存在 MCP 主机的 `artifacts/planning-store/`；可通过 `CITYWEAVER_PLANNING_STORE` 指定持久目录。多个 stdio MCP 进程应使用同一个目录。此改动属于 Node MCP 层，不需要重建游戏模组；已运行的 MCP 服务需重启以加载新 schema。

## 正常流程

1. `render_city_plan` 或 `propose_city_plan` 返回 `plan_ref`、原有 `plan_id` 和网页 `artifact_path` / `artifact_uri`、文件大小、SHA-256。HTML/SVG 文件保持原渲染内容，不再内嵌进工具响应。文件链接只保证本机可访问，远端客户端需由宿主提供文件传输或可信资源映射；不得为取文件而再次让模型读取整份 HTML。
2. 用户批准规划后，调用 `prepare_city_plan_construction({plan_ref, approved_plan_id})`。它仍实时检查会话和 prefab，验证规划哈希及虚拟沙盒，保存编译批次与执行器版本，返回 `construction_id` 和 `next_action`。渲染、持有引用都不代表已批准施工。
3. 后续原样使用小型 `next_action.arguments`，例如：

```json
{
  "construction_id": "construction-<64位哈希>",
  "state_version": 0,
  "batch_id": "<返回的批次ID>",
  "action": "preview_batch"
}
```

4. 提交仍是单独的 `commit_batch` 转移。原生 operation、稳定 request ID 和预览费用上限保存在执行日志；调用方可通过 `max_cost` 降低上限，不能提高。批次只能按日志中的下一动作执行。每次结果写入后状态版本递增；相同参数重复调用返回已保存结果，不重复执行。旧版本或跨会话调用被拒绝。
5. `bind_city_plan_buildings` 保存完整新规划，返回 `base_plan_id`、`new_plan_id`、新 `plan_ref` 和建筑变化摘要。模型无需合并完整规划；权威的新坐标、高度、占地与绑定证据保存在新版本中。几何变化仍按原审批规则重新展示和确认。

旧的完整 `bounds + plan` 入参仍受支持；旧式施工调用继续要求 `approved_plan_id`、`request_id` 和提交所需的 operation/预算。两种输入不可混用。后续动作会尽量返回引用，避免重复完整规划。

## 摘要与按需读取

- `summary`：保留状态、费用、错误/警告、回读结果、恢复标记及下一动作；大几何和候选列表放到 `evidence_ref`，长数组返回前20项、总数和截断标记。虚拟沙盒的状态与错误仍可见，不能只保留“数据已存储”。
- `normal`：摘要加已有性能统计。
- `full`：返回完整结构化结果；网页仍作为文件。只有明确需要完整诊断时使用。
- `read_planning_record({ref, fields, offset, limit})`：读取计划、快照、证据或施工日志的局部字段。嵌套对象返回字段索引，数组返回分页索引，进一步追加 `fields` 可读取确切对象。例如 `fields=["plan","buildings","0"]`。默认20项，最多64项；长字符串截断并标注长度。
- `payload_metrics` 提供完整结构化结果字节数及返回结果的近似JSON字节数；`token_count=null`，不以字节数冒充模型token数。HTML的字节数独立记录。宿主可能同时处理 text 与 structuredContent，实际模型token节省应以宿主测量为准。

## 事务与恢复边界

不可变记录采用完整SHA-256内容引用；既有 `cplan-...` 审批算法保持兼容。施工日志采用临时文件、刷盘后重命名；跨进程文件锁避免同一目录内的句柄施工并发。执行前保存 `in_flight`，完成后保存结果和证据。

进程中断或原生结果未知时保持 `CONSTRUCTION_RECOVERY_REQUIRED`，不自动重试或绕过失败。用 `read_planning_record` 读取日志中的 `in_flight.arguments`、request ID、operation ID，再用原领域查询核对原生事务和永久对象。当前版本不提供自动解除恢复锁或跨会话续建；不能删除日志并重新 prepare 来重建已完成对象。崩溃遗留 `construction.lock` 时，先确认记录的进程已退出、核对日志，才可人工移除锁文件；移除文件锁不解除日志中的恢复状态。

锁只覆盖此目录的句柄施工，不代替游戏原生工具互斥，也不阻止玩家或其他接口操作城市。原生预览、提交前检查、道路绑定和永久回读仍负责检测相关实时变化。无自动删除活动日志或证据的保留策略，长期运行应在确认工程结束并归档后管理磁盘空间。

## 快照复用：已实现与未实现

`capture_planning_snapshot` 返回 `snapshot_ref`，可传给 `propose_city_plan`、`propose_grid_plan`、`render_city_plan`。记录包含图层内容指纹、采集时间、会话和采样元数据。同会话60秒内可显式复用，过期、跨会话或缺少请求图层时拒绝。快照由多次查询组成，标记 `atomic=false`，只用于规划；施工入口不接收快照授权，也不从快照替代实时原生检查。

**内容指纹不是游戏变更计数器。** 当前没有实现游戏侧 terrain/water/road 等事件版本与跨图层精确失效；玩家编辑、正常模拟和外部工具可能使快照过时。需要当前状况时重新采集，不要以60秒内为“必然新鲜”。后续引入可靠游戏侧版本时，需覆盖道路→地形/绑定/随路管网等依赖，并区分工程自身变化与外部变化，不能每建一批就使整个工程失效。

## 验证

`node --test mcp/test/*.test.mjs` 包含真实 stdio MCP schema/引用渲染检查，以及存储重开、哈希篡改、重复提交、状态版本、预算上限、会话切换、未知结果恢复保护、跨实例锁和摘要保留失败信息的测试。这些是离线协议/工作流验证，不等于在真实游戏中新建一座城市的验收。
