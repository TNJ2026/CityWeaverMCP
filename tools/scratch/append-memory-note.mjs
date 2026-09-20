// 一次性：追加今日记忆日志
import { appendFileSync } from 'node:fs';
const note = `
## 五边形城（nis-pentagon，尼思存档）——正五边形规划

- **尼思现在是当前存档**（星城同存档第二张规划）。已购 24 格 = 4×6 矩形：x −1558~935、z −935~2805；无地表水特征，水掩码在北缘 z<−400 与南缘 z>2450 有水域；平台高程 ~480（海平面 476）。高速支线终点 (144,2692)/(162,2700)，北上有 128m 水格 (124,2544)，连接道设折点绕开。
- 交付：plans/nis-pentagon-city-plan.json（cplan-05fc365153161177，渲染返回与文件一致）+ tools/scratch/generate-nis-pentagon-plan.mjs + tools/tests/test-nis-pentagon-plan.mjs（15495 断言全过）+ artifacts/nis-pentagon-plan.html。人口 8,077 户，中位 20,193（区间 17,769~22,616）。
- 形态：正五边形 R=1200（顶点 8m 取整，边长偏差≤0.5%），5 放射大道（中心→角）+ 7 圈同心环（法距 120/圈，Medium+Medium 黄金 96 路缘）+ 环间辐条 Small Road（每缺口≤5 条）；南市政带（五边形外南侧平地 z 32~−416）承接大占地设施。61 栋建筑、213 分区、199 道路，validateCityPlan 仅 61 条 ROTATION_UNRESOLVED（预期），0 压路/互叠/越界。
- **新踩坑/新方法**：
  1) 120m 环距 + 斜路上放轴对齐大建筑放不下（对角支撑距吃满 96 路缘带）→ 大占地公服一律放外部市政带，别塞街区。
  2) 分区 >1024 上限：栅格化 + 贪心最大矩形仍 1416 → 同键栅格并集 + 边界环游提取直角多边形（unionPolygons）→ 213 个。环游自动产生外圈（正有向面积）与洞（负），洞是路格不单独成区、面积不双计（zone 面积=鞋带口径）。
  3) 渲染产物 baked SVG 投影实测：sx=800+0.1014wx、sy=795−0.1014wz（focusView 补丁用），画布 clip x=32,y=68；zoom 局部图用 tools/scratch/nis-pentagon-zoom.mjs。
  4) 同文件并行 Edit 会互相覆盖（旧内容复活）——对同一文件的多处修改必须串行 Edit 并 grep 复核。
  5) chrome 全路径 C:/Program Files/Google/Chrome/Application/chrome.exe；bash 缺 ls/uniq/head，管道逻辑全写进 node -e。
`;
appendFileSync('D:/Develop/game/CityWeaverMCP/.workbuddy/memory/2026-09-20.md', note);
console.log('appended ok');
