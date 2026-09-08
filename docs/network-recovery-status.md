# 网络恢复检查记录（2026-09-09）

状态：2026-09-09 已恢复并验证网络基础设施；不作为业务功能验收或正式版本证明。

## 最终恢复结果

- SSH：使用既有 Ed25519 部署密钥多次通过 Paramiko 登录 `ubuntu@49.233.18.181`。
- 客户端公钥指纹：`SHA256:IVczPq0DAYh7P+H4k4MMQBgv+RBGBFzbkn+6qReA0W0`，与用户提供的 family-life 指纹一致。
- 服务器 ED25519 主机指纹：`SHA256:J5EG9eKcq0dd/DswDro8v/4v0ee2XvxCHb40CweMhk8`；本次首次连接观察后，又从已登录服务器的主机公钥文件核对一致。此为连接内核对，不是独立云控制台核验。新的管理脚本固定该指纹并拒绝变化。
- 真正根因：线上使用 HTTP bootstrap、没有证书；不是 UFW 阻止 HTTPS。已签发 Let's Encrypt 证书并启用 TLS，证书到期时间 `2026-12-07 15:37:07 UTC`。
- 从本机 Python 标准 TLS 校验访问：TLSv1.3，主机名正确，首页 200，`/api/v1/health` 返回 200 且 JSON status=ok，未登录 `/api/v1/recipes` 返回 401；两轮均通过。HTTP 原路径返回 301 到 HTTPS。
- 首页展示 `辽ICP备2026020161号-1` 并链接工信部。公安备案尚未提供，不显示虚构号码。
- API 容器原来只有 internal 网络，已增加 edge 出口并修改线上 Compose 持久化；微信域名返回404、COS私有桶未授权请求返回403，证明DNS/TLS/网络可达，不等于微信登录或COS真实上传已验收。
- PostgreSQL `SELECT 1` 返回1；Redis healthy；数据库/Redis/API均未发布宿主机端口。保留原有独立测试数据库容器，未删除任何生产数据卷。
- GitHub：既有验证主机密钥下SSH认证成功；通过 Paramiko Git transport 执行 `git ls-remote origin refs/heads/main` 成功，返回 `42ca7ae7dc825b1ed7d85b20b255fe0f803ed8b4`（仅当时快照，不代表最新源码已推送）。
- 自动续期：`family-life-cert-renew.timer` enabled/active，每天两次带随机延迟；service实际运行 Result=success、ExecMainStatus=0。Certbot模拟续期返回 `all simulated renewals succeeded`、退出码0。演练自身随机等待423秒，首次本地观察超时后重新跟随同一容器完成，没有重复发起续期。
- Nginx生产配置和线上读取结果按LF标准化SHA256一致：`3b790da356a04636eb46b2b62aa9344868c7b3a929d057f16cd36572be458c99`；语法检查通过并reload。
- 线上原Compose和Nginx配置分别备份为原路径追加 `.pre-https-20260908T163735Z`；只重建Nginx，没有重启或更新业务API镜像，也没有执行生产数据库迁移。

## 后续连接入口（不含秘密）

- Python：`C:\Users\10353\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`。
- 项目根上级 `work/family_server_admin.py`：使用Paramiko、既有部署密钥和固定主机指纹。用 `--command 'id -un'` 做只读检查。
- 部署密钥路径：项目根上级 `work/family-life-deploy-ed25519-unlocked`。不要输出内容，不要提交Git，不使用 `.codex-tmp/kkfamily_verify_rsa` 替代。
- 连通性回归：项目根上级 `work/verify_family_network.py`。
- Git transport：项目根上级 `work/git_ssh_paramiko.py`，设置GIT_SSH_COMMAND为Python加该脚本，并设置GIT_SSH_VARIANT=ssh。
- 普通Windows curl在此沙箱出现 `SEC_E_NO_CREDENTIALS`；改用Python标准SSL校验成功，不要用 `-k` 关闭证书校验来掩盖本机Schannel问题。
- 本轮开始普通沙箱已恢复读取部署密钥和依赖。不要把某次普通账号的ACL读取失败误判为服务器认证失败，更不要放宽整个用户目录权限。
- 用户随后完成目录写入授权；2026-09-09已新增记忆记录 `C:\Users\10353\.codex\memories\extensions\ad_hoc\notes\20260909T005100-family-life-network-recovery.md`，并核实文件存在。不包含密码、私钥或令牌。

## 修复前实测（历史证据，已由上述结果更新）

- `Resolve-DnsName pp6v4.com -Type A` 返回 `49.233.18.181`。
- 本机 `curl.exe -I --connect-timeout 10 --max-time 15 https://pp6v4.com` 返回连接 443 失败。尚不能区分服务器监听、云防火墙与本机出口问题。
- 仓库 `infra/nginx/nginx.conf` 是 HTTP bootstrap 配置；`production.conf` 提供 HTTPS 配置。尚未获取线上配置，不应把本地配置等同线上状态。
- 旧连接脚本 `../work/probe_remote_runtime.py` 使用 `../work/family-life-deploy-ed25519-unlocked`，并非 `.codex-tmp/kkfamily_verify_rsa`。该部署密钥本轮未成功加载和认证，不能称为已验证有效。
- 普通执行在权限刷新后失败：`helper_unknown_error: setup refresh had errors`。
- 经审批的沙箱外执行身份为 `koujy\10353`；读取旧 Paramiko 文件与部署密钥权限均被拒绝。已检查的旧 Paramiko 文件所有者为 `KOUJY\CodexSandboxOffline`，仅 SYSTEM、Administrators、OWNER RIGHTS 有完全控制。
- 沙箱外 `C:\Python314\python.exe` 能导入已安装的 Paramiko 2.12.0；无须重复安装依赖。存在 TripleDES 弃用警告，非本次认证失败证据。

## 恢复顺序

1. 恢复本机沙箱启动及对已有部署密钥的合法读取。不得打印、提交或复制私钥到文档；不得对整个用户目录放宽 ACL。
2. 通过 Paramiko 使用现有部署密钥连接 `ubuntu@49.233.18.181`，核验服务器主机密钥；随后固定 known_hosts，拒绝主机密钥变化。
3. 检查线上 Docker 服务、监听端口、UFW、Nginx 实际配置、证书及磁盘；不显示 `.env` 或容器密码，不删除生产数据卷。
4. 核实 HTTP ACME 路径与证书申请条件后启用 HTTPS，保持同域名 `/api/` 代理；验证证书链、HTTP 跳转、API 健康及未登录接口鉴权，配置并检查续期。
5. 再次独立连接并复测公开接口。只有成功后才按用户要求写入不含密码/私钥的记忆记录。

以上为修复前检查记录。最终服务器改动及实测结果见本文首节；此前功能代码改动保持原样。
