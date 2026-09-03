# 扣扣的家

私密家庭生活协作平台：微信小程序优先，后续扩展 Web 与 App。

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

当前不是正式发布版。下一阶段重点是在隔离PostgreSQL执行16批迁移及49条HTTP集成用例，并完成真实COS、微信双账号、订阅消息、地图供应商、HTTPS、小程序平台备案、公安备案和生产部署验收。网站ICP服务备案号`辽ICP备2026020161号-1`已经写入小程序设置页和域名首页源码。最新差异见[`docs/implementation-gap-audit.md`](docs/implementation-gap-audit.md)，详细字段、接口和45条验收设计见[`docs/design/`](docs/design/README.md)。

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
