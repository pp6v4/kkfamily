# Q02：0.1.2空JSON请求兼容修复（2026-10-23）

最新补充：第一次兼容只覆盖recalculate，用户继续实测发现撤回点菜同样失败。下方保留首次16:34:08回执，后续五条无body DELETE补齐情况见文末，不以首次成功声明整个点菜链路已验收。

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

## 后续：撤回点菜与同类DELETE

用户反馈“点餐了之后不能撤回，还是这个报错”。生产无凭证+不存在资源探针确认五条无body DELETE均为400原空JSON文本：撤回本人点菜、移除行程节点、路段、住宿及行李。此前按“DELETE是否触发取决于实际传输”保留为疑点，没有完整验证，是首次补丁漏项。

兼容白名单按真实注册路由增加这五条DELETE，仍要求JSON类型、无TE、CL为0或缺失；原JWT、家庭/行程/业务权限、版本query及confirm仍由原代码处理。邀请撤销必须提交version body，未纳入白名单。

新增`empty-json-delete.unit.test.cjs`31/31通过；无hook baseline五路均复现400。测试采用真实Nest/Fastify/controller/DTO/JWT，并核对query精确传入、401/403/404、版本拒绝、坏JSON与传输编码边界；真实HTTP调用MealsService内存事务，确认只撤本人、保留配偶同菜与其他菜、重复不再次升版本。既有餐点专项5/5通过；主线程最终完整非数据库集合109/109（0失败、0跳过）、API build/lint通过。

**16:48:51（上海时间）已部署并完成公网复测。**候选源码`b51f246`、精确生产热修源`00a024df6dae189150f2876c107a7c7207566c3d`已推送各自分支；后者承接87bc451，不包含候选行李并发功能。

- 新API镜像`kkfamily-api:q02-00a024d`，摘要`sha256:71167f4acdfabddc86d8933e824a4d7086425c0dceebd28745ec9034bb5d3af3`。继承8bb41b6原镜像，只更新兼容函数；main与运行原main逐字相同。
- 独立容器与生产公网均验证五条旧空JSON DELETE：无凭证401，合法现有身份访问虚构不存在资源为404/403，和{}请求的业务拒绝一致；不再报空JSON400。没有用真实菜品/行程记录执行删除验证。
- 公网重新读取已有餐点，原空POST及{}均201且**13条实际材料对照完全一致**，读取前后库存指纹一致；坏JSON400。这里是服务器诊断，不是手机撤回验收。
- 本地真实HTTP→MealsService内存事务已经证明实际撤回只影响本人意愿、保留配偶同菜，重复撤回不重复升版本；生产真机由用户接着验证。
- 备份/回执目录`/home/ubuntu/kkfamily-q02-20261023T084820Z-962857a0`，dump SHA256 `923134b2c09a9d97de2144e56150c4b5fdf99ede02fb4a43ff4b74553a711d57`。前后20迁移名称/checksum相同，worker仍原a3cf镜像，Nginx已reload。

复测步骤：在原0.1.2体验版刷新“吃什么”，在仍处于点菜中的餐点点“撤回我的选择”；本人选择应撤回，别人对同一道菜的选择应保留。已确认餐点须按原规则处理，不因本补丁开放普通成员改单。反馈结果尚待用户提供。
