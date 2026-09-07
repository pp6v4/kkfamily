# 隔离数据库验收

在已授权的 Docker 主机上，从仓库根目录执行：

```sh
node scripts/verify-database.cjs
```

也可执行 `pnpm verify:database`。主机仅需 Node.js、Docker Engine 和 Compose plugin；API 编译、Prisma 迁移和 HTTP 测试均在容器中运行。

运行器生成随机项目 `kk-verify-<16位十六进制>` 和一次性测试库密码，不读取生产 `.env`。PostgreSQL 17 的数据位于测试容器 tmpfs，停止后消失，不绑定生产卷、宿主目录或公网端口。API 测试与数据库只加入该项目的内部网络，媒体使用内存驱动，不访问微信/COS。

执行顺序：Docker/Compose 可用性 → Compose 配置校验 → API build阶段镜像 → 全部迁移deploy → 迁移status → HTTP集成测试。启动迁移前核对数据库用户名、地址、端口、库名和schema，任何一项不符即退出。构建失败不会启动测试容器；测试失败会通过退出码返回。

每轮证据保存在 `.codex-tmp/db-verification/<运行ID>/`：

- `result.json`：开始/结束时间、各阶段退出码和整体状态。
- `build.log`：容器构建日志。
- `database-and-tests.log`：迁移名称与数量、迁移状态、逐条HTTP测试TAP输出。
- 其他阶段日志：Docker、Compose和配置检查结果。

测试结束时 Compose 停止同一测试项目的容器，保留停止的容器及日志供排查。本命令不执行容器/网络批量删除；如需清理，先列出该项目资源并确认后再操作。若人工中断，检查日志中的精确项目名及 `docker compose ls`，确认该项目是否仍运行。

`result.json` 的passed只表示这套隔离数据库测试执行成功，不代表真实微信登录、COS、地图、订阅消息或生产部署验收完成。记录Git提交、Docker镜像及TAP结果后，才能将对应业务用例标为数据库测试通过。
