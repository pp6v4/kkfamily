# 扣扣的家

私密家庭生活协作平台：微信小程序优先，后续扩展 Web 与 App。

2026-10-26：[统一请求与交互异常审核](docs/request-audit-20261026.md)覆盖118条原生接口及客户端实际请求链，并整理RA01～RA06候选页面修正、回归入口和证据边界；Q01地图阶段线型仍OPEN。接手先核对此记录，再读以下历史交接入口。

## 协作接手入口

交接整理日期：2026-10-23。新开发者或大模型先读 [当前版本与接手状态](docs/project-status-20261023.md)、[需求闭环与未完成清单](docs/requirements-closure-20261023.md)，再读 [文档导航](docs/README.md)、[需求追踪](docs/requirements-traceability.md)、[架构与数据库](docs/architecture-and-data.md) 和 [开发指南](docs/development-guide.md)。协作规则见 [CONTRIBUTING.md](CONTRIBUTING.md)，编码代理入口见 [AGENTS.md](AGENTS.md)；[10月21日交接](docs/handoff-20261021.md)保留历史批次。

原8份需求、选型、总体/详细/数据库设计与部署文档已完整转存为 [历史文档正文归档](docs/archive/20260831/README.md)，保留来源校验值；当前需求以其后的确认记录为准。仓库不包含生产凭证、私钥、本机依赖或数据库备份。

## 技术基线

- Client: uni-app + Vue 3 + TypeScript + Pinia
- API: NestJS + Fastify + TypeScript
- Database: PostgreSQL + Prisma（PostGIS 仅为后续可选方案，当前未启用）
- Jobs: PostgreSQL outbox + 独立通知 worker（Redis保留给后续缓存/队列扩展）
- Media: Tencent COS（私有桶；服务端 COS SDK / 受校验挂载驱动，同域短期读图链接）
- Deployment: Docker Compose + Nginx + Certbot

## 目录

- `apps/client`：微信小程序/H5/App 跨端客户端
- `apps/api`：REST API、微信登录、权限与业务模块
- `packages/contracts`：前后端共享类型与 API 常量
- `infra`：本地及服务器部署文件

## 当前状态

2026-10-23 16:48:51后续：撤回点菜同类空JSON错误已补五条DELETE兼容并部署`00a024d`，API109项回归通过，用户继续用0.1.2复测。[Q02完整回执](docs/hotfix-empty-json-20261023.md)区分首次POST补丁与本次DELETE补齐，未把自动验证当成手机验收。

2026-10-23 16:34:08：用户0.1.2真机反馈的食材比对空JSON错误已由[Q02兼容热修](docs/hotfix-empty-json-20261023.md)修复并部署。生产API为0.1.2基线＋`87bc451`，原空请求与{}经公网只读验证均201；用户继续测试原0.1.2。完整候选客户端/服务端修正在`cd33ed6`，与这次精确后端热修分别追踪。

源码已覆盖微信登录、15分钟JWT访问令牌与30天轮换刷新会话、共享家庭邀请与角色权限、菜谱、多人点餐与确认快照、手工库存辅助比对、购物清单、权限过滤的家庭日历、露营成员/小组/行李/路线/住宿/照片、家庭待办、收藏与灵感、加密家庭档案、非财务生活看板和站内提醒。客户端均通过REST API读写，不再以页面写死数据充当业务结果。

2026-09-01已确认：一期做饭完成不自动减少库存，购物完成不自动增加库存；库存仅供辅助判断并由家人手工维护。

自定义行李模板没有任何系统内置的“烧烤模块”。“烧烤”只可能是用户自己填写的模板名称；模板物品完全自定义，套用到行程后复制为独立快照，不随模板后续修改。

当前用户测试 **0.1.2体验版**：配套后端业务提交`58e2bc7`已有部署回执，数据库源码50个模型、20批迁移；客户端上传成功，体验版状态由用户确认。R01管理员整菜移除、P06只读做法、R02终态减权及此前待办/看板修复已随该版交付，但手机业务验收不能因此标为通过。

**0.1.3仍是未交付候选源码**，业务提交`df776da`及审查补丁`e60a134`在独立分支`fix/closure-0.1.3-20261022`和[PR #1](https://github.com/pp6v4/kkfamily/pull/1)，未合并。主要修复购物/库存未知数量单位、露营小组刷新、待办清日期、收藏转换重试、档案异步明文、行李撤权并发及露营迟到鉴权错误。最新客户端382/382及静态检查通过；API70/70、真实数据库并发2/2及四组HTTP各61/61对应相应源快照，详见[变更说明](docs/release-notes-0.1.3.md)。没有新增迁移，没有部署或上传0.1.3；旧候选构建不含最后的审查补丁，不能复用。

本次需求复核另发现 **Q01：过期路段在旅途中/已完成状态仍画闪烁虚线而非实线箭头**，尚未修复；不能宣称需求已全部闭环。真机、多账号和正式发布门槛也仍未完成。缺口、延期及待范围确认事项统一见[闭环清单](docs/requirements-closure-20261023.md)。按[R09](docs/design/decisions-20261023-review-first.md)继续保留0.1.2，不自动部署、上传、合并、清库或接管开发工具。

自动增减库存、账本预算、微信订阅发送和真实道路导航不纳入当前一期闭环。真实双账号、手机权限/图片/地图及平台备案、审核、正式发布按实际回执分别核实。网站ICP备案号`辽ICP备2026020161号-1`不等于小程序备案完成。当前状态以[10月23日交接](docs/project-status-20261023.md)为准；旧[差异记录](docs/implementation-gap-audit.md)与[设计目录](docs/design/README.md)用于追溯，不以历史日期的“当前”覆盖新结论。

## 当前 API

- `GET /v1/health`
- `POST /v1/auth/wechat/login`
- `POST /v1/auth/refresh`、`POST /v1/auth/logout`
- `GET /v1/auth/me`、`PATCH /v1/auth/me`（本人家庭显示名）
- `POST /v1/households`
- `/v1/recipes/**`：分类、菜谱录入和状态管理
- `/v1/meals/**`：餐点创建、选菜、缺料计算和完成
- `/v1/inventory/**`：库存查询和数量调整
- `/v1/shopping-lists/**`：购物项、缺料导入和状态管理
- `/v1/calendar/**`：家庭日历事件
- `/v1/trips/**`：行程基础与成员可见性
- `/v1/packing-templates/**`：自定义行李模板
- `/v1/trips/:tripId/packing-items/**`：行程行李快照、负责人和准备状态
- `/v1/tasks/**`：家庭待办、请求、处理记录和提醒计划
- `/v1/favorites/**`：收藏、私有图片和草稿转换
- `/v1/archive/**`：逐字段授权的加密家庭档案
- `/v1/dashboard/**`：按来源权限聚合的生活看板
- `/v1/inbox`、`/v1/notification-preferences`：站内提醒与个人设置

除登录和健康检查外，接口均使用 Bearer Token；家庭业务接口另需要 `X-Household-Id`。生产入口为 `https://pp6v4.com/api/v1`，Nginx 将 `/api/` 转发到后端 `/v1`。
