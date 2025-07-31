# TypeScript Type Cleaner

一个高效的 TypeScript 项目类型分析和清理工具。自动发现未使用的类型定义、重复定义和类型错误，帮你保持代码整洁。

## ⚡ 快速开始

```bash
# 全局安装
npm install -g ts-type-cleaner

# 或者直接使用
npx ts-type-cleaner analyze
```

## ✨ 核心功能

- **🔍 智能分析**：深度扫描项目，精确识别类型使用情况
- **🧹 自动清理**：找出未使用的类型定义和重复声明
- **🔧 类型验证**：检查 TypeScript 编译错误和代码质量问题
- **📊 可视化报告**：生成详细的 HTML/Markdown 报告
- **⚡ CI/CD 友好**：支持快速检查模式，适合持续集成

## 🚀 基本用法

### 快速分析

```bash
# 分析当前项目
ts-type-cleaner analyze

# 指定目录和阈值
ts-type-cleaner analyze --root ./src --threshold 85
```

**输出示例：**
```
🛠️ TypeScript 类型分析报告
══════════════════════════════════════════════════

📊 分析统计

   📁 源文件        45
   🎯 类型定义      120
   ❌ 未使用类型    12
   ⚠️ 重复定义      3
   💯 健康评分      85/100

💡 改进建议

   1. 💡 发现 12 个未使用的类型定义，建议清理
   2. ⚠️ 发现 3 个重复的类型定义，建议合并
```

### 类型验证

```bash
# 基础验证
ts-type-cleaner validate

# 严格模式+详细错误
ts-type-cleaner validate --strict --format
```

**美化输出效果：**
```
🔧 类型验证结果
─────────────────────────────

🚨 错误详情

   1. src/components/UserCard.tsx:15
      ▶ Property 'username' does not exist on type 'User'

   2. src/utils/helper.ts:8
      ▶ Cannot find name 'debounce'
```

### 完整检查

```bash
# 分析 + 验证 + 生成报告
ts-type-cleaner check --format html

# 自动打开报告
ts-type-cleaner check --format html --output ./reports
```

## 📋 命令参考

### `analyze` - 类型使用分析

深度分析项目中的类型定义使用情况。

```bash
ts-type-cleaner analyze [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-r, --root <path>` | 项目根目录 | 当前目录 |
| `-o, --output <path>` | 输出目录 | `./type-reports` |
| `-t, --threshold <num>` | 健康分数阈值 | `70` |
| `--include <patterns>` | 包含文件模式 | `src/**/*.{ts,tsx,vue}` |
| `--exclude <patterns>` | 排除文件模式 | `node_modules,dist,.git` |
| `--json` | JSON 格式输出 | `false` |
| `--verbose` | 详细信息 | `false` |

### `validate` - 类型验证

检查 TypeScript 编译错误和代码质量。

```bash
ts-type-cleaner validate [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--strict` | 严格模式检查 | `false` |
| `--fix` | 尝试自动修复 | `false` |
| `--json` | JSON 格式输出 | `false` |

### `check` - 完整检查

运行完整的分析和验证，生成综合报告。

```bash
ts-type-cleaner check [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--format <type>` | 报告格式：`html`\|`markdown`\|`json` | `html` |
| `-t, --threshold <num>` | 健康分数阈值 | `70` |

### `quick` - 快速检查

适合 CI/CD 的轻量级检查。

```bash
ts-type-cleaner quick [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--silent` | 静默模式 | `false` |
| `--format <type>` | 输出格式：`text`\|`json`\|`junit` | `text` |

### `init` - 初始化配置

创建项目配置文件。

```bash
ts-type-cleaner init [--force]
```

## ⚙️ 配置文件

在项目根目录创建 `.ts-type-cleaner.json`：

```json
{
  "rootDir": "./",
  "outputDir": "./type-reports",
  "verbose": false,
  "strict": false,
  "include": ["src/**/*.{ts,tsx,vue}"],
  "exclude": ["node_modules", "dist", ".git", "**/*.d.ts"],
  "threshold": 70,
  "ignoreVueComponentTypes": true,
  "ignorePatterns": [
    "^Props$",
    "^Emits$", 
    "/Props$/",
    "/Events?$/"
  ]
}
```

## 📊 健康评分算法

项目健康分数基于以下因素计算：

- **基础分：** 100 分
- **未使用类型：** 每个扣 40% 权重
- **重复定义：** 每个扣 30% 权重
- **复杂度奖励：** 大型项目获得额外加分

**评级标准：**
- 90+ 分：🎉 优秀
- 70-89 分：✅ 良好
- 50-69 分：⚠️ 需改进
- 50- 分：❌ 需要修复

## 🎯 实际应用场景

### 1. 项目重构前的准备

```bash
# 全面体检
ts-type-cleaner check --format html --verbose

# 查看详细报告，制定清理计划
```

### 2. 持续集成质量门禁

```bash
# 在 CI 脚本中添加
ts-type-cleaner quick --threshold 80 --format junit

# GitHub Actions 示例
- name: TypeScript Type Check
  run: |
    npx ts-type-cleaner quick --threshold 85
    if [ $? -ne 0 ]; then exit 1; fi
```

### 3. 代码审查辅助

```bash
# 生成审查报告
ts-type-cleaner check --format markdown --output ./review-reports

# 将报告附加到 PR 描述中
```

### 4. 定期维护清理

```bash
# 每周运行的清理脚本
#!/bin/bash
echo "🧹 开始类型清理..."
ts-type-cleaner analyze --threshold 85
ts-type-cleaner validate --strict
echo "✅ 清理完成"
```

## 📋 生成的报告

### HTML 报告特性
- 📊 可交互的统计图表
- 🔍 详细的错误上下文
- 💡 智能修复建议
- 🎨 现代化 UI 设计

### Markdown 报告内容
- 📈 项目健康概览
- 📝 未使用类型清单
- 🔧 错误修复指南
- 💭 最佳实践建议

### JSON 报告用途
- 🔌 与其他工具集成
- 📈 历史数据分析
- 🤖 自动化处理

## 🤔 常见问题

### Q: 为什么某些我确实在用的类型被标记为"未使用"？

**A:** 可能的原因：
- 只在类型断言中使用：`as UserType`
- 仅在注释中引用
- 通过动态导入使用
- 作为其他库的接口约束

**解决方案：**
在配置文件中添加忽略模式，或使用 `// @ts-type-cleaner-ignore` 注释。

### Q: 如何提高健康分数？

**A:** 按优先级排序：
1. **修复类型错误**（影响最大）
2. **删除真正未使用的类型**
3. **合并重复的类型定义**
4. **优化类型结构**

### Q: 支持 Vue 项目吗？

**A:** 完全支持！工具能够：
- 解析 `.vue` 文件中的 `<script lang="ts">` 块
- 智能忽略 Vue 组件内部类型（Props、Emits 等）
- 分析 Vue 3 Composition API 类型使用

### Q: 可以在 monorepo 中使用吗？

**A:** 可以。建议：
```bash
# 分析特定包
ts-type-cleaner analyze --root ./packages/core

# 或者在每个包的根目录分别运行
cd packages/ui && ts-type-cleaner check
cd packages/utils && ts-type-cleaner check
```

## 🔧 技术要求

- **Node.js:** 16.0 或更高版本
- **TypeScript:** 4.0+ 项目
- **配置文件:** 项目根目录需要 `tsconfig.json`

## 🏆 最佳实践

### 1. 定期检查
```bash
# 建议频率
# 开发阶段：每天 quick 检查
# 发布前：完整 check
# 重构时：详细 analyze
```

### 2. 团队规范
- 设置统一的健康分数阈值
- 将检查集成到 pre-commit hooks
- 定期分享报告进行代码审查

### 3. 渐进式改进
- 先修复明显的错误
- 逐步提高阈值标准
- 记录改进过程和效果

### 4. 自动化流程
```yaml
# .github/workflows/type-check.yml
name: Type Quality Check
on: [push, pull_request]
jobs:
  type-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install dependencies
        run: npm ci
      - name: Type quality check
        run: npx ts-type-cleaner quick --threshold 80
```

## 🎨 输出格式示例

### 简洁模式
```
✅ 类型检查通过 (评分: 87/100)
```

### 详细模式
```
🛠️ TypeScript 类型分析报告
══════════════════════════════════════════════════
📊 分析统计
📈 验证结果
💡 改进建议
📋 详细报告: ./type-reports/report-2024-01-15.html
```

---

**让你的 TypeScript 项目保持最佳状态！** 🚀

如果遇到问题或有改进建议，欢迎提 Issue。