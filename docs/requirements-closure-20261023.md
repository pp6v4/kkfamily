# 需求闭环复核与未完成清单（2026-10-23）

核对源码：0.1.2交接基线`05859fd`，候选业务`df776da`＋审查补丁`e60a134`。本次根据用户“0.1.3改了什么，还有没有需求不能闭环的，请完善一遍项目文档，提交git”复核，不新增范围、不修改业务或发布。

后续Q02实际反馈：用户0.1.2手机发现食材比对空JSON报错，已复现并按明确授权部署仅此兼容热修，16:34:08公网旧空请求及{}均201。源87bc451/镜像/测试及局限见[热修回执](hotfix-empty-json-20261023.md)；客户端修复在候选cd33ed6，手机复测待反馈。Q01依旧未修，原“只有文档变更”仅指此前批次。

**结论：不能称为全部闭环。** 主业务入口→API→数据/权限链已能定位，但本次确认Q01地图阶段线型偏差尚未修复；手机、多账号及正式发布也没有完成证据。未实现的工程增强、用户明确延期和确定缺陷分别列示，不将它们混为“都完成”或“全部是bug”。版本与测试快照见[当前交接](project-status-20261023.md)。

## 1. 判定口径

- **代码链有证据**：当前真实页面调用真实API，服务与数据/权限规则能串联，并有对应行为/接口验证入口；不是宣称所有异常排列已穷尽。
- **已确认缺口**：能给出明确需求、当前反例与验收条件。Q01属于此类，当前保持OPEN，不以文档写完代替修复。
- **待实测/待交付**：缺手机、真实协作或部署回执，不是已失败，也不自动算源码未实现。
- **待范围确认的E增强**：早期工程建议不等于用户确认必须在一期交付；如需实现先评审，不能隐瞒“尚未实现”。
- **延期/不做**：后续明确决定覆盖旧设计；不为了闭环率擅自恢复功能。

原始来源为[设计契约U01～U13](design/contract-details.md)、[U14范围调整](design/decisions-20260901.md)及[需求追踪的R决定](requirements-traceability.md)；工程决定不等于用户对每个技术细节逐条确认。

## 2. U01～U14逐项核对

| 需求 | 当前入口→服务→结果 | 源码/验证入口 | 结论与未完成边界 |
| --- | --- | --- | --- |
| U01 夫妻家人和受限朋友 | 微信身份→创建/邀请加入家庭→管理员分配→按获准模块操作 | [auth](../apps/api/src/auth/auth.service.ts)、[members](../apps/api/src/members/members.service.ts)、`join-flow`/`members-flow`/`session-race`测试 | 代码链有证据；第二真实微信账号、朋友邀请与撤权待实测；不按昵称授权 |
| U02 多角色、厨师餐饮子角色 | 角色并集→模块覆盖→DENY→每次读当前有效成员，行程另核成员 | [权限策略](../apps/api/src/access/permission-policy.ts)、[实时访问](../apps/api/src/access/access.service.ts)、`access.integration` | 代码链有证据；真实管理员/厨师/只点菜朋友/只露营朋友组合待验；家庭管理员不绕过行程隔离 |
| U03 分类与结构化菜谱 | 菜名/分类/食材/调料/步骤→草稿→私有图片确认→发布→只读用料做法 | [编辑页](../apps/client/src/pages/recipe-editor/index.vue)、[recipes](../apps/api/src/recipes/recipes.service.ts)、`recipe-editor`/`meal-flow`及API A09/A10/A46 | 代码链有证据；调料不要求用量，无难度忌口字段。0.1.2已有B01/B02/P06，原生输入、相册、保存及封面待手机反馈 |
| U04 按某餐各自点菜、菜单材料与库存颜色辅助 | 日历/吃什么→同餐选择→实际份数→确认快照→全部用料/有无未知→选缺料导入 | [meal页](../apps/client/src/pages/meal/index.vue)、[汇总](../apps/api/src/meals/meal-requirements.ts)、[meals](../apps/api/src/meals/meals.service.ts)、`meal-flow`及A11～A18 | 代码链有证据；多人选同菜不自动乘人数，单位不同/未知不当0。0.1.2有B03/R01；0.1.3有F01。真实双方点菜、重开改单与快照待验 |
| U05 非即时愿望和下次超市 | 新增愿望/下次买/补货→筛选→已购/撤销→复购；缺料服务端重算幂等 | [shopping页](../apps/client/src/pages/shopping/index.vue)、[shopping服务](../apps/api/src/shopping/shopping.service.ts)、`shopping-flow`及A19/A20 | 原U05主链有证据，F01补未知数量单位；不是全部清单CRUD，E01另列。手机购物状态/来源/重试待验 |
| U06 中国地图与行程、路线、住宿、交通和状态线型 | 地图总览→选目的地→保存日期名称→节点/路段/交通/住宿→状态→历史地图 | [camping页](../apps/client/src/pages/camping/index.vue)、[路线组件](../apps/client/src/components/trip-itinerary.vue)、[itinerary](../apps/api/src/trips/itinerary.service.ts)、`trip-create`/`itinerary`/`access-flow` | **部分闭环：Q01未修**。有真实850ms颜色脉冲和箭头参数，不是地图占位；正常与过期路线必须分别验。示意线非道路导航；原生选点/地图效果待真机 |
| U07 自定义模块化行李模板 | 用户自填模板与物品→选择已有行程→显式套用→独立快照；可手工加项 | [packing服务](../apps/api/src/packing/packing.service.ts)、`access-flow`及A24～A29 | 代码链有证据；无系统烧烤模块，按来源ID去重、重套不覆盖/复活排除项，模板改名/归档不改历史；手机创建/套用待验 |
| U08 不同家庭/朋友分工 | 行程成员→行程内准备组→组与负责人→筛选/备齐→撤权时显式处理责任 | [trips](../apps/api/src/trips/trips.service.ts)、[packing](../apps/api/src/packing/packing.service.ts)、`packing-assignment.unit`及真实并发专项 | 代码链有证据；F02/F06/RV01已补源码。组表示准备方，不读取朋友真实家庭档案；负责人不自动授编辑权；真实朋友协作待验 |
| U09 未参加不可进入、历史可看、旅中旅后照片 | 列表/日历/看板/媒体按行程关系→完成保留HISTORY→有photoAdd可补图→主动撤权优先 | [trips](../apps/api/src/trips/trips.service.ts)、[照片组件](../apps/client/src/components/trip-photos.vue)、[media](../apps/api/src/media/media.service.ts)、`trip-history-access`及A21/A22/A33～A35 | 代码链有证据；照片另需家庭模块权与photoAdd，终态只允许减权不恢复业务编辑；真实旅后上传、撤权与旧短链窗口待验。高级相册管理E02未实现 |
| U10 家庭待办/工单、负责人和提醒 | 我的家→TODO/家庭REQUEST→负责人/内容/截止/提醒→处理记录/状态→INBOX调度 | [tasks](../apps/api/src/tasks/tasks.service.ts)、[通知调度](../apps/api/src/notifications/notification-schedule.service.ts)、[worker](../apps/api/src/notifications/worker-main.ts)、`tasks.update`/`notifications`/`task-edit-date-clear` | 主链有证据；F03补编辑清日期。站内提醒不是微信推送；任务附件/完整归档CRUD属E03，不能称已实现；真实分配/到期/来源点击待验 |
| U11 日历聚合、纪念日、从日历建餐 | 日历→日期详情→原餐点/行程/待办；公历ONCE/YEARLY→系列或旧独立纪念日软归档 | [calendar](../apps/api/src/calendar/calendar.service.ts)、[日期页](../apps/client/src/pages/date-detail/index.vue)、`calendar-flow`/`calendar-archive`及A30/A36/A37/A43 | 代码链有证据；0.1.2 B04含第20迁移。按上海日期与来源权限；年度删除整个系列，农历/单次例外E04未实现；手机跨月/闰日/归档待验 |
| U12 收藏、家庭档案、生活看板 | 手录收藏→带幂等键转换草稿；字段定义/ACL→显式解密/审计；授权来源→非财务聚合 | [favorites](../apps/api/src/favorites/favorites.service.ts)、[archive](../apps/api/src/archive/archive.service.ts)、[dashboard](../apps/api/src/dashboard/dashboard.service.ts)、生命周期/转换专项及A38～A40 | 代码链有证据；F04/F05已补。默认不收证件银行卡，列表不回明文；实际跨账号ACL与显示待验；无网页自动抓取、自动多密钥轮换或Redis看板缓存 |
| U13 Git、Docker、单域名，未来Web/App | Git源码/PR→隔离校验→Docker/API/worker→Nginx `/api/v1` | [部署编排](../infra/docker-compose.yml)、[Nginx](../infra/nginx/production.conf)、[部署手册](../infra/deploy/README.md)、[开发指南](development-guide.md) | 0.1.2有交付记录，0.1.3尚未交付；平台审核/正式发布未完成。网站首页是备案页不是Web家庭应用；Web/App是后续扩展，不算已交付端 |
| U14 一期不自动扣增库存 | 做饭完成只改状态；购买只改购物状态；库存单独人工登记/调整 | [inventory](../apps/api/src/inventory/inventory.service.ts)、[meals](../apps/api/src/meals/meals.service.ts)、[shopping](../apps/api/src/shopping/shopping.service.ts)及A18～A20 | 与确认范围一致；F01不改变该规则。自动消耗、购物自动入库和精细核销不作为一期欠项补回 |

矩阵中的短测试名对应仓库`apps/client/test/*.test.cjs`或`apps/api/test/*.test.cjs`，不是本轮全部重新运行的PASS声明；真实执行快照与数量见[当前状态](project-status-20261023.md)。

## 3. 已确认但未修复：Q01 / U06 / OPEN

**问题：过期路线的可信度状态覆盖了旅途阶段线型，完成后还无法通过正常编辑消除这一显示状态。**

来源：[一期路线决定](design/decisions-20260902-trip-itinerary.md)明确“待出行路线使用闪烁虚线，旅途中和已完成使用实线箭头”；节点变化应标为待重新规划，但没有确认其覆盖完成阶段的箭头要求。

| 环节 | 当前源码事实 | 后果 |
| --- | --- | --- |
| 产生过期状态 | `ItineraryService.updateStop`/`reorderStops`把关联`TripLeg.staleAt`设为非空，包含示意路线 | 编辑节点或排序即可通过正常流程到达，并非构造非法数据库值 |
| 地图总览 | `camping/index.vue`的`overviewPolylines`将`pending || Boolean(staleAt)`作为dotted，只有非dotted才画箭头 | DEPARTING/COMPLETED且stale时仍虚线、无箭头 |
| 行程详情 | `trip-itinerary.vue`的`polylines`使用相同优先级，dotted颜色随850ms脉冲改变 | 总览和详情同时偏离阶段规则，不是单一原生渲染猜测 |
| 完成行程 | `TripsService.updateStatus`更新行程/历史成员，不清理路段staleAt；`ItineraryService.requireTrip`禁止终态编辑 | 完成后不能靠修改该路线恢复箭头；不能为修显示解锁历史编辑 |

本轮在内存中加载现有真实Vue SFC测试harness，检查2个视图×4种状态（PLANNING/PENDING/DEPARTING/COMPLETED）×2种stale值，共16组合。**12组合符合阶段规则，4组合偏离**：两个视图的DEPARTING/COMPLETED＋stale均为`dottedLine=true, arrowLine=false`；不是16项验收PASS。没有使用生产数据，也没有实际操控原生地图。

正常复现：在可编辑测试行程建两个节点及示意路段→修改节点或排序产生“路线待重新规划”→不编辑路段，推进到旅途中/完成→查看总览和详情，仍显示闪烁虚线。当前不是0.1.3 F02/RV01引入的新行为；本次仅记录，不修改业务。

后续修复验收条件（工程建议，未作为本轮实现）：

1. 总览/详情对相同状态一致；待出行仍虚线，旅途中/完成为实线箭头。
2. 路线过期可信度另有明确文字或视觉标识；不能自动清`staleAt`、把失效几何冒充新规划，或伪造道路结果。
3. 完成行程仍只读，历史节点/路段与权限不被修改；地图动画在隐藏/卸载后释放。
4. 增加先复现后修复的真实SFC16组合回归，补实际节点更新→完成的流程验证，并在恢复交付后另验原生地图。

## 4. 未实现、须先定范围的旧E工程增强

| 编号 | 早期提案与当前实际差异 | 当前处理 |
| --- | --- | --- |
| E01 购物管理增强 | D06提议创建/改名/归档任意清单、修改/移除购物项；当前主要为系统清单、新增、状态变更、导入与复购。库存名称/单位/位置也不能原位编辑 | 未实现，不宣称全CRUD；是否加入下一批由用户按实际痛点确认，不擅自加删除 |
| E02 高级照片管理 | D10提议说明、拍摄日期、节点关联/筛选、完整软删除；当前主链是授权上传/查看与媒体引用，没有独立TripPhoto模型 | 旅中/旅后相册主需求有链路；高级管理未完整交付，不以字段提案当事实 |
| E03 待办附件/归档CRUD | D11提议附件与删除归档；现有REQUEST/内容/负责人/状态/处理记录/提醒不等于提供任务归档或附件上传接口 | 未实现，需范围确认；NotificationJob能处理archivedAt不等于有归档入口 |
| E04 日历增强 | 农历生日、仅取消某年一次的重复例外不在现有ONCE/YEARLY主链 | 未实现；当前删除年度纪念日为整系列，不暗改语义 |
| E05 工程扩展 | PostGIS、Redis缓存/通用队列、自动网页收藏抓取、档案自动多密钥轮换是旧提案或未来方案 | 当前没有相应完整能力；不为补文档引入依赖、扩大权限或承诺已启用 |

这些不是替用户缩小U需求：原始U主链逐项列在第2节，Q01按确认要求明确列OPEN；E增强单列是为了避免把“未做”隐藏成“已完成”。

## 5. 待验证和交付的明确清单

| 编号 | 未完成事项 | 完成需要的证据 | 当前责任/顺序 |
| --- | --- | --- | --- |
| V01 | 0.1.2四项用户bug及主业务真机 | 版本0.1.2、B01～B04逐项操作/预期/实际，菜谱图片→点菜→备菜购物等记录 | 用户继续测试；未知不标PASS，失败再形成具体修复 |
| V02 | 真实夫妻/朋友账号协作与权限 | 至少两账号点同餐、邀请、角色/显式DENY、行程准备组、主动撤权后日历/看板/照片过滤 | 经双方同意的测试记录；代理不擅改真实权限 |
| V03 | 原生位置/地图/相册/输入及视觉 | 手机原生事件、位置准入、底图线型动画、图片重进可读、输入不丢失 | 与代码/模拟接口区分；Q01先修复后验阶段线型 |
| V04 | 最新候选构建和配套交付 | 从含RV01及后续修复的确切源提交新建outDir编译、探针、文件摘要；后端镜像/回执及微信版本分别记录 | 按R09暂停，等待未来发布指令；旧df776da产物不能冒充最新 |
| V05 | 平台合规、正式审核/发布 | 当前平台备案/权限/隐私资料及审核/发布回执；ICP网页号不替代小程序备案，公安号未收到不编造 | 所有者处理平台认证/确认；本轮未查后台，不推测审批结果 |
| V06 | 正式上线前测试数据清理 | 精确表/记录/媒体清单、账号/家庭/权限/配置保留方案，备份、真实恢复验证及当时确认 | R08约束；既有dump校验/pg_restore目录检查非完整恢复，本轮不清理 |
| V07 | 开发者工具黑屏 | 新授权下的实际工具正常打开/编译证据 | 根因未确定，本轮不接管、不清缓存、不改安全设置；不是要求用户再点信任 |

## 6. 明确不属于本轮欠开发的内容

U14已移出一期：做饭自动扣库、购物自动入库、葱等精细消耗核算。用户排除账本预算/费用分摊和周期家务积分；R05延期微信订阅模板、授权入口及外部发送，保留站内INBOX。地图一期仅示意路线，真实道路规划/供应商搜索留后；Web/App是后续扩展方向，不是现有交付端。

本次文档完成只意味着“变更说明、需求复核、剩余项及协作入口已整理”，不意味着Q01已修、V项已通过或允许发布。后续按明确任务消项并保留其新证据，不改写历史PASS日期或旧确认稿。
