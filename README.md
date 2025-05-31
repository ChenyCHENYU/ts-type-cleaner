# TypeScript Type Cleaner

一个用来分析和清理 TypeScript 项目中类型定义的工具。帮你找出项目里那些没用的类型
定义。

## 安装

```bash
npm install -g ts-type-cleaner
```

或者直接使用：

```bash
npx ts-type-cleaner
```

## 能干什么

- **分析类型使用情况**：扫描你的项目，告诉你有多少类型定义，多少在用，多少没用
- **验证类型正确性**：检查 TypeScript 编译错误和代码质量问题
- **生成清理报告**：给你一个详细的报告，告诉你该删除哪些类型

## 基本用法

### 1. 快速分析项目

```bash
# 分析当前目录
npx ts-type-cleaner analyze

# 分析指定目录
npx ts-type-cleaner analyze --root ./src
```

输出示例：

```
📊 类型系统分析报告
==================================================

📈 统计概览:
  📁 源文件数量: 45
  🎯 类型定义: 120
  ❌ 未使用类型: 12
  ⚠️ 重复定义: 3
  💯 健康评分: 85/100

💡 改进建议:
  💡 发现 12 个未使用的类型定义，建议清理
  ⚠️ 发现 3 个重复的类型定义，建议合并
```

### 2. 检查类型错误

```bash
# 基本检查
npx ts-type-cleaner validate

# 美化显示（推荐）
npx ts-type-cleaner validate --format
```

美化显示效果：

```
🔍 详细错误信息:

1. TYPESCRIPT
   📁 src/components/UserCard.tsx:15
   💬 Property 'username' does not exist on type 'User'
   🏷️ TS2339
   💡 建议: 检查属性名是否存在

2. TYPESCRIPT
   📁 src/utils/helper.ts:8
   💬 Cannot find name 'debounce'
   🏷️ TS2304
   💡 建议: 检查导入是否正确
```

### 3. 完整检查

```bash
# 完整检查（分析 + 验证）
npx ts-type-cleaner check

# 带美化显示
npx ts-type-cleaner check --format
```

## 命令详解

### `analyze` - 分析类型使用情况

分析你的项目，统计类型定义的使用情况。

```bash
npx ts-type-cleaner analyze [选项]
```

**选项：**

- `--root <路径>`：指定项目根目录（默认当前目录）
- `--output <路径>`：报告输出目录（默认 `./type-reports`）
- `--threshold <数字>`：健康分数阈值（默认 70，低于此分数会退出失败）
- `--verbose`：显示详细信息

**健康分数计算：**

- 满分 100 分
- 未使用的类型每个扣 0.6 分
- 重复定义的类型每个扣 0.8 分

### `validate` - 验证类型正确性

检查 TypeScript 编译错误和代码质量问题。

```bash
npx ts-type-cleaner validate [选项]
```

**选项：**

- `--root <路径>`：指定项目根目录
- `--format`：美化错误显示（强烈推荐）
- `--strict`：严格模式检查
- `--verbose`：显示详细信息

### `check` - 完整检查

运行分析和验证，生成完整报告。

```bash
npx ts-type-cleaner check [选项]
```

**选项：**

- `--root <路径>`：指定项目根目录
- `--output <路径>`：报告输出目录
- `--format`：美化错误显示
- `--verbose`：显示详细信息

## 实际使用场景

### 场景 1：项目重构前的清理

```bash
# 1. 先看看项目整体情况
npx ts-type-cleaner analyze

# 2. 检查有没有类型错误
npx ts-type-cleaner validate --format

# 3. 生成完整报告
npx ts-type-cleaner check --output ./cleanup-report
```

### 场景 2：CI/CD 中的类型质量检查

```bash
# 在 CI 中运行，如果健康分数低于 80 就失败
npx ts-type-cleaner analyze --threshold 80

# 检查是否有类型错误
npx ts-type-cleaner validate
```

### 场景 3：代码审查时生成报告

```bash
# 生成详细报告供团队审查
npx ts-type-cleaner check --format --output ./code-review-reports
```

## 生成的报告

运行 `check` 命令后，会在输出目录生成一个 Markdown 报告，包含：

1. **问题统计**：未使用类型、重复定义、类型错误的数量
2. **未使用类型清单**：列出所有未使用的类型，包括文件位置和行号
3. **重复类型清单**：列出重复定义的类型
4. **类型错误详情**：详细的错误信息和位置
5. **清理建议**：具体的修复建议

## 常见问题

### Q: 为什么有些类型被标记为"未使用"但我觉得有用？

A: 工具只能检测到明确的引用关系。以下情况可能被误标记：

- 只在注释中使用的类型
- 动态导入的类型
- 作为其他库的接口约束使用

### Q: 健康分数怎么提高？

A:

1. 删除真正未使用的类型定义
2. 合并重复的类型定义
3. 修复 TypeScript 编译错误

### Q: 可以忽略某些文件吗？

A: 目前工具会自动忽略 `node_modules`、`dist`、`.git` 等目录。其他忽略规则需要在
源码中配置。

### Q: 报告文件在哪里？

A: 默认在 `./type-reports` 目录下，可以用 `--output` 参数指定其他位置。

## 项目配置

你的项目需要有 `tsconfig.json` 文件，工具会根据这个配置进行类型检查。

推荐的项目结构：

```
your-project/
├── src/           # 源代码目录
├── tsconfig.json  # TypeScript 配置
└── package.json   # 项目配置
```

## 最佳实践

1. **定期检查**：建议每周运行一次完整检查
2. **CI 集成**：在持续集成中添加类型质量检查
3. **设置阈值**：根据项目情况设置合适的健康分数阈值
4. **团队共享**：将生成的报告分享给团队成员

## 技术要求

- Node.js 16+
- TypeScript 项目
- 有效的 `tsconfig.json` 配置

## 常用命令组合

```bash
# 日常开发检查
npx ts-type-cleaner validate --format

# 深度清理前的分析
npx ts-type-cleaner check --format --verbose

# CI/CD 质量门禁
npx ts-type-cleaner analyze --threshold 85 && npx ts-type-cleaner validate
```

这个工具就是帮你保持 TypeScript 项目的类型定义干净整洁，仅此而已。
