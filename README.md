# 扣扣的家

私密家庭生活协作平台：微信小程序优先，后续扩展 Web 与 App。

## 协作接手入口

交接整理日期：2026-10-22。新开发者或大模型先读 [协作交接与待办](docs/handoff-20261021.md)，再读 [文档导航](docs/README.md)、[需求追踪](docs/requirements-traceability.md)、[架构与数据库](docs/architecture-and-data.md) 和 [开发指南](docs/development-guide.md)。协作规则见 [CONTRIBUTING.md](CONTRIBUTING.md)，编码代理入口见 [AGENTS.md](AGENTS.md)。

原8份需求、选型、总体/详细/数据库设计与部署文档已完整转存为 [历史文档正文归档](docs/archive/20260831/README.md)，保留来源校验值；当前需求以其后的确认记录为准。仓库不包含生产凭证、私钥、本机依赖或数据库备份。

## 技术基线

- Client: uni-app + Vue 3 + TypeScript + Pinia
- API: NestJS + Fastify + TypeScript
- Database: PostgreSQL + Prisma（后续启用 PostGIS）
- Jobs: PostgreSQL outbox + 独立通知 worker（Redis保留给后续缓存/队列扩展）
- Media: Tencent COS（私有桶 + 临时签名 URL）
- Deployment: Docker Compose + Nginx + Certbot

## 目录

- `apps/client`：微信小程序/H5/App 跨端客户端
- `apps/api`：REST API、微信登录、权限与业务模块
- `packages/contracts`：前后端共享类型与 API 常量
- `infra`：本地及服务器部署文件

## 当前状态

源码已覆盖微信登录、15分钟JWT访问令牌与30天轮换刷新会话、共享家庭邀请与角色权限、菜谱、多人点餐与确认快照、手工库存辅助比对、购物清单、权限过滤的家庭日历、露营成员/小组/行李/路线/住宿/照片、家庭待办、收藏与灵感、加密家庭档案、非财务生活看板和站内提醒。客户端均通过REST API读写，不再以页面写死数据充当业务结果。

2026-09-01已确认：一期做饭完成不自动减少库存，购物完成不自动增加库存；库存仅供辅助判断并由家人手工维护。

自定义行李模板没有任何系统内置的“烧烤模块”。“烧烤”只可能是用户自己填写的模板名称；模板物品完全自定义，套用到行程后复制为独立快照，不随模板后续修改。

微信开发版本 `0.1.1` 已于2026-10-21上传，用户正在进行实机测试；没有本轮正式发布回执。后续源码已补管理员移除本餐整菜、只读菜谱做法、终态行程主动撤权、待办保存和看板上海日期口径，尚未部署或覆盖该测试包。客户端310/310、API单元47/47、lint/类型检查/API构建及独立目录小程序编译通过；本轮新增数据库HTTP用例仍待隔离PostgreSQL执行。当前模型50个、迁移19批；过去的数据库及生产部署结果仅证明各自记录时点，不代表本轮新代码已上线。

自动增减库存、账本预算、微信订阅发送和真实道路导航不纳入当前一期闭环。真实双账号、手机权限/图片/地图及平台备案、审核、正式发布按实际回执分别核实。网站ICP备案号`辽ICP备2026020161号-1`不等于小程序备案完成。完整差异、验证与接续顺序以[交接记录](docs/handoff-20261021.md)为准；旧[差异记录](docs/implementation-gap-audit.md)与[设计目录](docs/design/README.md)用于追溯。

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
