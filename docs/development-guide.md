# 开发与检查指南

更新日期：2026-10-21。本文面向接手开发者和 LLM，命令以仓库根目录或明确注明的工作目录为准。业务规则先读 [设计契约](design/contract-details.md) 和 [后续决定索引](design/README.md)；平台联调状态以交接进度记录为准，不用旧文档中的测试数量推断当前状态。

2026-10-22补充：最新修复/发布边界见[本轮用户问题记录](bugfix-20261022.md)。当前源码版本0.1.2，客户端336/336、API非数据库61/61及构建/lint/类型检查通过；独立outDir编译成功。源码迁移现为20，生成Prisma Client不等于已经向生产执行迁移。本文下方310/47和0.1.1的描述保留原批次时点；当前已上传包仍是0.1.1，0.1.2未上传，新业务未部署，隔离库最终结果待补。

## 1. 技术组件与边界

| 位置 | 当前组件 | 说明 |
| --- | --- | --- |
| `apps/client` | uni-app、Vue 3、TypeScript、Pinia | 一期以微信小程序为目标；存在 H5 开发/构建脚本，不代表 H5 或原生 App 已完成交付验收 |
| `apps/api` | NestJS 11、Fastify 5、TypeScript | REST API，内部前缀 `/v1`；微信登录、权限、业务和图片代理 |
| `apps/api/prisma` | Prisma 6、PostgreSQL | 模型与增量迁移；PostGIS 不是当前已启用能力 |
| `apps/api/src/notifications` | PostgreSQL outbox、独立 worker | 站内提醒；worker 每轮处理后等待 30 秒；微信订阅发送已延期 |
| `apps/api/src/media` | COS / 挂载驱动、sharp | 私有图片、真实格式检查、隐私元数据处理；驱动取决于配置 |
| `packages/contracts` | 共享 TypeScript 类型和常量 | 与实际 DTO、服务授权规则一起核对，不能单靠类型认为接口已验收 |
| `infra` | Docker Compose、Nginx、Certbot | PostgreSQL 17、Redis 7；Redis 当前保留作后续扩展，通知不是 Redis 队列 |

API Dockerfile 的构建和运行基础镜像均为 `node:22-bookworm-slim`。这是仓库当前容器基线，不是经过验证的最低 Node 版本声明；`package.json` 未设置 Node `engines`。先记录本机 `node --version`、`pnpm --version`，包管理器版本以根目录 `packageManager` 的 `pnpm@10.12.1` 为准。

Nginx 的外部业务前缀为 `/api/v1`，转发到 API 的 `/v1`。家庭业务使用 Bearer Token 和 `X-Household-Id`，资源还要核对所属家庭、模块权限及行程成员等来源条件。客户端隐藏按钮不能替代服务端鉴权。

## 2. 首次安装与配置

### 新克隆

需要 Git、Node.js 和上述版本的 pnpm。运行隔离数据库验收还需要已启动的 Docker Engine 与 Compose plugin；真机联调另需微信开发者工具和获授权的开发账号。

在仓库根目录安装锁定依赖：

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
```

使用 Corepack 管理 pnpm 的机器，可先执行 `corepack enable`；不要同时更换锁文件或把别处的 `node_modules` 复制过来。Prisma 生成器和 sharp 等包含生成或原生依赖，安装提示不能一概忽略；依照本机安装结果处理依赖构建，再执行 Prisma 生成和对应测试。

### 配置入口

只从模板准备自己获授权的开发配置，不复制生产配置到开发目录。变量说明如下，本文不提供任何实际值：

| 模板 / 入口 | 变量名 | 用途 |
| --- | --- | --- |
| `apps/api/.env.example` → 开发机的 `apps/api/.env` | `NODE_ENV`、`PORT`、`DATABASE_URL`、`JWT_ACCESS_SECRET` | API 基础配置；开发库必须由接手者明确指定 |
| 同上 | `WECHAT_APP_ID`、`WECHAT_APP_SECRET` | 真实微信登录；留空不等于存在本地模拟登录接口 |
| 同上 | `MEDIA_DRIVER`、`MEDIA_MOUNT_ROOT`、`COS_BUCKET`、`COS_REGION`、`COS_SECRET_ID`、`COS_SECRET_KEY` | 图片驱动和私有存储；`memory` 只允许测试环境 |
| 同上 | `ARCHIVE_ENCRYPTION_KEY`、`ARCHIVE_ENCRYPTION_KEY_VERSION` | 档案加密；密钥必须在数据库、镜像和 Git 之外备份 |
| 同上 | `WECHAT_TASK_REMINDER_TEMPLATE_ID` | 延期的微信订阅通道配置，不是当前一期开发前置 |
| 同上 | `REDIS_URL` | 模板保留的 Redis 连接配置，当前通知仍由 PostgreSQL 驱动 |
| `infra/.env.example` → 获授权部署环境的 `infra/.env` | `POSTGRES_PASSWORD`、`REDIS_PASSWORD` | 部署 Compose 插值；不是默认本地联调方案 |
| `scripts/verify-database.cjs` 自动生成 | `VERIFY_RUN_ID`、`VERIFY_DB_PASSWORD` | 一次性隔离测试项目和数据库，不手工替换为生产连接 |

模板还保留 `JWT_ACCESS_TTL`、`JWT_REFRESH_TTL`，当前代码未用它们控制有效期：访问令牌在 `auth.module.ts` 固定为 15 分钟，刷新会话在 `auth.service.ts` 固定为 30 天。修改模板值不会自动改变行为。

客户端业务地址目前写在 `apps/client/src/services/config.ts`，不是 `VITE_API_BASE_URL` 等环境变量。开始联调前必须检查该文件，因为仓库默认指向生产业务入口；要连本地或隔离 API，显式配置对应开发地址。微信应用配置入口是 `apps/client/src/manifest.json`；10月21日版本标记为 `0.1.1`，10月22日候选源码已更新为 `0.1.2`（versionCode 102），上传状态另看本轮记录。不要把账号配置、令牌、签名 URL 或生产数据写进测试夹具与文档。

## 3. 已有依赖的工作区：直接运行本地工具

本工作区曾出现：`pnpm exec` 在执行检查前触发依赖状态检查和自动 `install`，随后因无 TTY 中止准备移除 `node_modules` 的操作。遇到 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`，不要为继续 lint 而开启自动清空或重装；先使用下列直接调用已安装工具的命令。依赖确需重建时单独处理，不能与本轮功能检查混在一起。

以下命令使用包内实际 JS 入口，不触发 pnpm 的依赖安装流程。Windows、Linux 均可使用；所有依赖仍须先通过锁文件安装。

### 客户端：工作目录 `apps/client`

```powershell
node node_modules/eslint/bin/eslint.js "src/**/*.{ts,vue}" --max-warnings=0
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit --pretty false -p tsconfig.json
node --test --test-reporter=spec test/*.test.cjs
```

各条命令都要检查退出码，前一条失败时先修复再继续。正常包管理器环境中，根目录 `pnpm check:client` 等价于依次执行客户端 lint、类型检查和测试；它不构建、不上传、不部署。

### API：工作目录 `apps/api`

新安装依赖后，先生成 Prisma Client；生成不等于迁移数据库：

```powershell
node node_modules/prisma/build/index.js generate
```

随后执行：

```powershell
node node_modules/@nestjs/cli/bin/nest.js build
node node_modules/eslint/bin/eslint.js "src/**/*.ts" --max-warnings=0
node --test --test-reporter=spec test/*.unit.test.cjs test/patch-compatibility.test.cjs
```

API 构建写入 `apps/api/dist`。不少既有单元测试加载 `dist`，必须先构建本次源码，不能拿旧编译产物验证新实现；新增的 `meal-menu`、`tasks.update`、`trip-history-access` 等测试也有直接加载 TypeScript 服务源码的用例。上述测试集合不运行数据库集成，也不需要生产配置。

10月22日新增`calendar-archive.unit.test.cjs`和`object-storage-errors.unit.test.cjs`等专项；日历schema改变后先重新生成Prisma Client，再构建与测试。第20迁移及旧库升级另在隔离PostgreSQL执行；不要因本地61项非数据库测试通过就跳过真实迁移/HTTP检查。日历归档保持共享calendar:EDIT及家庭/版本校验，新增旧版接口不允许删除关联餐点/行程投影。

根目录 `pnpm test` 会调用各包的 `test` 脚本，而 API 当前 `test` 脚本是 `jest`。它不能替代这里的 Node CJS 测试集合；根目录 `pnpm build` 也不能代替带明确平台和新输出目录的小程序构建。请按目标执行具体命令。

## 4. 开发启动与数据库边界

只启动 API 时，在 `apps/api` 工作目录准备开发配置和自己的开发库，然后运行：

```powershell
node node_modules/@nestjs/cli/bin/nest.js start --watch
```

根目录的 `pnpm dev:api` 是同一开发入口。API 配置由工作目录中的 `.env` 加载；启动之前先确认 `DATABASE_URL` 对应开发库。API 的普通开发启动命令不会自动为你创建数据库或执行迁移。

需要长期本地数据库时，由接手者单独建立开发 PostgreSQL，并在确认连接目标后制定迁移步骤。`prisma migrate dev` 会修改开发库并可能提示重置，只用于明确可变更的个人开发数据库；不要对生产库运行，也不要通过修改旧迁移来消除差异。生产镜像启动命令含 `prisma migrate deploy`，因此启动生产 Compose 本身就会有数据库变更，不能当普通本地预览命令使用。

当前 `infra/docker-compose.yml` 是部署编排，不是安全的“一键本地试玩”：它读取私有配置，发布 80/443，并创建持久数据卷。部署与升级按 [部署说明](../infra/deploy/README.md) 单独执行；已有数据的升级还要核对迁移账本、备份及回滚镜像。

客户端的标准开发脚本为 `dev:mp-weixin`，H5 为 `dev:h5`。只有在确认 API 地址和微信开发账号后才开启客户端联调；离线源码检查不需要执行微信登录或创建真实家庭。

通知 worker 的编译后入口为 `apps/api/dist/notifications/worker-main.js`；运行它会处理所连接数据库的到期任务，必须与 API 使用同一套明确的开发配置，不能随意对未知连接启动。

## 5. 测试分类与隔离库

| 层级 | 入口 | 能证明什么 / 限制 |
| --- | --- | --- |
| 客户端源码行为测试 | `apps/client/test/*.test.cjs` | 加载真实 TS / Vue 页面逻辑，模拟平台回调和接口；检查载荷、版本、权限、页面时序等，不等于真机渲染或触摸事件验收 |
| API 非数据库测试 | 上述 `*.unit.test.cjs` 与 `patch-compatibility.test.cjs` | 图片、权限分支、服务行为、内存事务夹具、控制器兼容路由等；不证明真实 PostgreSQL 并发与迁移执行 |
| 小程序编译产物探针 | `scripts/verify-compiled-client.cjs --dir ... --api-contracts` | 读取实际 JS/WXML，使用真实 DTO 和 ValidationPipe 检查探针载荷；平台、后端持久化和授权仍被模拟 |
| 隔离数据库与 HTTP | `node scripts/verify-database.cjs` | 真实 PostgreSQL 迁移、模型差异、旧数据升级、HTTP 行为及两种 PATCH 传输路径 |
| 验证运行器自身测试 | `node --test scripts/verify-database.test.cjs` | 隔离地址保护、失败退出与证据保存；模拟 Docker 执行，不等于数据库验收通过 |
| 微信 / 存储 / 地图平台联调 | 单独授权的开发者工具、双账号和真机流程 | 验证平台限制、原生事件、实际登录、真实图片读写与视觉效果；不能由上述自动测试代替 |

在获授权的 Docker 主机上，从仓库根目录运行：

```powershell
node scripts/verify-database.cjs
```

先读 [隔离数据库验收](../infra/verification/README.md)。运行器使用随机 `kk-verify-...` 项目、一次性密码、PostgreSQL tmpfs、独立内部网络和 `infra/verification/empty.env`；不读取生产 `.env`，不发布数据库端口。容器内 `test/run-isolated.cjs` 会校验数据库身份，依次执行迁移、结构差异、独立旧数据升级库和 HTTP 测试。不要绕过保护，把 `access.integration.test.cjs` 或 `legacy-upgrade.test.cjs` 指向随手找到的连接。

当前隔离脚本列出的测试阶段不是 API 全部非数据库测试文件的自动发现器。因此完整回归应同时执行第 3 节的本地集合和这里的隔离流程；新增测试文件后，要分别确认两个入口实际覆盖的内容。

每轮记录写入 `.codex-tmp/db-verification/<运行ID>/`，包括 `result.json`、`build.log`、`database-and-tests.log`、Git revision、工作区状态和阶段退出码。HTTP 原生 PATCH 与兼容 POST 别名是分开的阶段，不能把同一组重复运行数量当作新增用例数。通过必须检查最终状态和每个阶段结果，不能只看镜像构建成功。

默认媒体使用内存驱动，不访问微信/COS。`VERIFY_MOUNTED_MEDIA` 及 `infra/verification/compose.mounted-media.yml` 是显式启用的真实挂载测试，会触及实际对象存储，只在另行明确授权后使用。

Compose 验证会在测试进程结束后停止同一项目容器，并保留停止容器和日志；运行器不自动批量删除资源。人工中断后按日志中的精确项目名检查。清理前先列出实际容器、网络、目录清单并确认，不执行宽范围 prune、重置库或批量删除。

## 6. 小程序构建：每次使用新 outDir

现有已上传版本为 `0.1.1`，当前源码包含随后完成的收束修复。源码测试、隔离编译成功不代表这些变更已经重新上传或部署。不要覆盖 `apps/client/dist/build/mp-weixin`、仓库外的 `outputs/mp-weixin` 或已上传的 0.1.1 产物。

CLI 支持 `--outDir`，且可清空目标目录。每次用仓库 `.codex-tmp` 下不存在的新目录，明确检查目标后才运行。以下 PowerShell 示例从仓库根目录开始：

```powershell
$developmentRepo = (Get-Location).Path
$developmentBuild = Join-Path $developmentRepo ('.codex-tmp/handoff-build-' + [Guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $developmentBuild) { throw '构建目标已经存在，请换新目录' }
Push-Location apps/client
try {
  node node_modules/@dcloudio/vite-plugin-uni/bin/uni.js build -p mp-weixin --outDir $developmentBuild
  if ($LASTEXITCODE -ne 0) { throw '小程序构建失败' }
} finally {
  Pop-Location
}
node scripts/verify-compiled-client.cjs --dir $developmentBuild --api-contracts
if ($LASTEXITCODE -ne 0) { throw '编译产物探针失败' }
```

此脚本只构建并检查新目录，不复制到旧导入目录、不上传微信、不部署服务。编译产物探针当前覆盖菜谱录入、模板创建/返回/显式套用、目的地回调/行程保存等 3 个场景，不是全部业务的真机验收。

本次交接已成功编译的新目录为 `.codex-tmp/closure-build-20261021-0f924c8b`；不要复用它做下一轮构建。`.codex-tmp` 被 Git 忽略，新克隆没有这些本地证据与产物，应按上述命令重新生成。

10月22日0.1.2的隔离编译目录为`.codex-tmp/bugfix-0.1.2-20261022-d6ab937c`，同样不要复用；编译成功不包含微信上传。存储运行参数修复和业务镜像升级也分开，详见本轮记录中的COS诊断证据及待部署状态。

## 7. 本次检查基线与接手顺序

主线程在 2026-10-21 对当前收束源码完成：客户端行为测试 **310/310**、API 非数据库测试 **47/47**、API build / lint、客户端 lint / vue-tsc，以及上述独立 outDir 小程序编译。数量是本次快照，不应写入未来测试的固定预期；本轮没有重新执行真实数据库集成、微信双账号或真机验收，没有覆盖旧产物。

接手时先执行 `git status --short` 和 `git rev-parse HEAD`，确认自己的源码及未提交改动，再阅读业务决定、交接进度和相关测试。修复具体功能后先执行对应行为测试，再执行必要的全量检查；需要数据库不变量证据时使用隔离流程。提交代码、构建小程序、复制导入目录、微信上传、数据库迁移、生产部署是独立动作，不能因为前一步完成就自动执行后一步。

协作时为各开发者/LLM 列出文件 allowlist，公用测试文件由一人整合，避免覆盖彼此追加内容。保留输入、实际输出、执行日期、源码版本和测试环境；模拟测试、数据库验证、平台联调、用户验收分别记录。失败或延期如实留在交接记录，不用源码存在或测试名称替代完成证据。

历史 Word 的正文及表格已完整转存到 `docs/archive/20260831/`，附原文件与Markdown的SHA256；原DOCX未重复提交，也未重新排版。当前规则仍以 `docs/design/` 的后续决定及最新交接记录为准。旧 `.codex-tmp`、ZIP、全部 outputs 和私有配置不属于新克隆默认依赖，也不应为方便交接整体提交。
