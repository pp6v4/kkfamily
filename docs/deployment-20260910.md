# 2026-09-10 部署与交付记录

## 北京时间17:19复查

实现版本`ad83430`已部署，API与提醒worker均运行`kkfamily-api:ad83430`，镜像摘要`sha256:37955311d68793e70de5b6a3cfbdc4f284fed4a9ace33ff724c822cfb6815d33`；两者运行中、重启0次，API healthy。仍只由Nginx发布80/443，API、PostgreSQL和Redis未发布宿主机端口。

客户端248/248、lint零诊断、完整vue-tsc通过，微信生产构建成功。17:19:35将78个文件同步到`C:\Users\10353\Documents\Codex\2026-08-26\new-chat\outputs\mp-weixin`，逐文件SHA256差异0，私有项目配置保留。编译产物已确认包含POST兼容路径、HTTPS API基地址和异常响应检查。未操作微信平台上传或发布。

## 隔离验证

- 源码快照`20260910T090804Z-6ed087e1`，manifest记录完整提交`ad83430f39d9fcd69b18c2e06783c8c89f429502`和248个文件的SHA256；排除.env、私钥及用户NUL文件。测试容器无.git，所以result.json中的sourceRevision为null，源码归属由source-manifest.json证明，不以null伪称有Git运行环境。
- PostgreSQL17隔离环境：18批迁移、结构差异0；旧数据6/6、通知6/6、住宿5/5、全部Controller兼容2/2。
- HTTP完整业务回归分别执行原生PATCH 51/51及POST兼容入口51/51。使用隔离数据库与虚构身份，覆盖现有权限、版本及业务流程，不代表真实微信双账号验收。
- 本次Linux构建使用pnpm10.12.1，Dockerfile仍为`--no-frozen-lockfile`，因此不能视作锁文件完全可复现或客户端依赖兼容门槛关闭。
- runtime冒烟`runtime-smoke-557a1f645947cafd.json`通过：实际默认CMD应用18批迁移、health200、未登录recipes/members/inbox401、worker生产模式启动。额外在正式镜像无网络容器执行兼容测试2/2通过。

本地隔离证据：`.codex-tmp/remote-db-verification/20260910T090804Z-6ed087e1/`；服务器对应`/home/ubuntu/kkfamily-db-verification-20260910T090804Z-6ed087e1/`。测试进程均已结束；未删除留存的验证资源。

## 上线保护与检查

部署前确认旧镜像摘要为`sha256:f33e2e8073818fb4ddbb8b512264a9faf285d791a25ac01df70fc83c3e43e15a`；线上Compose、Nginx和续期脚本与本地规范化文本哈希相同。18批已应用迁移校验和一致，无失败迁移。无本次新增数据库结构变更。

新备份目录`/home/ubuntu/kkfamily-release-20260910T091717Z-cd9bc6c9`，目录700、敏感备份600；数据库备份SHA256为`a9c8b5406bc75fbe4892b4cf4e25cc340044e2683d3aed0b668eb0a98118714a`。数据库与含配置源码备份仅留在服务器，不提交仓库。回退镜像保留为`kkfamily-api:rollback-20260910T091717Z-cd9bc6c9`，不自动恢复旧数据库备份。

阶段记录：17:17:48完成备份；17:18:06旧API停止；17:18:10迁移与结构复查通过；17:18:24新API/worker及HTTPS检查通过。这是操作阶段时间，不是监控精确测量的停机时长。部署证据`.codex-tmp/production-release/20260910T091717Z-cd9bc6c9/release.json`。

上线后通过公开域名Nginx，逐一POST实际Controller派生的24个`/_patch`入口：全部返回401且JSON错误状态401，无业务数据写入。HTTPS证书链/主机名有效、TLS1.3；首页200、health200/status=ok、未登录菜谱401。微信出口404和COS403仅证明连通，不作为登录或图片权限验证。

## 未关闭的发布门槛

修复的更新传输问题现已完成本地、隔离数据库、运行镜像、生产代理与构建交付验证；本次没有实际微信平台上传/发布。真实微信登录/双账号/真机、COS照片、地图、订阅发送、依赖兼容与完整发布验收仍未完成。库存仍为手动维护和缺料辅助判断，不自动增减。
