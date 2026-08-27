# 扣扣的家

私密家庭生活协作平台：微信小程序优先，后续扩展 Web 与 App。

## 技术基线

- Client: uni-app + Vue 3 + TypeScript + Pinia
- API: NestJS + Fastify + TypeScript
- Database: PostgreSQL + Prisma（后续启用 PostGIS）
- Jobs: Redis + BullMQ
- Media: Tencent COS（私有桶 + 临时签名 URL）
- Deployment: Docker Compose + Caddy

## 目录

- `apps/client`：微信小程序/H5/App 跨端客户端
- `apps/api`：REST API、微信登录、权限与业务模块
- `packages/contracts`：前后端共享类型与 API 常量
- `infra`：本地及服务器部署文件

## 当前状态

已完成单仓库骨架、API 健康检查、微信登录/JWT 会话、家庭创建及管理员初始授权、菜谱分类和厨师录菜接口，以及客户端首页骨架。餐点、库存和购物清单为下一开发阶段。域名备案完成后再配置生产 DNS、HTTPS 和微信合法域名。

## 当前 API

- `GET /v1/health`
- `POST /v1/auth/wechat/login`
- `GET /v1/auth/me`
- `POST /v1/households`
- `GET /v1/recipes/categories`
- `POST /v1/recipes/categories`
- `POST /v1/recipes`

除登录和健康检查外，接口均使用 Bearer Token；餐饮接口另需要 `X-Household-Id`。
