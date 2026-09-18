# 2026-09-18 目的地选点批次部署

## 已完成

- 用户明确授权修复单个部署密钥文件读取权限。旧密钥DACL只允许原SID读取；管理员提升后接管该文件所有权到Administrators，仅新增当前用户SID的读取权限，保留原条目。未递归修改目录、未开放Everyone、未读取或输出密钥内容。普通进程经Paramiko连接成功，GitHub推送成功。
- 公开Paramiko依赖使用新建work/ssh-runtime-20260917目录；旧依赖未删除、未修改ACL。两项连接工具更新依赖路径，主机指纹和既有密钥未更换。
- 发布代码 `c832b19f24886cd0e7b496690123bcd27fb0a639` 已推送GitHub main；包含上批地图首屏与本批目的地选点创建。

## 验证证据

隔离源码快照 `.codex-tmp/remote-db-verification/20260918T010506Z-ad958f26`，Compose运行ID `eaea5413579e69de`。

- 18次迁移、迁移状态、schema差异检查通过。
- 原PATCH业务53/53、POST兼容业务53/53通过。新增真实PostgreSQL用例确认行程、初始GCJ02地点、日历记录持久化，GET回读地点ID一致；无效输入未新增行程。
- 旧库升级6/6、通知7/7、行程5/5、选点创建单元3/3、传输兼容2/2通过。
- 客户端252/252、lint、vue-tsc及微信构建沿用本批已通过的本机证据；源码没有再次修改。
- 正式镜像隔离启动检查 `runtime-smoke-39d1b9ba806665b8.json` 通过，默认CMD迁移和worker启动正常。

## 部署与回退

14:29:59 +08:00生产部署完成。镜像 `kkfamily-api:c832b19`，摘要 `sha256:1985301cc2ce3b52dc90eaab09456ba7475265e5ec9e5afafbd694a1f87d9c68`。

备份目录 `/home/ubuntu/kkfamily-release-20260918T062850Z-6a31cc0f`，数据库备份SHA256 `d2eca06dea85ffc0142d77153a4fa472eea07711f41a6d0bb9b9eaa588e16a7b`。旧镜像保留为 `kkfamily-api:rollback-20260918T062850Z-6a31cc0f`。不自动恢复数据库。

生产迁移校验和与schema检查通过；本批没有新增迁移。HTTPS健康接口200/status=ok，未登录菜谱401。API与worker均为发布摘要，复核running=true/restarts=0。生产镜像内选点创建单元3/3再次通过（事务替身，不写生产数据）。

14:30:16 +08:00同步原 `outputs/mp-weixin`：78文件SHA256一致，14页面文件完整，project.private.config.json保留。没有上传微信平台或提交审核。

## 待用户验收及剩余差异

真机重新编译，进入“去露营 → 先选目的地，再安排出行”，选点、填日期、保存，再回地图和日历核对；测试取消选择不丢草稿。真机选点与地图动画尚不能根据自动化测试直接标PASS。

本次预检生产只有1账号/1家庭/1成员；COS_SECRET_ID与COS_SECRET_KEY仍未配置、MEDIA_DRIVER=disabled，照片上传未验收。配偶共享家庭、地图道路规划及微信平台发布门槛仍未完成，微信订阅继续延期。本次上线不等于全量需求完成或微信正式版发布。
