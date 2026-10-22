# 需求、决定与实现追踪

0.1.2交付后的后续复核另见[闭环核对记录](closure-followup-20261022.md)：F01～F06分别对应U04/U05/U14、U08、U10、U12及U08/U09，不增加延期功能。候选0.1.3仍在验证，当前手机体验版仍为0.1.2；本次源码变化不倒填下方已上传包的验收结果。

10月22日最终交付状态另见[0.1.2体验版修复与复测清单](release-notes-0.1.2.md)：后端已部署，客户端已上传，用户确认体验版可用；手机业务实测仍待反馈。下方未部署/未上传描述保留各自旧时点，不覆盖本条后续回执。

核对日期：2026-10-21。本表把用户要求、已确认的产品决定、工程方案、当前源码和已执行证据串起来，供其他开发者从 Git 接手。最新交接状态先看[交接记录](handoff-20261021.md)，运行方法看[开发指南](development-guide.md)，模块与数据关系看[架构与数据](architecture-and-data.md)。本表不替代字段字典，也不把源码存在写成线上已生效。

2026-10-22补充批次见[四项用户问题修复记录](bugfix-20261022.md)。本表原310/47项等数字保留10月21日证据，新批次336/61项、0.1.2源码、20迁移、COS运行恢复与未部署/未上传边界以该记录为准，不覆盖旧平台回执。

16:49:48（上海时间）新增[生产部署回执](deployment-20261022.md)：`58e2bc7`已推送，配套API/worker已部署，生产精确20迁移且schema差异0；隔离PostgreSQL及四组HTTP各61/61通过。0.1.2尚未上传/设体验版，需用户手工处理项目安全确认；手机及多账号验收仍未完成。下表及此前段落中的“未部署/生产19迁移”保留原批次语境，不再代表该回执之后的生产状态。

## 来源与判定方法

| 标记 | 含义 | 使用边界 |
| --- | --- | --- |
| U | [设计契约](design/contract-details.md)明确标注的用户要求 | U01～U13是原需求的归纳，不当作逐字原话；U14来自后续明确范围决定 |
| 已确认决定 | 决定记录载明用户确认来源或原话 | 只确认记录列明的事项，不扩展为批准全部工程细节、部署或正式发布 |
| E | 工程方案、实现决定或建议 | 文件名含“决定”不自动等于用户逐项确认；除非另有明确确认来源，仍按工程细化理解 |
| 源码已实现 | 当前仓库能定位到相应行为和测试 | 不等于该源码已部署、微信上传、手机验收或审核通过 |
| 历史证据 | 有日期、提交或执行记录的测试、部署、平台回执 | 只证明对应时点与范围，不能自动续写为当前生产事实 |
| 待验 / 延期 | 尚无对应验收证据，或用户主动移出当前范围 | 待验不是已失败；延期不是待开发阻塞，也不能标成已通过 |

同一事项出现差异时，先找后续有明确来源的用户决定，再核对当前源码及对应日期的证据。保留旧文档原貌，不用修改历史数字制造一致。`contract-details.md` 的 E 段落、早期原型和正式 Word 均不能覆盖后续决定。

## U01～U14 追踪矩阵

下表“源码”均指仓库当前代码；“证据”给出可执行测试或已归档记录的位置，表内没有把全部业务验收统一标为通过。

| 编号与用户需求 | 设计及决定 | 当前源码入口 | 证据位置与尚待确认的边界 |
| --- | --- | --- | --- |
| U01：夫妻、家人与受限朋友共同使用；朋友按需获准点菜或露营 | D01～D03；[登录会话实现](design/decisions-20260903-auth-sessions.md)为工程细化 | [认证](../apps/api/src/auth/auth.service.ts)、[家庭](../apps/api/src/households/households.service.ts)、[成员](../apps/api/src/members/members.service.ts)、[客户端会话](../apps/client/src/services/session.ts) | `apps/client/test/join-flow.test.cjs`、`members-flow.test.cjs`、`session-race.test.cjs`；API A01～A08、A44～A45。真实第二微信账号、邀请与撤权体验待验 |
| U02：账号可叠加角色；厨师是餐饮子角色 | D02～D03；角色并集、模块覆盖及DENY优先是契约工程算法，不按昵称授权 | [权限策略](../apps/api/src/access/permission-policy.ts)、[实时授权](../apps/api/src/access/access.service.ts)、[成员管理页](../apps/client/src/pages/members/index.vue) | `apps/api/test/access.integration.test.cjs` A04、A07及权限版本用例；`apps/client/test/members-flow.test.cjs`。家庭管理员身份不自动授予未加入行程的读取权 |
| U03：分类菜谱，结构化食材、调料、图片；调料无用量，不填难度和忌口 | D04、P05～P07；[图片代理方案](design/decisions-20260901-media-proxy.md)和[图片隐私处理](design/decisions-20260921-image-privacy.md)为工程细化 | [菜谱服务](../apps/api/src/recipes/recipes.service.ts)、[编辑页](../apps/client/src/pages/recipe-editor/index.vue)、[只读详情](../apps/client/src/pages/meal/index.vue) | `apps/client/test/recipe-editor.test.cjs`；`meal-flow.test.cjs` 的P06渲染用例；API A09～A10、A46及媒体用例。本轮补齐VIEW用户查看完整做法，未随本轮源码部署；手机录入、图片上传及显示待验 |
| U04：成员分别选某餐，汇总待做菜单和食材；库存全部可查、用颜色辅助判断 | D05～D06、P08～P09；R01已确认；U14限制库存为辅助判断 | [餐点服务](../apps/api/src/meals/meals.service.ts)、[需求汇总与对照](../apps/api/src/meals/meal-requirements.ts)、[餐点页](../apps/client/src/pages/meal/index.vue)、[手工库存页](../apps/client/src/pages/shopping/index.vue) | `meal-flow.test.cjs`、`shopping-flow.test.cjs`；API A11～A18；新增 `apps/api/test/meal-menu.unit.test.cjs`。多人意愿不乘制作份数，未知不当0、不同单位不自动换算。本轮R01整菜移除与历史做法详情已补源码，未部署；双账号点餐与备菜待验 |
| U05：非即时购物愿望与下次超市清单 | D06；U14明确购买不自动入库 | [购物服务](../apps/api/src/shopping/shopping.service.ts)、[购物与库存页](../apps/client/src/pages/shopping/index.vue) | `apps/client/test/shopping-flow.test.cjs`；API A19～A20。缺料按服务端快照重算、来源幂等，复购另建项保留历史；手机导入、勾选、撤销和复购待验。D06完整清单CRUD等工程目标不由此推导为全部已交付 |
| U06：中国地图、目的地、节点、路线、住宿、交通方式及状态线型 | D09；[一期地图范围](design/decisions-20260902-trip-itinerary.md)；[目的地优先交互](destination-first-20260917.md) | [行程服务](../apps/api/src/trips/trips.service.ts)、[路线住宿组件](../apps/client/src/components/trip-itinerary.vue)、[原生交互隔离](../apps/client/src/services/trip-native.ts) | `apps/api/test/itinerary.unit.test.cjs`、`trip-create.unit.test.cjs`；客户端 `access-flow.test.cjs`，API A30～A32。当前保留明确标注的示意线；供应商搜索/真实道路规划留后。位置接口准入、手机选点、线型与动画待验 |
| U07：用户自行命名、自行填写行李模板，不存在系统烧烤模块 | D08；[模板历史与并发决定](design/decisions-20260903-packing-template-history.md) | [行李模板与快照服务](../apps/api/src/packing/packing.service.ts)、[露营页](../apps/client/src/pages/camping/index.vue) | API A24～A29、`apps/client/test/access-flow.test.cjs`。按来源ID复制快照，不按名称套特殊逻辑；模板变化不覆盖旧行程。手机创建、套用、重复套用和历史展示待验 |
| U08：与朋友协作，可由不同家庭负责不同物品 | D07～D08；[行程协作实现决定](design/decisions-20260902-trip-collaboration.md)采用行程内准备小组，不读取朋友真实家庭档案 | [行程成员与小组](../apps/api/src/trips/trips.service.ts)、[物品分配](../apps/api/src/packing/packing.service.ts)、[露营页](../apps/client/src/pages/camping/index.vue) | API A23、A29及小组/责任用例；客户端组、人、状态筛选回归。被指派为负责人不自动增加编辑权；真实朋友账号的分工协作待验 |
| U09：非行程成员不能进入；正常参与者保留历史；旅中旅后可加照片 | D07、D10；R02已确认；[照片独立权限](design/decisions-20260921-trip-photo-permission.md)是后续工程落地记录 | [成员访问](../apps/api/src/trips/trips.service.ts)、[私有媒体](../apps/api/src/media/)、[相册组件](../apps/client/src/components/trip-photos.vue) | API A21～A22、A33～A35；新增 `apps/api/test/trip-history-access.unit.test.cjs`。本轮补完成/取消后OWNER收缩历史访问和照片授权，历史业务保持只读，源码尚未部署；真实照片及双账号撤权待验。照片说明、节点/拍摄日期筛选和软删除等旧工程提案不冒充完整实现 |
| U10：家庭待办有负责人和提醒 | D11、D13；R03确认REQUEST是家庭请求；[待办决定](design/decisions-20260902-tasks.md)、[站内提醒](design/decisions-20260903-notifications.md)为工程细化；R05延期微信通道 | [待办服务](../apps/api/src/tasks/tasks.service.ts)、[通知服务](../apps/api/src/notifications/notifications.service.ts)、[worker](../apps/api/src/notifications/worker-main.ts)、[待办页](../apps/client/src/pages/tasks/index.vue) | `apps/api/test/tasks.update.unit.test.cjs`、`notifications.unit.test.cjs`；API A36、A41；客户端 `access-flow.test.cjs`。本轮修复清空说明、保持原负责人、明确改派及日期精度，复用既有负责人目录，源码未部署；站内提醒不等于微信推送，手机分配和提醒体验待验 |
| U11：日历为主入口，可创建餐点并聚合纪念日、行程等 | D01、D11；[公历纪念日决定](design/decisions-20260903-anniversaries.md) | [日历服务](../apps/api/src/calendar/calendar.service.ts)、[日历首页](../apps/client/src/pages/index/index.vue)、[日期详情](../apps/client/src/pages/date-detail/index.vue) | `apps/client/test/calendar-flow.test.cjs`；API A30、A36～A37、A43。按来源权限过滤并处理跨月、上海日期；农历生日及单次重复例外未纳入当前闭环，不能按旧契约工程提案写成已有功能 |
| U12：收藏灵感、家庭档案、非财务生活看板 | D12；R03；[收藏](design/decisions-20260903-favorites.md)、[档案](design/decisions-20260903-archive.md)、[看板](design/decisions-20260903-dashboard.md)为实施细化 | [收藏服务](../apps/api/src/favorites/favorites.service.ts)、[档案服务](../apps/api/src/archive/archive.service.ts)、[看板服务](../apps/api/src/dashboard/dashboard.service.ts)及同名客户端页面 | API A38～A40；客户端 `access-flow.test.cjs`。收藏转草稿不猜材料做法；档案按字段ACL加密；看板按来源授权。首批档案不默认收证件和银行卡；实际账号授权与显示待验 |
| U13：代码Git托管、Docker部署，单域名pp6v4.com经/api/代理，后续Web/App | D02、D14；R06批次交付；[同域图片方案](design/decisions-20260901-media-proxy.md) | [Docker Compose](../infra/docker-compose.yml)、[Nginx生产配置](../infra/nginx/production.conf)、[部署说明](../infra/deploy/README.md)、[客户端API封装](../apps/client/src/services/family-api.ts) | [开发指南](development-guide.md)、[架构与数据](architecture-and-data.md)、API A42。生产、平台上传、审核和发布分别取证；本轮文档整理及隔离编译不等于重部署。Web/App是后续扩展方向，不是已验收端 |
| U14：一期不自动增减库存，保留人工核实和辅助判断 | [2026-09-01确认](design/decisions-20260901.md)，覆盖D05/D06旧自动消耗、购买入库工程设计 | [餐点完成](../apps/api/src/meals/meals.service.ts)、[购物状态](../apps/api/src/shopping/shopping.service.ts)、[人工库存调整](../apps/api/src/inventory/inventory.service.ts) | API A18～A20明确断言库存与自动流水不变；客户端完成确认框说明不自动扣库。自动消耗、购物入库、精细批次核销为延期项，不能作为一期缺口重新加回 |

## 已确认决定与后续覆盖

| 决定 | 可核对来源 | 确认内容与优先级 |
| --- | --- | --- |
| R01 | [2026-08-31确认记录](design/decisions-20260831.md)载明用户“同意，授权”及有限事项 | 确认后由厨师/餐点管理者改单，保留变更和新快照；不是授权普通点菜者绕过确认。对应本轮源码补齐见下节 |
| R02 | 同上 | 正常完成保留历史，主动撤销优先，曾参加不等于永久访问；本轮补完成后仍能收缩授权 |
| R03 | 同上 | 档案首批为地址、联系人、自定义非高敏字段；工单为家庭REQUEST。该次授权不包含生产数据写入或所有工程建议 |
| U14 | [2026-09-01库存范围确认](design/decisions-20260901.md)中的用户要求转述 | 完成做饭不扣库、购买不入库；手工库存、未知状态、调料有无和缺料购物保留。不得回用旧A18自动扣减预期 |
| R05 | [2026-09-10确认](design/decisions-20260910.md)保留用户原话“还没选，我觉得先不搞这些吧” | 微信订阅模板、授权入口、发送开发和联调延期，站内Inbox保留；不是取消所有提醒 |
| R06 | 同上，区分用户对交付节奏的反馈与工程调整 | 按功能批次验证和交付；Git提交、本地编译、微信上传、服务器部署是不同操作，不由某一项自动推导其他项 |
| 2026-10-08～09发布节奏 | [当时发布进展](release-progress-20261008.md)保留“暂时不真机验收，请继续完成上线流程” | 改变当时“真机先于上传”的顺序；不能将延期真机标通过，也不是当前备案、审核或服务健康复核 |
| 2026-10-21测试交付 | [表单修复记录](form-usability-fixes-20261021.md)保留“你提交版本，我进行实机测试”及0.1.1上传回执 | 已上传表单修复开发版本，用户负责手机实测；其后新增源码不自动进入该上传版本，上传不等于审核或正式发布 |

R04为地图Key、平台资格等外部联调项，不是已确认通过的产品验收。未得到明确来源的E级细节，如完整购物清单CRUD、复杂照片元数据管理、缓存方案等，应先核对是否仍在本期范围，再安排实现，不能与U/R的确定缺口混为一谈。

## 2026-10-21 本轮补齐及交付边界

| 本轮内容 | 当前源码及专项证据 | 当前交付状态 |
| --- | --- | --- |
| R01管理员调整已确认餐点 | 显式 `POST /meals/:id/dishes/:recipeId/remove`；MANAGE、DRAFT、expectedVersion、可串行化事务；原本人撤回接口仍只撤回本人；审计保存被移除意愿及版本。`apps/api/test/meal-menu.unit.test.cjs`、`apps/client/test/meal-flow.test.cjs` | 源码补齐；需显式重开后调整、重新确认生成新快照；本轮未部署 |
| P06只读菜谱与做法详情 | `meal/index.vue` 点菜、菜谱库和菜单入口；VIEW可读、EDIT按钮独立；当前菜谱与已确认快照标明来源；按序展示食材、调料、做法；真实SFC编译及Vue SSR渲染断言 | 源码补齐；已确认快照不被当前菜谱替换，离页/身份变化清空详情；未作为已上传0.1.1或手机验收结果 |
| R02历史访问收缩 | `trips.service.ts`、`camping/index.vue`；`trip-history-access.unit.test.cjs`和客户端行为回归 | 源码补齐；完成/取消后仅允许收缩授权，不重开业务编辑；本轮未部署 |
| 待办保存与负责人闭环 | `tasks.service.ts`、`tasks/index.vue`；`tasks.update.unit.test.cjs`及客户端回归 | 本轮修复清空说明、保持停用原负责人、不默改分配、明确保留选项和上海日期/时间精度；原有待办专用负责人目录继续复用，不冒充本轮新增；未部署 |

本轮统一检查结果为客户端 **310/310**、API单元 **47/47** 通过；隔离新目录的微信编译通过。具体检查入口和本轮发布边界以[交接记录](handoff-20261021.md)为准。API单元、内存事务或SSR渲染不是本轮真实PostgreSQL/手机全流程验收；本轮未据此改写旧A01～A46、C01～C03的人工验收状态。原 `outputs/mp-weixin` 测试目录及此前上传产物未被本轮隔离编译覆盖。

## 2026-10-22用户实测问题与需求对应

| 用户问题 | 对应需求/设计 | 本次实现及边界 |
| --- | --- | --- |
| 配料无法删除 | U03 / D04 | 菜谱调料逐行删除、食材及调料末行清空；保存时仍校验有效食材，锁定/越界不改草稿；`recipe-editor.test.cjs` |
| 保存提示图片存储尚未配置 | U03 / D10 / U13 | COS缓存预留门槛导致真实EIO，服务器运行参数已有限修正；源码区分缺配置与运行失败，不新增上传重试。真实合成PNG校验不等于用户手机业务保存通过 |
| 没地方点菜 | U04 / D05 / P08 | 显式创建/继续点菜、菜谱库/菜单返向入口、空态和权限引导；实际使用原餐点及选择API，不建立假菜单；`meal-flow.test.cjs` |
| 日历纪念日无法删除 | U11 / D11 | 列表显式删除；YEARLY确认整系列影响；旧CalendarEvent增加version/archivedAt并以专用接口软归档。沿用家庭共享calendar:EDIT，不擅改为仅作者/管理员；`calendar-flow.test.cjs`、`calendar-archive.unit.test.cjs`、第20迁移和HTTP/升级fixture |

本批客户端336/336、API非数据库61/61及独立outDir编译通过；数据库源码50models/20迁移，但生产仍旧业务/19迁移，0.1.2未上传。隔离PostgreSQL任务已启动且最终回执待补；新补的整菜移除、停用负责人保留、旧纪念日软归档HTTP用例不因存在而记PASS。完整环境与交付证据见[本轮记录](bugfix-20261022.md)。

## 接手后怎样补证据

10月22日部署后：B01/B03的前端按钮与B04列表入口需待0.1.2真正上传并设为体验版才能在手机核对；B02配套后端错误分类及B04旧纪念日软归档API已随`58e2bc7`部署。四项均不能自动标为用户手机PASS；操作入口、逐项期望及NOT_RUN_PHONE清单见[当日部署记录](deployment-20261022.md#3-012体验版的手机复测清单尚未执行)。R01/R02/P06及待办/看板配套源码包含在本次部署，真实协作体验仍需独立取证。

1. 从本表找到U/R及对应D/P/A编号，先读后续决定，避免把自动库存或微信订阅重新加入当前范围。
2. 依[开发指南](development-guide.md)运行当前源码检查，保存命令、日期、分支/提交、输入、输出及测试环境；不要拿旧文档里的通过数字当新检查结果。
3. 新API、客户端产物、服务器部署分别确认版本；R01的新接口和配套客户端应成批交付，不能把依赖新接口的源码当作旧0.1.1已可用功能。
4. 用户实测按真实账号检查登录邀请、菜谱做法与图片、多人点餐/重开改单/快照、缺料购物、行程分工/历史撤权/照片；逐项记结果，不建立演示生产数据充当验收。
5. 平台上传、体验版标记、备案、审核、正式发布和实时生产状态，各取对应回执。历史部署记录保留，用新增记录描述新事实。
