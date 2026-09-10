# 微信更新接口兼容与完整类型检查（2026-09-10）

## 发现与实现

完整 `vue-tsc` 检查发现：业务使用 PATCH，但当前 uni-app 微信 request 方法契约不包含 PATCH。这不是应当用类型断言掩盖的错误。依据 [uni-app 请求方法支持表](https://zh.uniapp.dcloud.io/api/request/request)，小程序统一将逻辑 PATCH 转为 POST `<原路径>/_patch`，查询参数、令牌、家庭头、版本和请求体不变；普通请求和二进制 PUT 不变。

后端在 Nest 注册路由前用 [Fastify onRoute](https://fastify.dev/docs/latest/Reference/Hooks/#onroute) 为24个 PATCH 路由生成 POST 入口，复用同一 Nest handler 与路由配置；保留原 PATCH，便于现有调用和后续其他终端使用。只为实际 PATCH 路由注册，不读取或信任 method-override 请求头。`routePath` 避免插件前缀重复。POST 不会递归生成入口。

仍使用 `https://pp6v4.com/api/v1`，Nginx `/api/` 转发不变，无新增域名或数据库迁移。此次类型采用 Nest 自身 Fastify 实例的推导类型，避免项目直接依赖和 Nest 内部 Fastify 版本不同造成不兼容；没有用 any 绕过检查。

其他修复：可选 onLoad 查询参数、switch 事件布尔值验证、订阅结果按指定模板检查、不把缺失/未知结果记录为拒绝；移除错误的 uni.request 响应泛型，验证响应 data 外层信封，异常成功响应明确报错而非挂起。

## 当前证据

- 全量客户端248/248通过，新增传输5条、页面事件/订阅结果2条。模拟微信和网络，不是真机验收。
- 完整 `vue-tsc --noEmit` 通过；没有降低 strict 或排除源码。vue-tsc固定3.3.11。
- 客户端lint为0错误0警告，微信生产构建成功。
- 后端构建通过。真实全部Controller注册测试及嵌套路由测试2/2：24个别名与原handler逐项相同且未登录401；实际JWT鉴权/DTO验证通过；模拟业务服务验证200/409透传；额外验证404、schema、bodyLimit、前缀和请求参数。
- 隔离数据库流程新增两轮相同HTTP业务测试：原生PATCH与POST兼容入口，后者只改变测试传输方式。尚未拿到这两轮的执行结果，不能宣称数据库闭环已通过。

## 交付顺序与未关闭项

必须先完成隔离数据库回归、运行镜像冒烟和后端部署，再同步新客户端至用户原导入目录。当前原导入目录仍保留上一版，不把要求新后端的客户端提前交付；未操作微信平台上传/发布。

完整类型检查已补齐，不等于依赖版本兼容和真实联调完成。仍保留pnpm声明/实跑差异、uni-app peers、真实微信双账号、COS、地图和订阅发送等验收边界。一期仍不自动增减库存。
