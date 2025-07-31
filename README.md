# 🛠️ Vue Type Checker

**专为 Vue3 + TypeScript 项目设计的类型分析工具**

[![npm version](https://img.shields.io/npm/v/vue-type-checker.svg)](https://www.npmjs.com/package/vue-type-checker)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js CI](https://img.shields.io/badge/Node.js->=16.0.0-green.svg)](https://nodejs.org/)

一个简洁高效的 TypeScript 类型分析工具，专门针对 Vue3 + TS 项目优化，帮助你：

- ✅ **精准检测类型错误** - 明确定位到文件和行号
- ⚠️ **识别重复类型定义** - 排除框架重复，只关注真正的问题  
- 🗑️ **清理未使用类型** - 保持代码整洁
- 📊 **健康度评分** - 量化代码类型质量
- 📋 **详细报告生成** - 便于团队协作和问题追溯

## 🎯 特性亮点

### 🔍 智能分析
- 只扫描 `src/` 目录，避免无关文件干扰
- 支持 `.ts`、`.tsx`、`.vue` 文件
- 使用 TypeScript Compiler API 确保准确性

### 🎨 精美输出
- 彩色控制台输出，信息一目了然
- 进度条显示健康度评分
- 分类展示问题类型

### 📈 多种模式
- **快速检查** - 适合 CI/CD 流水线
- **完整分析** - 生成详细报告
- **统计概览** - 项目类型使用情况

## 🚀 快速开始

### 安装

```bash
# npm
npm install vue-type-checker --save-dev

# yarn  
yarn add vue-type-checker -D

# pnpm
pnpm add vue-type-checker -D
```

### 基本使用

```bash
# 快速检查类型错误
npx vue-type-checker check

# 完整分析并生成报告
npx vue-type-checker analyze

# 查看项目类型统计
npx vue-type-checker summary
```

## 📋 命令详解

### `check` - 快速检查

适合在 CI/CD 中使用，快速验证类型正确性：

```bash
npx vue-type-checker check [options]

Options:
  -r, --root <path>        项目根目录 (默认: 当前目录)
  -t, --threshold <number> 健康度阈值 (默认: 70)
  -h, --help              显示帮助信息
```

**示例输出：**
```
──────────────────────────────────────────────────
🎯 TypeScript 类型检查
──────────────────────────────────────────────────
📊 健康度评分: 85/100
🚨 类型错误: 0  
⚠️ 重复定义: 2
🗑️ 未使用类型: 5
──────────────────────────────────────────────────

🎉 检查通过！
```

### `analyze` - 完整分析

进行深度分析并生成详细报告：

```bash
npx vue-type-checker analyze [options]

Options:
  -r, --root <path>    项目根目录 (默认: 当前目录)
  -v, --verbose        显示详细信息
  --no-report          不生成 Markdown 报告
  -h, --help          显示帮助信息
```

**功能：**
- 精美的控制台报告
- 自动生成 Markdown 详细报告
- 按文件分组显示问题
- 提供修复建议

### `summary` - 统计概览

快速了解项目类型使用情况：

```bash
npx vue-type-checker summary [options]

Options:
  -r, --root <path>    项目根目录 (默认: 当前目录)
  -h, --help          显示帮助信息
```

## 🔧 集成到项目

### Package.json Scripts

```json
{
  "scripts": {
    "type:check": "vue-type-checker check",
    "type:analyze": "vue-type-checker analyze", 
    "type:summary": "vue-type-checker summary",
    "precommit": "vue-type-checker check --threshold 80"
  }
}
```

### GitHub Actions

```yaml
name: Type Check
on: [push, pull_request]

jobs:
  type-check:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v3
        
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Type check
        run: npx vue-type-checker check --threshold 75
```

### Git Hooks (husky)

```json
{
  "husky": {
    "hooks": {
      "pre-commit": "vue-type-checker check",
      "pre-push": "vue-type-checker check --threshold 80"
    }
  }
}
```

## 📊 报告示例

### 控制台输出

```
═══════════════════════════════════════════════════════════
🛠️  TypeScript 类型分析报告
═══════════════════════════════════════════════════════════

📊 健康度评分
─────────────────────────
🟢 综合评分: 85/100 (良好)
[████████████████████████░░░░░░] 85%

📈 统计数据  
─────────────────────────
📁 源文件    42     🎯 类型定义   156
🔗 类型引用  298    🚨 类型错误     0
⚠️ 重复定义    2     🗑️ 未使用类型    8

🚨 类型错误 (0)
─────────────────────────────────────────────────
✅ 未发现类型错误

⚠️ 重复类型定义 (2)
─────────────────────────────────────────────────

🔄 User
  1. src/types/user.ts:5 (interface)
  2. src/components/User.vue:12 (interface)

🗑️ 未使用类型 (8)
─────────────────────────────────────────────────
• ApiResponse    • UserConfig     • ThemeOptions   • FormState
• TableColumn    • MenuConfig     • LayoutProps    • ButtonType

💡 改进建议
─────────────────────────
1. ⚠️ 合并或重命名 2 个重复类型
2. 🗑️  清理 8 个未使用类型

═══════════════════════════════════════════════════════════
🎉 代码类型系统状态良好，继续保持！
═══════════════════════════════════════════════════════════
```

### Markdown 报告

工具会在 `type-reports/` 目录下生成详细的 Markdown 报告，包含：

- 📋 执行摘要和健康度评分
- 📊 详细统计数据表格  
- 🚨 类型错误详情（文件、行号、错误信息）
- ⚠️ 重复类型定义位置
- 🗑️ 未使用类型列表
- 💡 具体的修复建议
- 🔧 快速修复指南

## 🎯 检测能力

### 类型错误检测
- `TS2322` - 类型不匹配
- `TS2345` - 参数类型错误  
- `TS2304` - 找不到名称
- `TS2339` - 属性不存在
- `TS2571` - 对象类型未知
- `TS2531` - 对象可能为空
- `TS2532` - 对象可能未定义

### 重复类型检测
- 跨文件的同名类型定义
- 排除框架和依赖库类型
- 提供具体位置和合并建议

### 未使用类型检测  
- 定义但未引用的类型
- 自动排除导出类型
- 支持安全清理

## ⚙️ 配置选项

### 命令行参数
- `--root` - 指定项目根目录
- `--threshold` - 设置健康度阈值
- `--verbose` - 显示详细调试信息
- `--no-report` - 跳过 Markdown 报告生成

### 环境变量
```bash
# 启用详细模式
VTC_VERBOSE=true npx vue-type-checker analyze

# 设置默认阈值
VTC_THRESHOLD=80 npx vue-type-checker check
```

## 🚧 项目要求

- **Node.js** >= 16.0.0
- **TypeScript** >= 4.5.0
- **Vue** >= 3.0.0 (可选，仅分析 .vue 文件时需要)

## 📂 目录结构

工具只扫描 `src/` 目录下的文件：

```
your-project/
├── src/                    # ✅ 会被扫描
│   ├── components/         # ✅ Vue 组件
│   ├── types/             # ✅ 类型定义
│   ├── utils/             # ✅ 工具函数
│   └── views/             # ✅ 页面组件
├── node_modules/          # ❌ 自动跳过
├── dist/                  # ❌ 自动跳过  
└── type-reports/          # 📋 报告输出目录
    └── type-analysis-2024-01-15.md
```

## 🔍 支持的文件类型

- **`.ts`** - TypeScript 文件
- **`.tsx`** - TypeScript JSX 文件  
- **`.vue`** - Vue 单文件组件 (需要 `<script lang="ts">`)

## ❓ 常见问题

### Q: 为什么某些 Vue 组件没有被检测？
**A:** 确保 Vue 文件使用了 `<script lang="ts">` 或 `<script setup lang="ts">`。

### Q: 如何排除某些文件？
**A:** 工具会自动排除 `.d.ts`、`.test.ts`、`.spec.ts` 文件和 `node_modules` 目录。

### Q: 健康度评分如何计算？
**A:** 基于以下权重计算：
- 类型错误：50%（每个错误扣 10 分）
- 重复定义：25%（按比例扣分）
- 未使用类型：15%（按比例扣分）

### Q: 可以在 monorepo 中使用吗？
**A:** 可以，通过 `--root` 参数指定每个子包的根目录。

### Q: 报告文件保存在哪里？
**A:** 默认保存在项目根目录的 `type-reports/` 文件夹中。

## 🛠️ 高级用法

### 编程式调用

```javascript
import { analyzeProject, quickCheck, getProjectStats } from 'vue-type-checker'

// 完整分析
const report = await analyzeProject({
  rootDir: './my-project',
  verbose: true
})

// 快速检查
const result = await quickCheck({
  rootDir: './my-project',
  threshold: 80
})

console.log(result.passed ? '✅ 通过' : '❌ 失败')

// 获取统计数据
const stats = await getProjectStats({
  rootDir: './my-project'
})

console.log(`发现 ${stats.errors} 个错误`)
```

### 自定义报告

```javascript
import { TypeAnalyzer, ReportGenerator } from 'vue-type-checker'

const analyzer = new TypeAnalyzer({ rootDir: './src' })
const report = await analyzer.analyze()

const reporter = new ReportGenerator('./project')
reporter.generateConsoleOutput(report)
await reporter.generateMarkdownReport(report)
```

## 🎨 输出自定义

### 禁用颜色输出
```bash
NO_COLOR=1 npx vue-type-checker analyze
```

### JSON 格式输出
```bash
npx vue-type-checker analyze --json > report.json
```

## 📈 性能优化

### 大型项目优化
- 工具自动跳过 `node_modules` 和构建产物
- 使用增量分析减少重复计算
- 内存使用优化，支持大型代码库

### 并行处理
- 多文件并行分析
- TypeScript 编译器缓存优化
- 智能文件过滤减少扫描范围

## 🔄 版本历史

### v1.0.0
- ✨ 初始版本发布
- 🎯 支持 Vue3 + TypeScript 项目分析
- 📊 健康度评分系统
- 📋 Markdown 报告生成

## 🤝 贡献指南

我们欢迎任何形式的贡献！

### 报告问题
- 在 [GitHub Issues](https://github.com/your-username/vue-type-checker/issues) 提交 bug 报告
- 提供详细的复现步骤和环境信息

### 功能请求
- 在 Issues 中描述你期望的功能
- 说明使用场景和预期效果

### 代码贡献
1. Fork 项目仓库
2. 创建功能分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add some amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

### 开发设置

```bash
# 克隆仓库
git clone https://github.com/your-username/vue-type-checker.git
cd vue-type-checker

# 安装依赖
npm install

# 开发模式
npm run dev

# 运行测试
npm test

# 构建项目
npm run build

# 发布准备
npm run prepublish
```

### 代码规范

- 使用 ESLint 和 Prettier 格式化代码
- 提交前运行 `npm run lint`
- 保持测试覆盖率 > 80%

## 📄 许可证

[MIT License](LICENSE)

```
MIT License

Copyright (c) 2024 Vue Type Checker

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 🙏 致谢

感谢以下优秀的开源项目：

- [TypeScript](https://www.typescriptlang.org/) - 强大的类型系统
- [Vue.js](https://vuejs.org/) - 渐进式 JavaScript 框架
- [Commander.js](https://github.com/tj/commander.js/) - 命令行工具框架
- [Chalk](https://github.com/chalk/chalk) - 终端颜色库
- [Ora](https://github.com/sindresorhus/ora) - 优雅的终端加载动画

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=your-username/vue-type-checker&type=Date)](https://star-history.com/#your-username/vue-type-checker&Date)

---

**如果这个工具对你有帮助，请给个 ⭐️ Star 支持一下！**

**Happy Coding! 🚀**