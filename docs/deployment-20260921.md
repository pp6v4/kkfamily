# 2026-09-21 挂载媒体生产部署

## 已部署

- 代码提交：`4fd4bbc`，已推送 GitHub main。
- 镜像：`kkfamily-api:4fd4bbc`。
- 摘要：`sha256:55a0b8ee436100954ca320df759287dc353ecac5408343fc9c619a1b8f81f361`。
- 完成时间：2026-09-21 15:54:34（北京时间）。
- 新桶：`familylife-1303887403`；宿主机/API 容器路径：`/mnt/family-life-cos`。
- `infra/docker-compose.override.yml` 持久启用 API 的 mounted 驱动及目录映射。
- 无前端协议变化，本次无需重新构建或导入小程序；服务器部署不等于微信平台发布。

## 验证证据

- 隔离快照 `20260918T074103Z-5995b7ed`：迁移、结构、单元检查通过。
- HTTP memory/native、memory/POST、mounted/native、mounted/POST 四组均 53/53。
- 真实挂载精确字节读写、内容并发隔离、损坏检测和重试通过。
- 正式镜像 smoke `7d8304c70e1e88ad`：默认 CMD 应用18项迁移，worker 启动，health 200，受保护接口401。
- 生产 API 内确认 MEDIA_DRIVER=mounted 且精确 COS 挂载校验通过。
- 生产 HTTPS health=ok，未授权菜谱401；API/worker 均 running，重启次数0。
- 15:55 只读核查：真实账号1、家庭1、成员1，管理员角色和“扣扣的家”保留；菜谱/餐次/购物/行程仍为0。

## 备份与回滚注意

- 备份目录：`/home/ubuntu/kkfamily-release-20260921T075318Z-aee7a20a`。
- 数据库备份 SHA-256：`a54f3979c919c473087e6715d4696125f10bc568350452b2a021be0e31f6bd06`。
- 原镜像：`sha256:1985301cc2ce3b52dc90eaab09456ba7475265e5ec9e5afafbd694a1f87d9c68`。
- 原镜像不支持 mounted：回滚必须同时审查/撤销本次新增的 Compose override，不能只切镜像。
- 不自动恢复数据库、不自动删除 COS 文件。挂载恢复后须重新创建 API 绑定新挂载，不只检查宿主机。

## 尚未完成的验收

- 用户真机新建菜谱、上传封面、退出再进入查看照片。
- 第二个真实账号共享家庭和授权访问验收。
- 没有对生产宿主机做断网或卸载 COS 的故障注入；不宣称真实网络故障恢复已经验收。
- 未执行微信平台上传、审核或正式发布。

本记录只证明本次媒体后端部署，不代表全部设计需求均已实现和验收。
