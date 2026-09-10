# 客户端质量检查（2026-09-10）

## 本轮实测

实现提交`faa8baf`。Node.js 24.16.0、本机实际pnpm 11.19.0；原依赖缓存为工作区父目录`.pnpm-store`。首次未指定缓存时pnpm要求重建依赖目录，未确认删除；读取原`.modules.yaml`后沿用既有缓存完成安装。

| 门槛 | 结果 | 证明范围 |
| --- | --- | --- |
| `pnpm --filter @family-life/client lint` | 0错误、0警告 | 全部28个src TS/Vue源码文件；包含已注册页面，也检查未注册源码 |
| `pnpm --filter @family-life/client test` | 241/241 | 包含7条检查规则合同测试及原交互/会话回归；非生产双账号验收 |
| 冻结离线安装 | 成功，无重新解析 | 本机既有缓存可复用；不是从空缓存或Linux执行的证明 |
| `pnpm --filter @family-life/client build:mp-weixin` | 成功 | 微信生产编译，不等同完整TypeScript类型检查或真机验收 |
| 原导入目录同步 | 78文件SHA256差异0 | 保留`project.private.config.json`；无平台上传/发布 |

冻结安装实测命令：

```powershell
pnpm install --filter @family-life/client --frozen-lockfile --offline --ignore-scripts --store-dir 'C:\Users\10353\Documents\Codex\2026-08-26\new-chat\.pnpm-store'
```

## 规则与修复

采用ESLint 10.10.0、@eslint/js 10.0.1、typescript-eslint 8.70.0、eslint-plugin-vue 10.11.0、vue-eslint-parser 10.4.1，均固定版本并进入锁文件。开始尝试复用后端的ESLint 9.39.5，但注册表已声明其不再支持，因此仅客户端改用兼容的10版，不连带升级后端检查工具。

按[Vue ESLint官方指南](https://eslint.vuejs.org/user-guide/)保留Vue外层解析器、TypeScript内层解析器；启用JS/TS推荐规则及Vue essential正确性规则，不以大规模格式重排替代缺陷检查。仅为uni-app的`index.vue`路由命名保留例外，依赖目录和构建产物不纳入源码检查。`--max-warnings=0`防止警告被静默接受。

初次检查17项：8项计时器平台全局漏声明、6项模板全角空格、3项带副作用的三元条件语句。补充正确的平台只读全局、把条件操作改为if/else、全角空格改普通空格。迁入ESLint 10后另发现2处重新抛出错误未保留原始cause；现用非枚举cause保留原异常，不要求小程序引擎支持ES2022 Error构造选项。

7条合同测试验证：合法TS+Vue+uni-app能通过；未定义onLaunch、未使用变量/显式any、非法模板、v-if/v-for冲突、修改props、computed副作用及丢失cause能被拒绝；lint实际返回的文件集合与全部28个源码逐项一致，所有注册路由均在其中。不是“配置存在即视为通过”。

## 未关闭的门槛

- 根packageManager仍声明pnpm 10.12.1，而本机封装命令实际运行11.19.0。本轮未改根声明、未强制重建依赖；需在隔离目录核对声明版本的冻结安装与构建。
- 现有uni-app peer警告仍在：Vue 3.5.41与内部server-renderer 3.4.21；Vite 6.4.3与uni插件5.2.8及其他插件5.x要求；@dcloudio/types 3.4.32与uni-app 3.4.31。锁文件保留原运行依赖，本轮不谎称已完成版本兼容验收。
- 后端原有ESLint 9弃用及既有过期子依赖仍须另审，未在本次客户端变更中升级。
- 完整Vue/TypeScript类型检查尚未建立；lint、模拟测试和uni编译不能替代类型检查、真机、微信/COS/地图/订阅消息联调及正式发布验收。
