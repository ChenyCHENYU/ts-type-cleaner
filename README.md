<div align="center">

<img src="./docs/assets/banner.svg" alt="ts-type-cleaner" width="100%" />

**让堆积的类型无处可藏** —— TypeScript 编译器驱动的未使用类型分析工具

[![npm version](https://img.shields.io/npm/v/ts-type-cleaner?style=flat-square&color=818CF8&labelColor=0B1020)](https://www.npmjs.com/package/ts-type-cleaner)
[![npm downloads](https://img.shields.io/npm/dm/ts-type-cleaner?style=flat-square&color=22D3EE&labelColor=0B1020)](https://www.npmjs.com/package/ts-type-cleaner)
[![License](https://img.shields.io/badge/License-MIT-C084FC?style=flat-square&labelColor=0B1020)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-%E2%89%A5%204.5-3178C6?style=flat-square&labelColor=0B1020&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%E2%89%A5%2018-5FA04E?style=flat-square&labelColor=0B1020&logo=node.js&logoColor=white)](https://nodejs.org/)

[安装](#安装) · [命令](#命令与选项) · [输出示例](#输出示例) · [工作原理](#工作原理) · [FAQ](#faq)

</div>

## 它解决什么问题

项目长大之后，`types/` 目录和各模块里堆积了大量没人使用的 `interface` / `type` / `enum`：不敢删、不知道谁在用、review 也看不过来。

ts-type-cleaner 基于 **TypeScript 编译器 API** 遍历类型定义与引用，交叉验证 **ts-unused-exports**，一次性找出：

- **未使用类型** —— 已导出但全项目无人引用
- **重复定义** —— 同名类型在多个文件重复出现
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
| `analyze` | `a` | 完整分析：未使用类型 + 重复定义 + 类型错误，生成控制台报告与 Markdown 报告 |
| `check` | `c` | 快速检查类型错误并计算健康度，低于阈值时以非零码退出（适合 CI） |
| `summary` | `s` | 项目类型统计概览（定义数 / 使用数 / 健康度） |

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-r, --root <path>` | 项目根目录 | 当前目录 |
| `--src <dir>` | 源码目录（相对 root） | `src` |
| `--exclude <dirs>` | 追加排除目录，逗号分隔（如 `generated,legacy`） | 无 |
| `--allow <names>` | 公共 API 白名单，逗号分隔——面向消费者的导出不计为未使用 | 无 |
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
```

## 输出示例

```
📊 类型分析报告

  类型定义总数    156
  已使用          132
  未使用          18
  重复定义        4
  类型错误        2
  健康度          84%

  未使用类型（前 5 个）:
  ● UserInfo       src/types/user.ts:12     interface
  ● TableConfig    src/types/table.ts:8     type
  ● ApiResult      src/api/types.ts:3       interface
  ...
```

Markdown 报告写入 `type-reports/type-analysis-YYYY-MM-DD.md`（目录不存在会自动创建），包含完整清单与文件行号，可直接贴进 issue 或文档。

## 工作原理

1. **扫描**：遍历 `src/` 下 `.ts` / `.tsx` / `.vue` 文件（跳过 `.d.ts` 与 `node_modules`）
2. **双引擎检测**：TypeScript Compiler API 收集类型定义与引用 → ts-unused-exports 交叉验证导出使用情况；任一引擎异常时自动降级为内置的基础检测
3. **降噪**：内置 Vue3 / Pinia / Naive UI 常见全局 API 排除清单，避免框架 API 被误报
4. **口径一致**：类型错误检测加载项目自身 `tsconfig.json` 的编译选项，与项目 `tsc` 判定同源
4. **报告**：汇总健康度并渲染控制台输出 + Markdown 报告

**扫描约定**：默认扫描 `src/`（`--src` 可改），跳过 `src/stores/**`（团队内部约定）；`--exclude` 可追加排除目录。

## FAQ

<details>
<summary><b>它会自动删除未使用类型吗？</b></summary>

不会。工具只做检测与报告，避免误删；根据报告人工确认后清理更安全。

</details>

<details>
<summary><b>我的源码不在 src/ 目录，能用吗？</b></summary>

可以。用 `--src` 指定源码目录（相对项目根），例如 `npx ts-type-cleaner analyze --src app`；生成的、不想纳入扫描的目录用 `--exclude generated,legacy` 追加排除。

</details>

<details>
<summary><b>如何在 CI 里做卡点？</b></summary>

`check` 命令计算健康度并在低于阈值时非零退出：

```yaml
- run: npx ts-type-cleaner check -t 80
```

需要结构化结果时加 `--json`：输出 `passed` / `healthScore` / `errors` / `unused` 等字段，退出码语义不变（未通过仍非零退出）。

</details>

<details>
<summary><b>检测结果可信吗？误报怎么办？</b></summary>

双引擎交叉验证 + 框架全局排除清单降低误报；类型错误检测采用**项目自身 tsconfig** 的编译选项，与项目 `tsc` 口径一致（不会因工具侧缺少 `esModuleInterop` 等配置产生假阳性）。两类已知误报场景：动态字符串引用的类型、库类项目面向消费者的公共导出——后者用 `--allow PublicApi,PreloadRoute` 加入白名单即可。

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
