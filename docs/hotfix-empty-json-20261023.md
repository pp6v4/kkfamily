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

## 部署回执

准备中。完成后追加实际源提交、镜像、精确安装文件、运行探针及手机复测步骤；不能用本节计划冒充已恢复。用户仍通过0.1.2体验版测试同一个“吃什么→日期/餐别→待做菜单”流程。
