<div align="center">

<img src="./docs/assets/banner.svg" alt="ts-type-cleaner" width="100%" />

**让堆积的类型无处可藏** —— TypeScript 编译器驱动的未使用类型分析工具

[![npm version](https://img.shields.io/npm/v/ts-type-cleaner?style=flat-square&color=818CF8&labelColor=0B1020)](https://www.npmjs.com/package/ts-type-cleaner)
[![npm downloads](https://img.shields.io/npm/dm/ts-type-cleaner?style=flat-square&color=22D3EE&labelColor=0B1020)](https://www.npmjs.com/package/ts-type-cleaner)
[![CI](https://img.shields.io/github/actions/workflow/status/ChenyCHENYU/ts-type-cleaner/ci.yml?branch=main&style=flat-square&label=CI&labelColor=0B1020)](https://github.com/ChenyCHENYU/ts-type-cleaner/actions)
[![License](https://img.shields.io/badge/License-MIT-C084FC?style=flat-square&labelColor=0B1020)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-%E2%89%A5%204.5-3178C6?style=flat-square&labelColor=0B1020&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%E2%89%A5%2018-5FA04E?style=flat-square&labelColor=0B1020&logo=node.js&logoColor=white)](https://nodejs.org/)

[安装](#安装) · [命令](#命令与选项) · [输出示例](#输出示例) · [工作原理](#工作原理) · [FAQ](#faq)

</div>

## 它解决什么问题

项目长大之后，`types/` 目录和各模块里堆积了大量没人使用的 `interface` / `type` / `enum`：不敢删、不知道谁在用、review 也看不过来。

ts-type-cleaner 基于 **TypeScript 编译器 API** 遍历类型定义与引用，交叉验证 **ts-unused-exports**，一次性找出：

- **未使用类型** —— 全项目（含 `.vue`）无人引用的类型，已排除自引用与命名豁免项
- **同名类型提示** —— 同名类型在多个文件同时导出（非编译错误，建议确认是否合并）
- **类型错误** —— 项目自身的 TS 编译诊断

只做分析、不做删除，结果输出到控制台并生成 Markdown 报告，改不改、怎么改由你决定。

## 安装

```bash
pnpm add ts-type-cleaner -D
# 或
npm install ts-type-cleaner --save-dev
```

一次性使用也可以：`npx ts-type-cleaner analyze`

## 命令与选项

| 命令 | 别名 | 作用 |
|------|------|------|
| `analyze` | `a` | 完整分析：未使用类型 + 同名类型 + 类型错误，支持 `--fix` 生成/执行删除计划 |
| `check` | `c` | 快速检查类型错误并计算健康度，低于阈值时以非零码退出（适合 CI） |
| `summary` | `s` | 项目类型统计概览（定义数 / 使用数 / 健康度） |

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-r, --root <path>` | 项目根目录 | 当前目录 |
| `--src <dir>` | 源码目录（相对 root） | `src` |
| `--exclude <dirs>` | 追加排除目录，逗号分隔（如 `generated,legacy`） | 无 |
| `--allow <names>` | 公共 API 白名单，逗号分隔——面向消费者的导出不计为未使用 | 无 |
| `--ignore-pattern <names>` | 命名豁免追加后缀，逗号分隔（默认仅豁免 Vue 惯用名 `Props` / `Emits`） | 无 |
| `--max-unused <number>` | 允许的未使用类型上限，超出即非零退出（`check`，适合 CI 卡 unused） | 不限制 |
| `--fix` | 生成未使用类型的删除计划（dry-run 只预览不写盘） | 关闭 |
| `--write` | 配合 `--fix` 实际写盘：删整块声明 → 重跑 tsc 验证 → 有新增错误则整体回滚 | 关闭 |
| `--no-errors` | 跳过类型错误检测，只查未使用/同名（1k 文件约 1s；`--fix` 时强制完整检测） | 关闭 |
| `--error-engine <engine>` | 错误检测口径：`auto`（默认，装了 vue-tsc 就用）/ `tsc` / `vue-tsc` | `auto` |
| `--json` | JSON 纯净输出（隐含不生成 Markdown 报告；`check` 额外返回 `passed` 结论字段） | 关闭 |
| `-v, --verbose` | 显示详细分析过程（analyze） | 关闭 |
| `--no-report` | 不生成 Markdown 报告（analyze） | 生成 |
| `-t, --threshold <number>` | 健康度阈值（check） | `70` |

```bash
# 完整分析（生成 type-reports/type-analysis-<日期>.md）
npx ts-type-cleaner analyze

# CI 卡点：健康度低于 80 直接失败
npx ts-type-cleaner check -t 80

# 统计概览
npx ts-type-cleaner summary

# 生成删除计划（dry-run，只预览）
npx ts-type-cleaner analyze --fix

# 实际删除：删整块声明 → 验证无新增类型错误，失败自动回滚
npx ts-type-cleaner analyze --fix --write

# 日常快速清理（跳过错误检测）
npx ts-type-cleaner analyze --no-errors --fix
```

## 输出示例

```
📊 类型分析报告

  源文件          1016     类型定义        699
  类型引用        2.3k     类型错误        212
  同名类型        41       未使用类型      38
  命名豁免        5        交叉排除        552
  健康度          37/100

  未使用类型（前 5 个）:
  ● UserInfo       src/types/user.ts:12     interface
  ● TableConfig    src/types/table.ts:8     type
  ● ApiResult      src/api/types.ts:3       interface
  ...
```

Markdown 报告写入 `type-reports/type-analysis-YYYY-MM-DD.md`（目录不存在会自动创建），包含完整清单与文件行号，可直接贴进 issue 或文档。

每次运行还会更新趋势快照 `type-reports/last-report.json`，下次运行时控制台与 Markdown 报告会显示**较上次的差值**（未使用 / 类型错误 / 同名类型），适合周清理与 CI 观察；`--json` 模式保持纯净输出、不读写快照。建议把 `type-reports/` 加入 `.gitignore`。

## 工作原理

1. **扫描**：遍历 `src/` 下 `.ts` / `.tsx` / `.vue` 文件（跳过 `.d.ts` 与 `node_modules`）
2. **收集**：TypeScript Compiler API 收集类型定义与全量类型引用（含 `.vue` `<script>` 块，行号已换算回 `.vue` 文件真实行号；自引用如 `type Tree = { children: Tree[] }` 不计为使用）
3. **双引擎交叉验证**：ts-unused-exports 判定「导出无人 import」→ 再用自收集的引用（含 `.vue`）否决——**只被 .vue 使用的类型不会被误报**；未导出的局部类型由内置检测补充（ts-unused-exports 的盲区）。引擎异常时**显式警告**并降级为基础检测（不再静默）
4. **降噪**：内置 Vue3 / Pinia / Naive UI 常见全局 API 排除清单；命名豁免默认仅 `Props` / `Emits`（Vue SFC 惯用名），可用 `--ignore-pattern` 追加，豁免数量在报告中如实展示
5. **错误口径**：默认 `auto`——项目装了 `vue-tsc` 时用它检测（`.vue` 文件的类型错误首次可见；
   纯 tsc 看不见 `.vue` 模块真实类型，`import` 一律 `any` 并产生级联噪音）；未装则用内嵌 tsc
   （同样加载项目 `tsconfig.json` 编译选项，与项目 `tsc` 判定同源）
6. **报告**：汇总健康度并渲染控制台输出 + Markdown 报告

**扫描约定**：默认扫描 `src/`（`--src` 可改），跳过 `src/stores/**`（团队内部约定）；`--exclude` 可追加排除目录。

**健康度评分**（满分 100）：类型错误每个 -15（最多 -60）；未使用类型按占比扣分（最多 -15）。跨文件同名类型是提示项而非错误，不扣分。`--no-errors` 时跳过错误项（报告中如实标注 `errorsSkipped`）。

## FAQ

<details>
<summary><b>它会自动删除未使用类型吗？</b></summary>

`analyze --fix` 生成删除计划（dry-run 预览），加 `--write` 才写盘。安全机制：

- 只删**整块声明**（interface / type / enum，含 `export`）：`.ts` / `.tsx` 始终可删；
  `.vue` 内的声明在项目装有 vue-tsc（可做删除后验证）时同样可删，否则仅报告
- 写盘后按本次分析口径重跑验证（vue-tsc 或 tsc），出现**任何新增错误即整体回滚**
- 删除计划基于交叉验证后的结果（.vue 引用、自引用、extends/值使用均已排除误报）

</details>

<details>
<summary><b>我的源码不在 src/ 目录，能用吗？</b></summary>

可以。用 `--src` 指定源码目录（相对项目根），例如 `npx ts-type-cleaner analyze --src app`；生成的、不想纳入扫描的目录用 `--exclude generated,legacy` 追加排除。

</details>

<details>
<summary><b>如何在 CI 里做卡点？</b></summary>

`check` 命令计算健康度并在低于阈值时非零退出：

```yaml
# 健康度低于 80、或未使用类型超过 5 个，任一命中即失败
- run: npx ts-type-cleaner check -t 80 --max-unused 5
```

需要结构化结果时加 `--json`：输出 `passed` / `healthScore` / `maxUnused` / `errors` / `unused` 等字段，退出码语义不变（未通过仍非零退出）。

**退出码**：`check` 在「存在类型错误」「健康度低于阈值」「未使用类型超上限」任一命中时以 `1` 退出；`analyze` 在存在类型错误时以 `1` 退出（`--json` 输出不受影响）。

</details>

<details>
<summary><b>检测结果可信吗？误报怎么办？</b></summary>

未使用判定 = ts-unused-exports（导出维度）∩ 本工具全量引用收集（含 `.vue`）交叉验证，只被 .vue 使用的类型不会误报；类型错误检测采用**项目自身 tsconfig** 的编译选项，与项目 `tsc` 口径一致（不会因工具侧缺少 `esModuleInterop` 等配置产生假阳性）。已知残留误报场景：动态字符串引用的类型、库类项目面向消费者的公共导出——后者用 `--allow PublicApi,PreloadRoute` 加入白名单。已知漏报场景：命中命名豁免（`Props`/`Emits` 后缀，报告中有豁免计数）与 `src/stores/**` 排除目录内的类型。

</details>

## 兼容性

| 项目 | 要求 |
|------|------|
| TypeScript | `>= 4.5`（peer dependency，使用项目自身的 TS） |
| Node.js | `>= 18` |
| 项目结构 | `.ts` / `.tsx` / `.vue`（Vue SFC 支持） |

## 版本历史

见 [GitHub Releases](https://github.com/ChenyCHENYU/ts-type-cleaner/releases) 与 [提交记录](https://github.com/ChenyCHENYU/ts-type-cleaner/commits/main)。

## 贡献

欢迎提交 [Issue](https://github.com/ChenyCHENYU/ts-type-cleaner/issues) 与 Pull Request。

## 许可证

[MIT](./LICENSE) © 2025-present CHENY

## 作者

**CHENY** · [GitHub @ChenyCHENYU](https://github.com/ChenyCHENYU)

---

<div align="center">
  <sub>如果这个工具对你有帮助，欢迎点一个 ⭐ 让更多人看到。</sub>
</div>
