# 🛠️ TypeScript Type Cleaner

一个高效的 TypeScript 项目类型分析和清理工具。自动发现未使用的类型定义、重复定义和类型错误，帮你保持代码整洁。

## ⚡ 快速开始

```bash
# 全局安装
npm install -g ts-type-cleaner

# 或者直接使用
npx ts-type-cleaner analyze
```

## ✨ 核心功能

- **🔍 智能分析**：深度扫描 TypeScript/Vue 项目，精确识别类型使用情况
- **🧹 自动清理**：找出未使用的类型定义和重复声明
- **🔧 类型验证**：检查 TypeScript 编译错误和代码质量问题
- **📊 精美报告**：生成详细的 Markdown 报告，美观的终端输出
- **⚡ CI/CD 友好**：支持快速检查模式，适合持续集成

## 🚀 基本用法

### 快速分析

```bash
# 分析当前项目
ts-type-cleaner analyze

# 指定目录和阈值
ts-type-cleaner analyze --root ./src --threshold 85
```

**精美的终端输出：**
```
┌─────────────────────────────────────────────┐
│  🛠️  TypeScript 类型分析报告                │
└─────────────────────────────────────────────┘

📊 核心指标
─────────────────────────────────────────────

   综合评分  100/100  [███████████████] 

   📁 源文件   255    🎯 类型定义   53  
   🔗 使用引用 1157   🗑️ 未使用     0  
                      ⚠️ 重复定义   0  

💡 改进建议
─────────────────────────────────────────────
   1. 🎉 类型系统状态良好！

┌─────────────────────────────────────────────┐
│              🎉 代码质量优秀！              │
└─────────────────────────────────────────────┘

📋 详细报告: ./type-reports/type-analysis-2025-07-31.md
```

### 完整检查

```bash
# 分析 + 验证 + 生成报告
ts-type-cleaner check --threshold 80

# 自定义输出目录
ts-type-cleaner analyze --output ./reports
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
| `-v, --verbose` | 详细信息 | `false` |

### `check` - 完整检查

运行完整的分析和验证，生成综合报告。

```bash
ts-type-cleaner check [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-t, --threshold <num>` | 健康分数阈值 | `70` |

## ⚙️ 编程式使用

```javascript
import { TypeAnalyzer, analyzeProject, quickCheck } from 'ts-type-cleaner'

// 方式1: 使用类
const analyzer = new TypeAnalyzer({
  rootDir: process.cwd(),
  verbose: true,
  include: ['src/**/*.{ts,tsx,vue}'],
  exclude: ['node_modules', 'dist']
})

const result = await analyzer.analyze()
console.log(`发现 ${result.statistics.unusedTypes} 个未使用类型`)

// 方式2: 使用便捷函数
const result = await analyzeProject({
  rootDir: './src',
  threshold: 80
})

// 方式3: 快速检查（适合CI/CD）
const checkResult = await quickCheck({ threshold: 70 })
if (!checkResult.passed) {
  console.error(checkResult.summary)
  process.exit(1)
}
```

## 📊 健康评分算法

项目健康分数基于以下因素计算：

### 健康分数 (Health Score)
- **基础分：** 100 分
- **未使用类型扣分：** 每个未使用类型按比例扣分（最多50分）
- **重复定义扣分：** 每个重复定义按比例扣分（最多40分）

### 验证分数 (Validation Score)
- **基础分：** 100 分
- **关键错误：** 每个扣15分（类型不匹配、属性缺失等）
- **普通错误：** 每个扣8分
- **警告：** 每个扣1分（最多扣20分）

### 综合评分
**最终分数 = (健康分数 + 验证分数) / 2**

**评级标准：**
- 90+ 分：🎉 优秀
- 80-89 分：✅ 良好
- 60-79 分：⚠️ 需改进
- 60- 分：❌ 需要修复

## 🎯 实际应用场景

### 1. 项目重构前的准备

```bash
# 全面体检，生成详细报告
ts-type-cleaner analyze --verbose --output ./refactor-reports

# 查看报告，制定清理计划
```

### 2. 持续集成质量门禁

```bash
# GitHub Actions 示例
- name: TypeScript Type Check
  run: |
    npx ts-type-cleaner check --threshold 80
    if [ $? -ne 0 ]; then 
      echo "❌ 类型检查未通过"
      exit 1
    fi
```

### 3. 定期维护清理

```bash
# 每周运行的清理脚本
#!/bin/bash
echo "🧹 开始类型清理..."
npx ts-type-cleaner analyze --threshold 85
echo "✅ 清理完成"
```

## 📋 生成的报告

### Markdown 报告内容
- 📈 项目健康概览与评分详情
- 📊 核心指标表格展示
- 🚨 类型错误详细列表
- 🗑️ 未使用类型清单
- 💡 智能改进建议

### JSON 输出格式
```javascript
{
  "timestamp": "2025-07-31T...",
  "statistics": {
    "sourceFiles": 255,
    "typeDefinitions": 53,
    "usageReferences": 1157,
    "unusedTypes": 0,
    "duplicateDefinitions": 0,
    "totalErrors": 0,
    "totalWarnings": 0
  },
  "scores": {
    "healthScore": 100,
    "validationScore": 100,
    "overallScore": 100
  },
  "details": {
    "unusedTypes": [],
    "duplicates": [],
    "errors": [],
    "warnings": [],
    "typeDefinitions": {},
    "typeUsages": {}
  },
  "suggestions": ["🎉 类型系统状态良好！"]
}
```

## 🤔 常见问题

### Q: 为什么某些我确实在用的类型被标记为"未使用"？

**A:** 可能的原因：
- 只在类型断言中使用：`as UserType`
- 仅在注释中引用
- 通过动态导入使用
- 作为其他库的接口约束

**解决方案：**
检查类型是否真的被使用，或者在配置中添加忽略模式。

### Q: 支持 Vue 项目吗？

**A:** 完全支持！工具能够：
- 解析 `.vue` 文件中的 `<script lang="ts">` 块
- 智能忽略 Vue 组件内部类型（Props、Emits 等）
- 分析 Vue 3 Composition API 类型使用

### Q: 如何提高健康分数？

**A:** 按优先级排序：
1. **修复类型错误**（影响最大）
2. **删除真正未使用的类型**
3. **合并重复的类型定义**
4. **优化类型结构**

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
- **TypeScript:** 支持 4.0+ 项目
- **配置文件:** 项目根目录需要 `tsconfig.json`（可选）

## 🏆 最佳实践

### 1. 定期检查
```bash
# 建议频率
# 开发阶段：每天运行 check
# 发布前：完整 analyze
# 重构时：详细 analyze --verbose
```

### 2. 团队规范
- 设置统一的健康分数阈值（建议80+）
- 将检查集成到 pre-commit hooks
- 定期分享报告进行代码审查

### 3. 渐进式改进
- 先修复明显的错误
- 逐步提高阈值标准
- 记录改进过程和效果

## 🎨 输出格式示例

### 成功示例
```
┌─────────────────────────────────────────────┐
│  🛠️  TypeScript 类型分析报告                │
└─────────────────────────────────────────────┘

📊 核心指标
─────────────────────────────────────────────
   综合评分  87/100  [█████████████░░] 

💡 改进建议
─────────────────────────────────────────────
   1. 💡 清理 3 个未使用的类型定义
   2. 🔴 修复 1 个关键类型错误

┌─────────────────────────────────────────────┐
│              ✅  类型系统健康               │
└─────────────────────────────────────────────┘
```

### 错误示例
```
🚨 类型错误
─────────────────────────────────────────────
   1. src/components/UserCard.tsx:15
      ▶ Property 'username' does not exist on type 'User'
      [TS2339]

┌─────────────────────────────────────────────┐
│          ❌ 发现类型错误，需要修复          │
└─────────────────────────────────────────────┘
```

---

**让你的 TypeScript 项目保持最佳状态！** 🚀

如果遇到问题或有改进建议，欢迎提 [Issue](https://github.com/ChenyCHENYU/ts-type-cleaner/issues)。