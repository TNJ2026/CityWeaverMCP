# 市民、家庭、企业与资源物流

自 MCP 1.16.0 起提供 37 个 MCP 工具：12 个稳定查询/资源工具，以及 25 个市民、家庭和企业完整操作。关系写入会同步 ECS 两端的组件或缓冲区；涉及模拟状态的操作要求城市暂停。

## 市民

- `list_citizens` / `get_citizen`：读取姓名、性别、年龄与生日、教育及失败次数、健康、幸福、各类计数器、家庭、工作、学校、通勤、当前位置和健康问题。
- `list_citizen_prefabs` / `create_citizen` / `delete_citizen`：发现原生男女预设，在指定家庭内创建市民，或交给原生 `Deleted` 流程清理。
- `set_citizen_name` / `set_citizen_profile`：设置名字、性别、年龄、教育、健康、幸福、休闲、处罚、失业和疾病字段。
- `set_citizen_household`：迁入另一个家庭，并同步 `HouseholdMember ↔ HouseholdCitizen`。
- `set_citizen_workplace`：就业、换岗或离职，并同步 `Worker ↔ Employee`；就业会解除在校关系。
- `set_citizen_school`：入学、转学或退学，并同步市民 `Student ↔` 学校 `Student`；入学会解除就业关系。
- `set_citizen_location`：设置或清除当前建筑，并同步 `CurrentBuilding ↔ Occupant`。
- `set_citizen_health_problem`：设置或清除疾病、受伤、死亡、需要转运、危险、受困、无医疗等原生标志及计时器。
- `set_citizen_attributes`：保留的简化接口，可直接设置健康、幸福和教育等级。

## 家庭

- `list_households` / `get_household`：读取成员、Money、总财富、消费、购物、工资、住房、租金、需求和无家可归状态。
- `list_household_prefabs` / `create_household` / `delete_household`：发现 13 类原生家庭结构，创建空家庭，或排入原生删除清理。
- `set_household_name` / `set_household_profile`：设置名字以及消费、购物、工资和建筑升级支出字段。
- `set_household_money`：精确设置资源缓冲区中的 Money；它与 `Household.m_Resources` 可消费资源单位分开。
- `set_household_housing`：入住、搬家或搬离，并同步 `PropertyRenter ↔ Renter` 和无家可归标记。
- `set_household_need`：创建、更新或清除当前非货币资源需求。

## 企业

- `list_companies` / `get_company`：读取类型、品牌、房产、利润、员工容量、生产配方、库存、交易成本和外部交易。
- `list_company_prefabs` / `create_company` / `delete_company`：列出城市中已有实例的原生企业预设，在指定房产创建企业，或排入原生删除清理。
- `set_company_name` / `set_company_financials`：设置名字、利润率、最近总价值和租金。
- `set_company_workforce`：设置最大员工容量；市民就业接口负责同步员工明细。
- `set_company_property`：设置、迁移或移除营业房产，并同步 `PropertyRenter ↔ Renter`。
- `set_company_trade_cost`：新增、修改或删除某项资源的买入价和卖出价。
- `set_company_profitability`：保留的简化利润率接口。
- `set_resource_amount`：设置企业、家庭、建筑或其他资源持有者的精确库存。

## 全城资源

- `get_resource_economy`：汇总全部 41 种资源的库存、产量、供应、需求、企业/工人数和各类平滑日用量。
- `list_resource_holders`：分页读取企业、家庭、建筑、外部连接和其他资源持有者，可按非零资源筛选。

## 真实验证

在“沃本”存档、游戏 1.6.0f1 上完成临时家庭→市民→企业的完整闭环。已验证 13 种家庭预设、2 种市民预设、46 种当前企业预设和 6 所学校；25 个新增工具全部取得真实实例覆盖，包括迁户、住房、建筑位置、疾病设置/清除、就业/离职、入学/退学、企业房产、财务、员工容量、库存，以及交易成本的新增/修改/删除。测试结束后临时实体均进入原生删除流程，模拟恢复正常，日志无异常。

记录见 `artifacts/population-operations-live-1.16.0.log`。
