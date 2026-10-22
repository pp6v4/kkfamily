# 总体架构、模块设计与数据库概览

核对日期：2026-10-22。面向后续开发者及 LLM，以当前仓库源码、Prisma 模型、迁移 SQL 和部署模板为依据，不是本次生产服务器实时检查报告。业务需求与范围先读[需求追踪](requirements-traceability.md)、[设计契约](design/contract-details.md)及其后续决定；安装、检查和交付步骤见[开发指南](development-guide.md)。

## 1. 状态与证据边界

- 当前模型有 **50 个 Prisma model、20 个增量迁移目录**；这是源码计数，不是本次连接生产库得到的表数量或迁移执行结果。Prisma 自建的迁移管理表不属于这 50 个业务 model。
- 微信开发版 `0.1.1` 是上一批已上传的客户端。之后的 R01 餐单管理、R02 终态行程减权、P06 选菜操作，以及待办/看板修复属于当前源码批次，尚未部署服务器或重新上传微信；不能用同一个版本字符串推断两者内容相同。
- API `package.json` 的版本、客户端版本、Git 提交、数据库迁移版本、运行镜像和微信上传版本是不同标识，接手时应分别核对。
- 本文不新增功能承诺。自动库存扣增、账本预算、微信订阅发送、真实道路规划仍按既有范围决定延期；Web/H5 与原生 App 是扩展目标，不是已交付验收的产品。

## 2. 总体结构与部署边界

```text
微信小程序（uni-app / Vue 3 / TypeScript）
  └─ HTTPS https://pp6v4.com/api/v1/…
       └─ Nginx /api/ → api:3000/ （内部 /v1/…）
            ├─ NestJS / Fastify → Prisma → PostgreSQL
            └─ 私有图片代理 → COS SDK 或受校验的 COS 挂载

notification-worker → 同一 PostgreSQL 的 NotificationJob / InboxItem
Redis → Compose 已配置；当前通知队列和看板未接入 Redis
```

这是仓库部署模板的结构，不表示这些容器在本文编写时已实际运行或健康。

| 层 | 实现及权威位置 | 关键边界 |
| --- | --- | --- |
| 客户端 | [apps/client](../apps/client)、[pages.json](../apps/client/src/pages.json) | 14 个注册页面，5 个主入口；微信原生选点、相册和预览需要真机验证 |
| 请求与会话 | [session.ts](../apps/client/src/services/session.ts)、[transport.ts](../apps/client/src/services/transport.ts)、[family-api.ts](../apps/client/src/services/family-api.ts)、[members-api.ts](../apps/client/src/services/members-api.ts) | 会话代次、单飞续期、家庭上下文、过期结果丢弃；不能只靠隐藏按钮授权 |
| API | [apps/api/src](../apps/api/src)、[main.ts](../apps/api/src/main.ts) | NestJS 11 / Fastify 5，内部全局前缀 `/v1`；DTO 转换及白名单校验 |
| 数据访问 | [schema.prisma](../apps/api/prisma/schema.prisma)、[serializable.ts](../apps/api/src/prisma/serializable.ts) | PostgreSQL，Prisma 6；部分关键流程使用 Serializable 事务和受限冲突重试 |
| 图片 | [media](../apps/api/src/media) | 私有归属、上传确认、像素解码重编码、短期读能力链接；不向客户端下发 COS 密钥 |
| 提醒 | [notifications](../apps/api/src/notifications) | PostgreSQL 任务和站内收件箱；独立进程轮询，不是 BullMQ |
| 容器与入口 | [docker-compose.yml](../infra/docker-compose.yml)、[nginx.conf](../infra/nginx/nginx.conf)、[Dockerfile](../apps/api/Dockerfile) | Node 22 容器基线、PostgreSQL 17、Redis 7、Nginx、Certbot；只有 Nginx 配置宿主机 80/443 端口 |

Compose 中 API 与 worker 同时加入内部网络和可出网网络，以支持微信等外部 HTTPS；PostgreSQL/Redis 仅在内部网络，没有宿主机端口映射。该模板不等于已实现主机级精细出网白名单。API 健康接口只是进程响应，不是数据库、媒体和全部业务的端到端验收。

`/` 提供备案信息静态页，**不是家庭应用 Web 版**。`infra/nginx/production.conf` 是生产配置模板，`bootstrap.conf` 供首次证书签发前使用；不要把已有 HTTPS 环境覆盖回引导配置。实际部署与证书操作见[部署说明](../infra/deploy/README.md)。

### 2.1 URL 与请求契约

- 客户端基地址在 [config.ts](../apps/client/src/services/config.ts)：`https://pp6v4.com/api/v1`，不需要新增业务子域名。
- Nginx `location /api/` 配合带尾斜杠的 `proxy_pass http://api:3000/`，因此外部 `/api/v1/meals` 对应内部 `/v1/meals`，不是再增加一层 `/api`。
- 家庭业务请求使用 `Authorization: Bearer …` 和 `X-Household-Id`。登录、刷新和首次创建家庭等身份级操作不能强行套用已有家庭前提。
- 微信客户端把逻辑 PATCH 转为 `POST 原路径/_patch`；服务端由 [patch-compatibility.ts](../apps/api/src/common/patch-compatibility.ts)注册相同处理器。两种传输共享校验与授权，不使用客户端可任意伪造的 method-override 头。
- 大部分业务返回 `{ data: ... }`；图片二进制和健康接口另有处理，不应把通用 JSON 解包器套在所有响应上。
- DTO、Controller 与 Service 是实际接口依据。`packages/contracts/src/index.ts` 仍包含早期模块枚举，不是完整权限目录，也不是生成 OpenAPI 的唯一契约。

## 3. 客户端模块与 API 位置

| 入口 / 功能 | 客户端主要位置 | 服务端主要位置 / 路径 |
| --- | --- | --- |
| 日历、当天安排 | `pages/index`、`pages/date-detail`、`services/calendar-*` | `calendar`；`/calendar/events`、`/calendar/anniversaries` |
| 吃什么、菜谱维护 | `pages/meal`、`pages/recipe-editor` | `recipes`、`meals`；`/recipes`、`/meals` |
| 买东西、手工库存 | `pages/shopping` | `shopping`、`inventory`；`/shopping-lists`、`/inventory` |
| 去露营、行李模板 | `pages/camping`、`components/trip-itinerary.vue`、`components/trip-photos.vue` | `trips`、`packing`、`media`；`/trips`、`/packing-templates`、`/media` |
| 我的家、加入家庭 | `pages/profile`、`pages/join` | `auth`、`households`；`/auth/*`、`/households` |
| 成员与权限 | `pages/members` | `members`；`/members`、`/households/:id/invitations`、`/invitations/redeem` |
| 家庭待办 / 请求 | `pages/tasks` | `tasks`；`/tasks`，负责人、状态、处理记录共用主链 |
| 收藏与灵感 | `pages/favorites` | `favorites`；`/favorites`、`/:id/convert` |
| 家庭档案 | `pages/archive` | `archive`；`/archive/fields`、`/:id/value` |
| 生活看板 | `pages/dashboard` | `dashboard`；`/dashboard/summary` |
| 消息与提醒 | `pages/notifications` | `notifications`；`/inbox`、`/notification-preferences` |

以上服务端路径均省略全局 `/v1`；外部请求再带 `/api`。主入口顺序固定为日历、吃什么、去露营、买东西、我的家。不要把主日历改成“我的家”内的次级入口，或把“我的家”改回不一致的名称。

页面状态包括读取、空内容、无权限、错误重试、提交中和结果反馈。会话/家庭切换、onHide、卸载以及原生相册返回可能让旧异步结果失效；不得将这些保护简化为一个全局 loading 值。源码提交成功、构建成功、模拟器可输入与真机业务成功是不同证据。

## 4. 身份、权限和隐私边界

### 4.1 三层主体

`User` 是微信身份；`Membership` 是账号在某个家庭里的成员身份；`TripMember` 是该家庭成员对某一次行程的参与关系。朋友不需要新建另一套账号体系，可作为受限家庭成员，再显式加入获准行程。准备小组表示本次出行的承担方，不连接朋友的真实家庭档案。

微信 `code` 由后端换取身份，签发 15 分钟访问令牌和轮换刷新令牌；`AuthSession` 只保存刷新令牌哈希，刷新期限为 30 天。这里的 `AuthSession.familyId` 表示**刷新会话族**，不是 `Household.id`。旧刷新令牌重用撤销同族会话；退出不等于已经在服务端撤回发出的业务事务。

### 4.2 授权算法

权威实现是 [permission-policy.ts](../apps/api/src/access/permission-policy.ts) 与 [access.service.ts](../apps/api/src/access/access.service.ts)。实际模块有 13 个：`recipes`、`meals`、`inventory`、`shopping`、`trips`、`packing_templates`、`tasks`、`favorites`、`archive`、`dashboard`、`members`、`calendar`、`notifications`。

1. 同模块内 `VIEW < EDIT < MANAGE`；不跨模块推导。
2. 多角色默认权限取较高等级；显式 ALLOW 替换该模块默认等级，可低于默认权限；DENY 最后生效。
3. 每次业务读取重新核对家庭成员 ACTIVE 状态及当前权限，不信任 JWT 中的旧角色。
4. 家庭头缺失、空白或非法先返回 400，再查业务；资源查询还需所属家庭/关联家庭条件。
5. 家庭 ADMIN 也不能读取未加入的行程。日历、看板、行李、照片都必须重新应用来源条件。

内置预设为 ADMIN、MEMBER、CHEF、CAMPER、GUEST；GUEST 默认不获模块权，CHEF 通过餐饮权限承担厨师子角色，CAMPER 的家庭露营权限仍不等于所有行程访问权。角色与模块目录不能从微信昵称、手机号或界面是否显示按钮推导。

邀请使用随机码、哈希存储、默认 48 小时、默认一次兑换；兑换、角色及覆盖规则写入和次数消耗在事务中进行。成员修改带版本号，管理员转让保护最后一名有效管理员。具体字段与可授予范围以 `members.service.ts` / `members.dto.ts` 为准。

### 4.3 行程授权与终态减权

- 读取需有效家庭成员、露营模块权及 ACTIVE/HISTORY 行程关系；REVOKED 不再可读。
- 行程、行李、节点和住宿写入需 `trips:EDIT`、ACTIVE 且 `canEdit=true`，并拒绝已完成/取消行程。
- 照片添加独立检查 `photoAdd`，不把“可加照片”当成节点/行李编辑权；家庭 `trips:EDIT` 仍是前提。
- 正常完成将 ACTIVE 关系转为 HISTORY，保留历史访问和获准补照片。
- 当前源码的 R02 修复将“编辑业务内容”与“管理访问”拆开：完成/取消后既有合法 OWNER 只能撤销访问或关闭照片权限，不能借此邀请、恢复、升权或编辑业务内容；保护最后一名未撤销 OWNER，保留终态行李与准备组快照。
- 最后一条为本次尚未部署的源码行为，不能假定正在运行的旧后端已支持。

## 5. 核心模块详细设计与闭环

### 5.1 菜谱 → 同餐点菜 → 快照 → 库存辅助 → 购物

1. 厨师维护分类及菜谱，食材关联标准 `Ingredient(kind=FOOD)`；调料关联 SEASONING，只记录名称/有无，不录用量。草稿可无封面，发布需有效食材、做法及 READY 封面。分类和菜谱归档不物理删除历史引用。
2. 家庭同日同餐通过 `(householdId, localDate, mealType, slotKey)` 唯一。`MealItem` 记录谁想吃；多人选同一道菜不等于多做几份。`MealDish.cookMultiplier` 表示实际做菜倍数。
3. 确认前按当前菜谱生成需求；确认时写新的 `MealSnapshot.data`，保存菜名、食材、调料、做法及想吃成员等快照。确认后显示冻结内容，不用后续修改的菜谱冒充历史。
4. 已确认未烹饪餐单由管理者显式 reopen 为 DRAFT，调整后重新确认，新增 snapshotVersion，保留旧快照；烹饪/完成状态不开放普通改单。当前源码新增管理者“移除本餐整道菜”，区别于成员撤回自己的选择，并写审计。
5. 需求按标准食材 ID + 单位聚合，用 Decimal 计算，返回三位小数字符串。代码实际食材状态为 `SUFFICIENT`、`SHORTAGE`、`UNKNOWN`、`NEEDS_CHECK`；调料为 `PRESENT`、`ABSENT`、`UNKNOWN`、`NEEDS_CHECK`。不同单位不换算、未登记不当零库存、过期批次提示人工核实，所有项均展示。
6. 缺料导入只接收餐点/快照/所选需求键，服务端重算缺口并校验权限，来源唯一键避免重试重复；已买记录不被重试覆盖。
7. 购物勾选仅记已购时间/操作者，复购建立新项并引用旧项。完成做饭不自动减库存、购物不自动加库存；人工维护库存单独记录流水。

权威实现：[recipes.service.ts](../apps/api/src/recipes/recipes.service.ts)、[meals.service.ts](../apps/api/src/meals/meals.service.ts)、[meal-requirements.ts](../apps/api/src/meals/meal-requirements.ts)、[inventory.service.ts](../apps/api/src/inventory/inventory.service.ts)、[shopping.service.ts](../apps/api/src/shopping/shopping.service.ts)。购物一期围绕系统“下次超市”清单与项状态实现，不应因早期设计列了更多 CRUD，就宣称任意清单管理已全部交付。

### 5.2 目的地 → 行程 → 分工 → 行李 → 历史

创建行程可带 `initialDestination`，在同一事务建立行程、创建者 OWNER、首个营地节点和日历记录；选点本身不是保存，客户端继续引导日期和名称。微信选点不可用时保留手工节点录入方式。

模板由用户自命名、自填物品，不存在按“烧烤”名称自动填充的系统模块。套用复制到 `TripPackingItem`，保存来源模板/项名称快照；唯一 `(tripId, sourceTemplateItemId)` 抵御重复套用。删模板项为归档，修改保留稳定 ID；旧行程的数量、负责人和准备状态不跟随后续模板更新。移除清单项使用 `excludedAt`，再套同模板默认不复活该来源项。

准备组成员必须属于该趟行程；指定个人时必须是有效行程成员，指定准备组后还需属于该组。负责人身份不会单独赋予编辑权。正常进行中的撤销先处理未完成责任；终态减权保留历史分工。行李状态只有 PENDING/PACKED。

节点为 `TripStop`，路段 `TripLeg` 连接同一行程中的节点，住宿 `Accommodation` 可关联节点。删除节点先获取受影响路段/住宿，再确认；路段归档，住宿解除节点关联而非悄悄删除。坐标是 GCJ02，路线几何为 JSON，不是 PostGIS geography。没有真实供应商规划时明确是示意线，不填造距离/时长。虚线闪烁、实线箭头及原生地图表现仍需真机验收。

实现入口：[trips.service.ts](../apps/api/src/trips/trips.service.ts)、[itinerary.service.ts](../apps/api/src/trips/itinerary.service.ts)、[packing.service.ts](../apps/api/src/packing/packing.service.ts)。当前相册使用媒体资产/引用，没有独立 `TripPhoto` model；照片 caption、takenAt、节点筛选及软删除不能仅凭旧方案宣称已有完整实现。

### 5.3 日历、待办、提醒与看板

日历查询从当前有权访问的餐点/行程/待办及纪念日生成响应，不把陈旧 `CalendarEvent` 投影当授权依据。纪念日 `Anniversary` 支持 ONCE/YEARLY，2 月 29 日可配置 FEB_28/MAR_1/SKIP；农历、单次例外系列表不是当前模型能力。日期按家庭 Asia/Shanghai 解释，时间点接口使用带时区 ISO 字符串；区间查询遵守开始包含、结束不含。

`Task.type` 为 TODO/REQUEST，家庭工单复用请求型待办，并非独立软件缺陷平台。负责人/管理者推进状态，管理者可改派，创建者只可在未开始时按规则修改；重新打开完成/取消事项需原因。`TaskHistory` 保留处理记录。当前客户端补齐了这些后端已有操作入口，未因此声称附件和完整工单增强均已交付。

待办写入同时调用 `NotificationScheduleService.syncTask`：取消旧待发任务及失效 Inbox，写脱敏 OutboxEvent，再建立新 INBOX Job。当前调度事务直接将 Outbox 标记已处理，**不是**另一个通用 outbox 消费队列。

独立 `worker-main.ts` 每轮处理后等待 30 秒；`runDue` 每轮最多领取 20 个任务，条件更新领取状态，恢复超过 5 分钟的 PROCESSING 锁；发送前复核成员、模块、任务版本/负责人、个人开关和安静时段。站内写入与 Job SENT 在事务中完成，失败按 1/5/15 分钟重试，超过重试预算记 FAILED。当前只实现 TASK_REMINDER/INBOX；模型存在 WECHAT 与订阅回执不代表微信正式发送已实现。

看板当前直接查 PostgreSQL，按来源权限隐藏无权指标，并非 Redis 缓存：菜谱为当前发布数，餐次/常选菜按范围内已完成餐单统计，购物为当前未购状态，行程按可访问且与范围相交的行程统计，待办按范围内创建、未取消/归档任务计算完成率；分母零返回 null。不统计金额或家庭成员勤劳排名。

### 5.4 收藏与档案

收藏支持 TEXT/IMAGE/LINK、PRIVATE/HOUSEHOLD，手工录入，不自动抓网页。转换要求确认标题并检查目标模块权限；RECIPE 建缺材料/做法的草稿，TASK 实际建 PENDING 待办（转换响应统一称 DRAFT，不代表 Task 枚举存在 DRAFT）。`FavoriteConversion` 保存幂等记录，保留来源收藏，不自动造菜谱内容。

档案分为定义、加密值和成员授权三层。默认管理者可读写，SELECTED 按字段授权；列表仅返回元数据/hasValue，显式读值才解密并审计。当前对保存值使用 AES-256-GCM，随机 nonce，AAD 绑定家庭/字段/密钥版本；密钥不存数据库或 Git。当前只加载配置指定版本，不等于已有自动多密钥轮换系统。丢失加密密钥后数据库备份不能独立恢复明文。

## 6. 私有媒体处理

链路为：申请 UploadIntent → 同域 PUT 二进制 → 后端净化并存储 → checksum 确认 → 建 MediaAsset/MediaReference 并更新所属资源版本。确认前重新核验资源归属、操作者、版本、期限及存储中的大小/MIME/摘要，不信任客户端给出的任意 objectKey。

- 当前开放 RECIPE、TRIP、FAVORITE；枚举中的 ARCHIVE/TASK 不代表已经开放附件上传。
- 单张输入/净化输出均不超过 8MiB，只接受静态 JPEG/PNG/WebP；sharp 解码后按方向旋转并重编码，移除元数据，不在净化失败时回退原始照片。Nginx 请求体 9m 不是应用图片上限。
- 原始申报大小与净化后字节数可能不同，存储和确认使用后端净化后的大小及 SHA256。
- `MEDIA_DRIVER` 支持 disabled / memory / cos / mounted；memory 仅测试环境。mounted 配置参见[挂载覆盖文件](../infra/docker-compose.mounted-media.yml)。
- 挂载路径 `/mnt/family-life-cos` 必须是真正、可写、唯一的 `fuse.cosfs` 挂载；逐级禁止符号链接，并检查已打开文件描述符的 mount id。丢失挂载时拒绝业务，不回退写普通本地目录。对象名受前缀/扩展名/摘要校验，写后重新读校验；禁止将挂载目录直接暴露为 Nginx 静态目录。
- `cos` 驱动使用运行时凭证和私有 ACL；具体使用哪个驱动以部署配置及运行证据为准，不从代码默认桶名推断当前生产桶。
- 读图先按来源授权，后签发同域 `/media/public` 60 秒能力链接。持有已签发链接者在短窗口内仍可读取；撤权阻止新申请，不承诺旧链接立刻全部失效，也不是 COS 直链/CORS 已验收。

详细实现：[media.service.ts](../apps/api/src/media/media.service.ts)、[image-sanitizer.ts](../apps/api/src/media/image-sanitizer.ts)、[object-storage.service.ts](../apps/api/src/media/object-storage.service.ts)、[mounted-object-store.ts](../apps/api/src/media/mounted-object-store.ts)、[cos-mount-guard.ts](../apps/api/src/media/cos-mount-guard.ts)。

## 7. 数据库模型目录与关系

以下名称逐项来自 [schema.prisma](../apps/api/prisma/schema.prisma)，覆盖全部 50 个 model，按业务组归类而非声称它们都是直接带 householdId 的主表。未使用表名映射的模型由迁移按同名带引号标识建表；真实物理字段、外键及 CHECK 仍以迁移 SQL 和目标库检查为准。

| 数据域 | 实际 model | 主要职责与关系 |
| --- | --- | --- |
| 账号/会话 | `User`、`AuthSession` | 微信身份及刷新会话族，User 一对多 AuthSession |
| 家庭/授权 | `Household`、`Membership`、`Role`、`MemberRole`、`ModulePermission` | User 与 Household 经 Membership 关联；角色多对多；成员模块显式覆盖 |
| 邀请/审计 | `HouseholdInvitation`、`InvitationRedemption`、`AuditLog` | 家庭邀请码、兑换关系及通用操作审计 |
| 日历 | `CalendarEvent`、`Anniversary` | 来源投影/旧纪念日兼容及新纪念日定义；重复日期按查询生成 |
| 行程/分工 | `Trip`、`TripMember`、`TripPreparationGroup`、`TripPreparationGroupMember` | TripMember 连接 Trip 与 Membership；组成员通过复合关系约束为行程成员 |
| 节点/路线/住宿 | `TripStop`、`TripLeg`、`Accommodation` | 行程下有序节点、起止节点关系、可选关联节点的住宿 |
| 行李 | `PackingTemplate`、`PackingTemplateItem`、`TripPackingItem` | 家庭模板及项，独立行程快照，关联来源/准备组/负责人 |
| 菜谱/食材 | `RecipeCategory`、`Ingredient`、`Recipe`、`RecipeIngredient`、`RecipeSeasoning` | 菜谱分类、标准食材/调料、食材关联数量、调料名称与可选标准关联 |
| 库存 | `InventoryItem`、`InventoryTransaction` | 家庭食材库存批次与人工操作流水 |
| 餐点 | `Meal`、`MealDish`、`MealSnapshot`、`MealItem` | 餐点状态、实际菜份数、历史 JSON 快照、成员想吃记录 |
| 购物 | `ShoppingList`、`ShoppingItem` | 家庭清单、状态、缺料来源及复购历史标识 |
| 媒体 | `UploadIntent`、`MediaAsset`、`MediaReference` | 上传过程、READY 资产、资源多态引用；Recipe 封面另有 coverAsset 关系 |
| 待办 | `Task`、`TaskHistory` | TODO/REQUEST，共用负责人、完成者及处理记录 |
| 收藏 | `Favorite`、`FavoriteConversion` | 内容/可见性、幂等转换记录 |
| 档案 | `ArchiveFieldDefinition`、`ArchiveFieldValue`、`ArchiveFieldGrant` | 字段定义、一对一密文值、字段成员授权 |
| 通知 | `NotificationPreference`、`SubscriptionReceipt`、`OutboxEvent`、`NotificationJob`、`InboxItem` | 个人偏好、微信回执预留、脱敏事件、可靠任务及收件箱 |

### 7.1 关键唯一性和幂等约束

| 实体 | 真实约束 | 用途 |
| --- | --- | --- |
| User / AuthSession | `openId` / `refreshHash` 唯一 | 身份及刷新令牌哈希去重 |
| Membership | `(householdId, userId)` 唯一 | 同家庭账号不重复入会 |
| MemberRole / ModulePermission | 复合主键 `(membershipId, roleId)`；唯一 `(membershipId, module)` | 角色关系与模块覆盖去重 |
| InvitationRedemption | 复合主键 `(invitationId, userId)` | 同用户同邀请兑换记录不重复 |
| TripMember / TripPreparationGroupMember | `(tripId, membershipId)` / `(groupId, membershipId)` 复合主键 | 参与与小组成员去重 |
| TripPreparationGroup / PackingTemplate | `(tripId, name)` / `(householdId, name)` 唯一 | 行程内小组、家庭内模板名称唯一 |
| TripPackingItem | `(tripId, sourceTemplateItemId)` 唯一 | 同模板项重复套用去重；手工项来源可空，不按名称合并 |
| Ingredient / RecipeCategory | `(householdId, name, kind)` / `(householdId, name)` 唯一 | 标准名称与类别隔离 |
| RecipeIngredient / RecipeSeasoning | `(recipeId, ingredientId)` 复合主键；`(recipeId, name)` 唯一 | 菜谱材料/调料去重 |
| Meal / MealItem / MealDish | 同餐键 `(householdId, localDate, mealType, slotKey)`；选择键 `(mealId, recipeId, addedById)`；菜键 `(mealId, recipeId)` | 一顿餐、一次成员选择、一道实际菜分别建模 |
| MealSnapshot | `(mealId, version)` 唯一 | 历史快照不可静默覆盖 |
| ShoppingList / ShoppingItem | `(householdId, systemKey)`；`(listId, sourceType, sourceId, sourceVersion, sourceItemKey)` | 系统清单与缺料导入/复购来源幂等 |
| InventoryTransaction | `(inventoryItemId, sourceType, sourceId, sourceVersion)` 唯一 | 带来源的库存操作去重，不表示自动扣增已开启 |
| MediaAsset / MediaReference | `intentId`、`objectKey` 各唯一；`(assetId, ownerType, ownerId)` 唯一 | 一次申请一个资产、归属引用去重 |
| FavoriteConversion | `(actorMembershipId, idempotencyKey)` 唯一 | 转换重试返回既有目标 |
| ArchiveFieldDefinition / Value / Grant | `(householdId, key)` 唯一；`fieldId` 主键；`(fieldId, membershipId)` 复合主键 | 一字段一值及成员授权去重 |
| NotificationPreference | `(membershipId, eventType)` 复合主键 | 个人事件偏好 |
| OutboxEvent / NotificationJob / InboxItem | 事件版本键；Job `dedupeKey` 及收件人/事件/来源/版本/通道键唯一；Inbox `jobId` 唯一 | 同一版本调度与站内记录去重 |

可空来源字段参与的普通唯一约束不能被理解为“任意空值请求都全局幂等”。并非所有创建操作都具备相同幂等协议；不要给网络失败后的创建操作无条件自动重试。

### 7.2 字段、关系与类型注意事项

- 多数实体使用 cuid 字符串主键；若干关联表用复合主键，不能为它们虚构独立 `id` 字段。
- 食材/库存/购物/行李数量主要为 Decimal(12,3)，菜份数 Decimal(8,3)，经纬度 Decimal(9,6)。客户端按字符串传递和展示精度，不混用 JavaScript 浮点累计，不自动换算单位。
- `Recipe.steps`、`MealSnapshot.data`、`TripLeg.geometryJson`、邀请 grants、收藏 assetIds/tags、审计 details 等是 Json 字段。日期型住宿字段为 `@db.Date`，不是入住时刻；`localDate` / `slotKey` 是业务字符串，不用 UTC 日期截取代替上海日期。
- `ownerType + ownerId`、`sourceType + sourceId` 是多态业务归属，不是到所有目标表的数据库外键。`MealDish.recipeId`、`ShoppingItem.previousItemId`、部分 createdById/actorMembershipId 也不能仅因字段名而画成实际 Prisma 外键，必须逐项看 `@relation`。
- 关系外键只能证明引用存在，不自动证明同家庭、同一行程或当前角色有权；这些还需服务层校验。`TripLeg` 两端同一行程、负责人属于准备组等是不能省略的业务不变量。
- `version` 通常是实体编辑乐观锁，`permissionVersion` 是家庭权限变化标记，`snapshotVersion` 是餐单历史内容版本，`scheduleVersion` 是通知绑定任务版本，含义不同，不能互换。
- 归档手段因模块不同有 `archived`、`archivedAt`、`excludedAt`、REVOKED；不得把 schema 的级联删除策略当成允许批量物理删除历史的产品决定。

## 8. 迁移、约束和变更规则

20 个迁移目录从 `202608270001_initial` 到 `202610220001_calendar_event_archive`。第19批新增 `TripMember.photoAdd`并从旧 `canEdit`回填；第20批为旧版无来源纪念日新增 `CalendarEvent.version`（默认1）和可空`archivedAt`，保留原行、来源和创建信息，不影响真实餐点/行程投影。`202609090001_schema_alignment`是追加式外键/默认值对齐，不改历史迁移校验和。R01/R02/P06、待办/看板批次未改schema；本次纪念日删除另增加第20批，部署状态见[用户实测修复记录](bugfix-20261022.md)。

完整字段/关系定义在 [schema.prisma](../apps/api/prisma/schema.prisma)，建表、外键、默认值、索引和补充 CHECK 的权威历史在 [prisma/migrations](../apps/api/prisma/migrations)。Prisma 模型不完整表达所有 SQL CHECK，例如库存数量非负、菜份数正数、上传大小上限、节点坐标/时间、路段起终点不同、住宿退房晚于入住；不能只做模型 diff 就声称这些数据库约束已验证。

新增数据库变更应追加迁移，先在独立 PostgreSQL 执行迁移、结构及业务回归，再安排实际升级。应用程序运行镜像启动命令包含 `prisma migrate deploy`，不代表任何 Git 推送都已触发迁移；不要使用 reset/dev 工作流指向生产，也不要把本地 schema 自动强推到线上。

关键事务见 `serializable.ts` 及各 Service：它对已识别 Prisma 并发冲突最多尝试三次；其它流程也使用普通事务或带版本条件更新，并非全站所有读写都自动 Serializable。版本冲突返回 409，客户端保留有效草稿并要求刷新；本地取消不能撤回已到达服务器的事务。

接手后需要执行的验证流程见[独立数据库验收](../infra/verification/README.md)。测试声明、历史 PASS 数量和本次执行结果分别记录；验收执行时记录源码/镜像/迁移与环境，不用旧测试数补写新通过结论。`.dockerignore` 排除 `.env`、密钥、本地依赖/构建目录及临时文件，但显式保留名称含 private 的业务迁移 `202609010002_private_media/migration.sql`。

## 9. 后续开发不能误读的边界

1. 用户需求、工程方案、当前实现、历史部署与本次实机验收分开；“源码已补齐”不等于生产已修复。
2. 保留单域名 `/api/v1`；当前没有独立 Web 家庭前端交付，App 也未完成平台适配。
3. 不恢复用户暂缓的库存自动扣增、微信订阅发送、账本预算和道路导航。
4. 不以静态示意路线冒充导航，不以订阅回执冒充送达，不以私有桶或短时读地址冒充完全禁止转发。
5. Redis、PostGIS、BullMQ 等旧工程提案需逐项核对实际依赖及调用，不能见模板配置或文档名称就写成正在使用。
6. 生产配置、微信凭据、数据库密码、密钥文件和相册内容不进入交接文档/Git；运维操作重新核对目标及授权，不能根据本文历史描述自动修改服务器。
