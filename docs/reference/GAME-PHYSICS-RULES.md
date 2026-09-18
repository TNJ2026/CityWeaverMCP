# Cities: Skylines II / CityWeaver 游戏物理与几何规则知识库 (Game Physics Rules)

本文档系统化固化 Cities: Skylines II (CS2) 游戏引擎与 CityWeaver 模组的底层物理法则、几何网格、动力学管网与环境流体特性。供 Agent、自动化规划脚本及工程验证模块作为权威先验知识库调用。

---

## 1. 空间与网格几何物理 (Spatial & Grid Geometry)

### 1.1 基础单元与格网相位
* **基础单元格（Cell）**：$1\text{ cell} = 8.0\text{m} \times 8.0\text{m}$。
* **绝对吸附准则**：所有道路拐点、起止节点、建筑定位坐标 $(X, Z)$ 必须吸附至 $8.0\text{m}$ 的整数倍，即：
  $$\text{Snap}(x) = \left\lfloor \frac{x + 4.0}{8.0} \right\rfloor \times 8.0$$
* **全局对齐相位**：确保所有独立街区属于同一全局 8m 栅格相位，避免不同街区相遇时产生错位或撕裂。

### 1.2 分区深度与黄金街区尺寸 (Zoning Depth & Optimal Block)
* **最大分区进深**：沿市政道路向两侧法线方向延伸极限为 **6 个单元格（$48.0\text{m}$）**。
* **黄金街区宽度（Golden Block Width）**：
  * 对开道路的最佳进深为 **$96.0\text{m}$（$48\text{m} \times 2 = 12\text{ cells}$）**。
  * **物理特性**：两侧道路产生的分区在中心线严丝合缝背靠背对接，**空间利用率 100%**，零死角零缝隙。
  * 若间距 $> 96\text{m}$：中心会残留无法分区的狭缝（虚度地皮）；
  * 若间距 $< 96\text{m}$：两侧分区深度受压迫，单侧建筑进深被削减。
* **街区黄金长度（Golden Block Length）**：
  * 标准居住区：**$160.0\text{m}\sim240.0\text{m}$（20~30 cells）**。可容纳 5~8 栋标准深度建筑，同时控制路口密度。
  * 商业/混合区：**$96.0\text{m}\sim128.0\text{m}$（12~16 cells）**。

### 1.3 道路规格与侵占宽度 (Road Specifications)

| 道路分类 | 典型预设 (Prefab) | 路宽 (米) | 占用格网 (Cells) | 最高限速 | 默认地下基础设施 | 噪音等级 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **小路 (Local/Small)** | `Small Road` | $16.0\text{m}$ | 2 cells | 50 km/h | 低压电缆、净水管、排污管 | 低 ($\approx 10\text{m}$) |
| **中型干道 (Arterial/Medium)** | `Medium Road` | $24.0\text{m}$ | 3 cells | 60 km/h | 低压电缆、净水管、排污管 | 中 ($\approx 30\text{m}$) |
| **大型主干道 (Large)** | `Large Road` | $32.0\text{m}$ | 4 cells | 60 km/h | 低压电缆、净水管、排污管 | 较高 ($\approx 45\text{m}$) |
| **高速公路 (Highway)** | `Highway` / `Two-Way Highway` | $24.0\sim32.0\text{m}$ | 3~4 cells | 100 km/h | **无**（不承载低压电、给水或污水） | 极高 ($\ge 50\text{m}$) |

### 1.4 道路几何与节点约束 (Road Geometry Limits)
* **单段道路长度约束**：
  * 最小长度：$16.0\text{m}$（绝对极限 $8.0\text{m}$，小于 8m 必定报错）。
  * 最大单段长度：$200.0\text{m}$（引擎硬上限约 256m，建议 $\le 200\text{m}$ 防止由于长距离地表起伏导致路基变形）。
  * 超过 200m 时，必须按等距插入中间节点（Subdivision）。
* **节点吸附容差（Snap Tolerance）**：$8.0\text{m} \sim 10.0\text{m}$。当两道路端点距离小于 8m 时，引擎强制吸附合并为一个节点。
* **最小平行道路间距**：两条平行道路中心距不得小于 $\frac{W_1 + W_2}{2} + 8.0\text{m}$，防止路基重叠冲突。

---

## 2. 地形与坡度力学 (Terrain & Slope Physics)

### 2.1 坡度极限（Slope Limits）
* **最大允许爬坡度（Maximum Grade）**：
  $$\text{Grade} = \frac{|\Delta Y|}{\sqrt{\Delta X^2 + \Delta Z^2}} \times 100\%$$
  * 市政道路（Small / Medium / Large）：$\text{Grade} \le 15.0\%$（超过 18% 提示警告，超过 20% 引擎报 `Too Steep`）。
  * 高速公路（Highway）：$\text{Grade} \le 10.0\%$。
  * 铁路轨道（Train Track）：$\text{Grade} \le 5.0\%$。
* **平整度安全裕度**：规划网格组团时，要求地表高程极差 $\Delta Y_{\max} \le \text{Length} \times 0.10$。若落差过大，需先调用整地工具或梯级放坡。

---

## 3. 市政网络动力学 (Network & Utilities Physics)

### 3.1 电力网络双轨制（Dual-Track Power Grid）
1. **高压输电（High Voltage, 230kV）**：
   - 载体：架空高压电塔（Power Line）。
   - 特点：长距离、极高传输容量，**不附带分区、不附带低压电，建筑无法直接吸收高压电**。
2. **低压配电（Low Voltage, 400V）**：
   - 载体：除高速公路外，所有市政道路（Small/Medium/Large）地下**自带低压电缆网**。
   - 特点：只要建筑毗邻有路网覆盖的街区，即可自动取电。
3. **变电站物理中枢（Transformer Station）**：
   - **连接铁律**：高压线**绝对不能**直接连入住宅区道路，**必须且只能通过变电站（Transformer Station）转压**。
   - 拓扑约束：变电站一侧接入高压线（PowerLine Node），另一侧必须紧贴带有低压路网的市政道路。
   - 变电站的道路侧放在普通市政道路的功能区格子上时，低压侧直接接入道路内嵌电网，无需另铺低压接驳线。高速公路不适用，高压输入侧仍须另行验证并在缺失时接驳。

### 3.2 水资源与排污动力学（Water & Sewage Flow）
1. **管网一体化**：普通市政道路地下均自带低压电、给水和污水线路；设施紧邻道路功能区格子时直接接入。属于同一连续普通道路网络的道路共享已经接入的设施能力。高速公路不承载这些线路，也不能桥接两个管网分量。
2. **自来水来源**：
   - **水塔（Water Tower）**：建在陆地平整、清洁且紧邻普通市政道路功能区格子的位置，直接向道路给水网供水，无需另铺接驳管。
   - **抽水泵站（Water Pumping Station）**：必须同时紧邻河流、湖泊或海岸等有效水域和普通市政道路，直接向道路给水网供水；输水管不能替代道路放置要求。
3. **污水排放与流向铁律**：
   - 地表水存在绝对流动流向向量 $\vec{V}_{\text{water}}$。
   - **绝对红线**：地表抽水泵站必须位于排污口（Sewage Outlet）的**绝对上游**，严禁下游排污逆向污染水源，否则会导致全城大规模疾病与人口暴跌。
   - 排污口必须紧邻有效水域；若同时紧邻普通市政道路功能区格子，则直接接入道路污水网。若岸线位置无法临路，使用兼容污水管把排污口连接到已经通污水的道路。

---

## 4. 环境与流体力学 (Environmental & Fluid Dispersion)

### 4.1 空气污染流体模型（Air Pollution Fluid Dynamics）
* **风向向量**：游戏全局风向向量 $\vec{W} = (W_x, W_z)$。
* **扩散形态**：工业区（Industrial Zone）产生的重度空气污染**严格沿风向呈扇形圆锥扩散**：
  * 扩散半角：$\theta \approx \pm 30^\circ$。
  * 危险纵深：$L_{\text{danger}} \approx 300.0\text{m} \sim 500.0\text{m}$。
* **安全判定法则（Safe Siting Formula）**：
  若以主城区中心点为 $\vec{P}_{\text{city}}$，候选工业区中心点为 $\vec{P}_{\text{ind}}$，位移向量为 $\vec{D} = \vec{P}_{\text{ind}} - \vec{P}_{\text{city}}$：
  1. **顺风度检测**：$\vec{D} \cdot \vec{W} > 0$（工业区位于城市沿风向的顺风下风向）。
  2. **夹角安全检测**：向量夹角 $\cos \alpha = \frac{\vec{D} \cdot \vec{W}}{\|\vec{D}\| \|\vec{W}\|}$ 必须接近 1（同向），且反向矢量不覆盖城市。
  3. **绝对红线**：严禁在城市逆风上风向（$\vec{D} \cdot \vec{W} < 0$）布置任何工业区或垃圾焚化厂！

### 4.2 土壤重金属污染（Soil & Groundwater Contamination）
* **扩散形态**：呈同心圆径向渗透，半径约为 $120.0\text{m} \sim 150.0\text{m}$。
* **地下水渗透后果**：一旦重金属污染侵蚀地下水水库（Groundwater Deposit），该水库永久毒化。
* **安全净距**：地下水抽水井必须距离工业区边界至少 **$250.0\text{m}$**。

### 4.3 噪音衰减物理（Noise Attenuation）
* 高速公路（Highway）：$50\text{m}$ 强噪音缓冲带（适宜绿化带或仓储物流）。
* 4车道以上主干道（Arterial）：$30\text{m}$ 噪音缓冲带（适宜商业街，不宜低密度独栋住宅）。
* 工业区周边：$80\text{m}$ 噪音隔离带。

---

## 5. 区域规划拓扑与等级级配 (Road Hierarchy & Zoning)

```
[高速路 Highway] (无分区/高噪音/过境专用)
       ↓ (匝道 / 互通立交)
[主干道 Arterial: Medium/Large Road] (4~6车道, 骨架连接, 适宜布置商业与服务)
       ↓ (平交十字 / T型路口)
[支路 Local: Small Road] (2车道, 96m黄金街区内部, 100%纯净低密度住宅)
```

* **反盲目接入准则**：严禁将低密度居住小区的小路直接打孔接到过境高速公路上。
* **主干道间距准则**：两主干道（Arterial）平行间距建议在 $300\text{m}\sim500\text{m}$，中间填充 3~5 个标准生活街区。

---

## 6. 公共交通设施物理规则 (Transit Facility Physics)

1. **陆上运营链**：公交、火车、电车和地铁遵循“车辆段/车场 → 站点/车站 → 连续道路或轨道 → 线路”。设施放置、网络连接和线路创建是三个独立条件；线路还必须能从车辆段寻路到首站。
2. **公交与出租车**：公交站依附道路并受道路拥堵影响；出租车依赖道路但不需要固定线路。车辆段容量限制可投入车辆数，站点数量不会自动增加运力。
3. **铁路、电车和地铁**：每种模式只能使用兼容轨道。画面相交不等于节点相连；车站内部轨道必须实际连接外部轨道。坡度、曲率、高程、桥隧净空和道岔由当前轨道 prefab 与原生 preview 判定。
4. **船运与渡轮**：港口/渡轮站同时受岸线、水深和连续航道约束。城际船运还须接到地图边缘水路；Bridges & Ports 渡轮用于城内客运，小站可依附 quay，大站依附 shoreline。
5. **航空**：机场不需要铺设航空网络，使用线路直接连接航空外部连接；但需要大块连续净空、陆侧道路以及跑道两端的建筑限高走廊。
6. **货运端口**：货运火车站、港口和航空货站的主线运力不能消除陆侧卡车。入口数量、排队长度、仓储、分拨道路和住宅隔离必须单独验算。
7. **多式联运**：同一建筑内含多种站台不等于每种模式都已接通；道路、各类轨道、航道、车辆段与线路逐项验收。

详细设施矩阵和 DLC 条件见[公共交通基础设施与轨道](../guides/transport/TRANSPORT-INFRASTRUCTURE-GUIDE.md)。规则依据官方[公共与货运交通说明](https://www.paradoxinteractive.com/zh-CN/games/cities-skylines-ii/features/public-cargo-transportation)和[港口/渡轮开发日志](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/bridges-and-ports-dev-diary-ports)。

---

## 7. 专门产业物理规则 (Specialized Industry Physics)

1. **Owner—Area 结构**：先放置专门产业主建筑，再由其允许的 `SubArea` 定义采集区；它不是普通工业 zoning，也不能脱离 owner 单独存在。
2. **资源依赖**：Grain、Vegetable、Cotton 依赖 Fertile Land；Forestry 依赖 Forest；Coal 与 Ore Mining 依赖 Ore；Oil Drilling 依赖 Oil。Livestock 与 Stone Quarrying 不要求自然资源覆盖。
3. **资源寿命**：Fertile Land 和 Forest 可再生但受污染破坏；Ore 和 Oil 有限并会随开采减少。边界面积只有与有效资源重叠的部分才有采集意义。
4. **两套路径**：采集车辆只在产业区域内部沿模拟路径活动，不使用普通道路；员工、服务和外运车辆仍通过主建筑道路入口进入城市路网。
5. **经济行为**：专门产业不推动普通工业 zoning 需求，经营困难或资源耗尽时缩减产量和员工，而不是按普通公司逻辑破产。
6. **海洋产业（DLC）**：Fishing 需要按类型组合鱼场或 pier/area/offshore farm/仓储/Boatway/Route；Offshore Oil 需要 pier/pipeline/storage/rig/oil-tanker route。水面设施、专用网络、存储和陆侧道路必须分别连通。

详细建设与验收规则见[建筑附属区域指南](../guides/buildings/BUILDING-AREA-GUIDE.md)。规则依据官方[经济与生产说明](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/economy-production)及[Bridges & Ports 官方资料](https://www.paradoxinteractive.com/games/cities-skylines-ii/add-ons/cities-skylines-ii-bridges-and-ports)。
