# 扣扣的家

私密家庭生活协作平台：微信小程序优先，后续扩展 Web 与 App。

## 技术基线

- Client: uni-app + Vue 3 + TypeScript + Pinia
- API: NestJS + Fastify + TypeScript
- Database: PostgreSQL + Prisma（后续启用 PostGIS）
- Jobs: Redis + BullMQ
- Media: Tencent COS（私有桶 + 临时签名 URL）
- Deployment: Docker Compose + Nginx + Certbot

## 目录

- `apps/client`：微信小程序/H5/App 跨端客户端
- `apps/api`：REST API、微信登录、权限与业务模块
- `packages/contracts`：前后端共享类型与 API 常量
- `infra`：本地及服务器部署文件

## 当前状态

已完成单仓库骨架、API 健康检查、微信登录/JWT 会话、家庭创建及管理员初始授权、菜谱、餐点、库存、购物清单、家庭日历、露营行程基础、自定义行李模板及行程行李协作。客户端已接入对应数据库 API，Docker Compose 中间件和 Nginx `/api/` 反向代理已部署。

自定义行李模板没有任何系统内置的“烧烤模块”。“烧烤”只可能是用户自己填写的模板名称；模板物品完全自定义，套用到行程后复制为独立快照，不随模板后续修改。

下一阶段重点是成员邀请与权限管理、露营地图/路线/住宿/交通/照片、家庭待办、收藏、家庭档案、非财务数据看板和订阅消息。完整设计状态见 [`docs/design-baseline.md`](docs/design-baseline.md)。

## 当前 API

- `GET /v1/health`
- `POST /v1/auth/wechat/login`
- `GET /v1/auth/me`
- `POST /v1/households`
- `/v1/recipes/**`：分类、菜谱录入和状态管理
- `/v1/meals/**`：餐点创建、选菜、缺料计算和完成
- `/v1/inventory/**`：库存查询和数量调整
- `/v1/shopping/**`：购物项、缺料导入和状态管理
- `/v1/calendar/**`：家庭日历事件
- `/v1/trips/**`：行程基础与成员可见性
- `/v1/packing-templates/**`：自定义行李模板
- `/v1/trips/:tripId/packing-items/**`：行程行李快照、负责人和准备状态

除登录和健康检查外，接口均使用 Bearer Token；家庭业务接口另需要 `X-Household-Id`。生产入口为 `https://pp6v4.com/api/v1`，Nginx 将 `/api/` 转发到后端 `/v1`。
