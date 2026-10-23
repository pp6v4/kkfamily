# Q02：0.1.2空JSON请求兼容修复（2026-10-23）

## 授权与执行范围

用户先反馈手机“吃什么”出现`Body cannot be empty when content-type is set to 'application/json'`，代理提出“修复空请求体问题→补回归验证→部署兼容补丁，让0.1.2继续实测”，用户明确回复“可以，做”，中断后又要求“继续修复bug”。这是R10：仅此兼容热修可以验证和部署，其他候选功能继续按R09安排。用户要求操作前一次性确认、随后执行并报告结果，避免反复陈述无关边界。

## 原因和复现

`meal/index.vue`读取已有本餐时调用`recalculateMeal`；旧`family-api.ts`发送无data的POST，`transport.ts`强制JSON头。Fastify在到达guard/业务前返回400。生产原API镜像a3cf4a72、健康200，近12小时日志有8次`/v1/meals/:id/recalculate`的400；无凭证、虚构资源探针空JSON为400，`{}`或无JSON头为401，与截图一致。

旧集成helper省略payload也不设置JSON头，前端测试直接stub成功，两者都没覆盖实际组合。旧候选0.1.3也包含问题。实际`recalculate`只读库存对照；本次不需要业务字段或迁移变化。

## 修复

- 客户端：`recalculateMeal`显式传`{}`；transport仅对undefined的POST/PUT/PATCH/DELETE规范为`{}`，保留显式null/数字/布尔/字符串/对象、身份头、PATCH别名和二进制上传；GET/HEAD不新增body。
- 服务端：`onRequest`只匹配原路由`POST /v1/meals/:id/recalculate`，JSON媒体类型、无Transfer-Encoding且Content-Length为0或缺失时移除不实的JSON头，让既有可选DTO进入原guard/controller/service。非空/坏JSON和其他接口保持原parser；chunked空流仍拒绝，chunked合法JSON保留。
- 热修生产镜像从正在运行的0.1.2镜像叠加，只覆盖启动JS和兼容函数JS；对应源分支只包含这两处后端修复及专项测试，不携带0.1.3行李并发等其他业务。

## 已执行验证

后端专项先在未兼容逻辑下3通过/3失败，错误为实际400；修复后6/6，补媒体类型/传输编码边界后8/8。实际Nest/Fastify/controller/DTO/JWT guard配合内存读服务，核对原参数、401/403/404、坏JSON、版本校验及其他路由；不是数据库或手机验收。

客户端新增12项专项，完整客户端394项、ESLint和vue-tsc通过。API build/lint及原70项加初版6项共76项非数据库测试通过，新增两项边界另8/8通过。独立审查另跑前端12/12、后端6/6及15项真实Nest矩阵，未发现阻断部署的问题。最终运行数量以末尾后续回执为准。

最终源码冻结后又运行完整API非数据库集合**78/78**（0失败、0跳过）及完整API ESLint，退出0。全量客户端394/394对应此次请求修正，尚未编译上传，生产恢复依赖下方后端兼容而非新客户端。

## 部署回执

**16:34:08（上海时间）部署与公网复测完成。** 热修源提交`87bc451841f1a75acf74d88e5dc5a65ac83702af`已推送`hotfix/empty-json-0.1.2-20261023`，父提交05859fd；相对0.1.2仅增加后端兼容函数、main注册和专项测试。完整候选源码（含未来客户端修复）提交`cd33ed6`在原候选分支，二者分别追踪。

| 核对项 | 实际回执 |
| --- | --- |
| 原API与worker | `sha256:a3cf4a72f1eacb8ef58b6f925d366d4d939472b27c1793fe1122ff54fcd7f8b7`，部署前均运行正常 |
| 新API | `kkfamily-api:q02-87bc451`；摘要`sha256:8bb41b6d27b52132bc232ce0996ebbfc2c21b74b2a22f6985aced40c3c578228` |
| 精确变更 | 原镜像层继承一致，仅叠`dist/main.js`与`dist/common/empty-json-compatibility.js`，启动命令为`node dist/main.js`。去掉main新增require/调用两行后，与运行旧镜像main逐字一致；未从候选F06等源码全量构建生产 |
| 服务器源文件 | 仅安装`apps/api/src/main.ts`、`apps/api/src/common/empty-json-compatibility.ts`；原main已受保护备份 |
| 预检与备份 | `/home/ubuntu/kkfamily-q02-20261023T083329Z-dc6c9b76`；dump SHA256 `09b86a2029bdea515b9bda68daaa56b8c49bae52f81eb9cea0ca6188d9ec9b20`、pg_restore目录可读；不是完整恢复演练 |
| 候选容器 | 独立容器、沿用实际配置和存储挂载、无宿主端口，显式node启动。在已有管理员/餐点上执行只读对照，两种请求均201、内容相同；核验后停止候选容器 |
| 生产公网 | 通过`https://pp6v4.com/api/v1`执行同样的已有餐点只读请求：旧空JSON201、显式{}201，两者数组完全一致；本次选中的既有餐点返回0条对照，不冒充非空食材计算验收 |
| 安全及副作用 | 未登录同路由401、坏JSON400；两次读取前后该家庭库存指纹一致。诊断在服务器进程内生成短时身份凭证，不输出或持久化；不是用户手机登录回执 |
| 运行状态 | API已切换新摘要并健康；Nginx验证并reload；worker保持原镜像。前后20批迁移名称及checksum逐项相同 |

完整非秘密回执在本机忽略目录`.codex-tmp/q02-release/20261023T083329Z-dc6c9b76/release.json`，运维脚本及受保护配置在仓库外保存。没有将服务器.env、身份凭证或生产业务内容放入Git。

手机复测：重新进入**0.1.2体验版→吃什么→刷新**；再切日期/餐别查看已有本餐，应不再出现英文空JSON错误，随后进入待做菜单。尚未收到用户这次手机复测结果，保留待反馈；未来客户端请求修正仍是候选源码。
