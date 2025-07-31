#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { fileURLToPath } from 'url'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname, join, relative } from 'path'
import { TypeAnalyzer } from '../lib/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))

const program = new Command()

program
  .name('ts-type-cleaner')
  .description('🛠️  TypeScript 类型分析和清理工具')
  .version(packageJson.version)
  .option('-r, --root <path>', '项目根目录', process.cwd())
  .option('-v, --verbose', '显示详细信息', false)
  .option('--no-color', '禁用颜色输出')

// analyze 命令
program
  .command('analyze')
  .alias('a')
  .description('📊  分析项目类型使用情况')
  .option('-o, --output <path>', '输出目录', './type-reports')
  .option('-t, --threshold <number>', '健康分数阈值', '70')
  .option('--include <patterns>', '包含文件模式', 'src/**/*.{ts,tsx,vue}')
  .option('--exclude <patterns>', '排除文件模式', 'node_modules,dist,.git,build,coverage,**/*.d.ts,**/*.test.ts,**/*.spec.ts')
  .option('--json', '输出JSON格式', false)
  .action(async (options) => {
    await runCommand(options, async (config) => {
      const analyzer = new TypeAnalyzer(config)
      const result = await analyzer.analyze()
      
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(formatTerminalOutput(result, { colorize: !program.opts().noColor }))
      }

      // 生成markdown报告
      const reportPath = await generateMarkdownReport(result, config.outputDir)
      console.log(chalk.cyan(`\n📋  详细报告: ${reportPath}`))

      const threshold = parseInt(options.threshold)
      if (result.scores.healthScore < threshold) {
        console.log(chalk.red.bold(`\n❌  健康分数 ${result.scores.healthScore} 低于阈值 ${threshold}`))
        process.exit(1)
      }
    })
  })

// check 命令
program
  .command('check')
  .alias('c')
  .description('🎯  完整检查')
  .option('-t, --threshold <number>', '健康分数阈值', '70')
  .option('-o, --output <path>', '输出目录（可选）', '')
  .option('--report', '生成Markdown报告', false)
  .action(async (options) => {
    await runCommand(options, async (config) => {
      const analyzer = new TypeAnalyzer(config)
      const result = await analyzer.analyze()
      
      console.log(formatTerminalOutput(result, { colorize: !program.opts().noColor }))

      // 如果指定了生成报告
      if (options.report || options.output) {
        const outputDir = options.output || './type-reports'
        const reportPath = await generateMarkdownReport(result, outputDir)
        console.log(chalk.cyan(`\n📋  详细报告: ${reportPath}`))
      }

      const threshold = parseInt(options.threshold)
      const hasErrors = result.details.errors.length > 0
      const lowScore = result.scores.healthScore < threshold

      if (hasErrors || lowScore) {
        console.log(chalk.red.bold('\n❌  检查未通过'))
        if (hasErrors) {
          console.log(chalk.gray(`    发现 ${result.details.errors.length} 个类型错误`))
        }
        if (lowScore) {
          console.log(chalk.gray(`    健康分数 ${result.scores.healthScore} 低于阈值 ${threshold}`))
        }
        if (!options.report && !options.output) {
          console.log(chalk.gray(`\n    提示: 使用 --report 参数生成详细的错误报告`))
        }
        process.exit(1)
      } else {
        console.log(chalk.green.bold('\n🎉  检查通过！'))
      }
    })
  })

// 通用命令处理 
async function runCommand(options, handler) {
  const spinner = ora('⚙️   正在执行...').start()
  
  try {
    const config = {
      rootDir: program.opts().root || process.cwd(),
      outputDir: options.output || './type-reports',
      verbose: program.opts().verbose || false,
      include: parsePatterns(options.include || 'src/**/*.{ts,tsx,vue}'),
      exclude: parsePatterns(options.exclude || 'node_modules,dist,.git,build,coverage,**/*.d.ts,**/*.test.ts,**/*.spec.ts'),
      ...options,
    }

    // 调试信息
    if (config.verbose) {
      console.log('🔧  配置信息:')
      console.log(`    根目录: ${config.rootDir}`)
      console.log(`    包含模式: ${JSON.stringify(config.include)}`)
      console.log(`    排除模式: ${JSON.stringify(config.exclude)}`)
    }

    await handler(config)
    spinner.succeed('✅  完成')
  } catch (error) {
    spinner.fail('❌  失败')
    console.error(chalk.red('错误:'), error.message)
    if (program.opts().verbose && error.stack) {
      console.error(chalk.gray(error.stack))
    }
    process.exit(1)
  }
}
function parsePatterns(patterns) {
  // 如果是undefined或null，返回空数组
  if (!patterns) {
    return [];
  }

  // 如果已经是数组，直接返回
  if (Array.isArray(patterns)) {
    return patterns;
  }

  // 如果是字符串，按逗号分割
  if (typeof patterns === "string") {
    return patterns
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  // 其他情况，包装成数组
  return [patterns];
}

// 终端输出格式化
function formatTerminalOutput(result, options = {}) {
  const { colorize = true } = options
  const c = (color, text) => colorize ? chalk[color](text) : text
  const stats = result.statistics
  
  const output = []
  
  // 精美的标题
  output.push('')
  output.push(c('cyan', '╭─────────────────────────────────────────────────╮'))
  output.push(c('cyan', '│') + '  🛠️   TypeScript 类型分析报告'.padEnd(49) + c('cyan', '│'))
  output.push(c('cyan', '╰─────────────────────────────────────────────────╯'))
  output.push('')

  // 核心指标 - 卡片式布局
  const scoreColor = result.scores.overallScore >= 80 ? 'green' : 
                    result.scores.overallScore >= 60 ? 'yellow' : 'red'
  const scoreBar = createProgressBar(result.scores.overallScore, 100, colorize)
  
  output.push(c('blue', '📊  核心指标'))
  output.push(c('gray', '─'.repeat(50)))
  output.push('')
  output.push(`    综合评分    ${c(scoreColor, result.scores.overallScore.toString().padStart(3))}${c('gray', '/100')}    ${scoreBar}`)
  output.push('')

  // 统计数据 - 两列布局
  const leftColumn = [
    ['📁  源文件', stats.sourceFiles, 'green'],
    ['🎯  类型定义', stats.typeDefinitions, 'green'],
    ['🔗  使用引用', stats.usageReferences, 'green'],
  ]
  
  const rightColumn = [
    ['🗑️   未使用', stats.unusedTypes, stats.unusedTypes === 0 ? 'green' : 'yellow'],
    ['⚠️   重复定义', stats.duplicateDefinitions, stats.duplicateDefinitions === 0 ? 'green' : 'red'],
    ['🚨  类型错误', stats.totalErrors, stats.totalErrors === 0 ? 'green' : 'red'],
  ]

  output.push(c('blue', '📈  统计数据'))
  output.push(c('gray', '─'.repeat(50)))
  output.push('')
  
  for (let i = 0; i < Math.max(leftColumn.length, rightColumn.length); i++) {
    const left = leftColumn[i] || ['', '', 'gray']
    const right = rightColumn[i] || ['', '', 'gray']
    
    const leftText = left[0] ? `${left[0]}  ${c(left[2], left[1].toString().padStart(5))}` : ''
    const rightText = right[0] ? `${right[0]}  ${c(right[2], right[1].toString().padStart(5))}` : ''
    
    output.push(`    ${leftText.padEnd(25)} ${rightText}`)
  }
  
  output.push('')

  // 问题摘要
  if (result.details.errors.length > 0) {
    output.push(c('red', '🚨  类型错误'))
    output.push(c('gray', '─'.repeat(50)))
    output.push('')
    
    const errorSample = result.details.errors.slice(0, 3)
    errorSample.forEach((error, index) => {
      const fileName = error.file.split('/').pop()
      output.push(`    ${c('red', `${index + 1}.`)} ${c('white', fileName)}:${error.line}`)
      output.push(`       ${c('gray', '▶')}  ${error.message.slice(0, 55)}${error.message.length > 55 ? '...' : ''}`)
      output.push('')
    })
    
    if (result.details.errors.length > 3) {
      output.push(`    ${c('gray', `... 还有 ${result.details.errors.length - 3} 个错误`)}`)
      output.push('')
    }
  }

  // 改进建议
  if (result.suggestions.length > 0) {
    output.push(c('green', '💡  改进建议'))
    output.push(c('gray', '─'.repeat(50)))
    output.push('')
    result.suggestions.slice(0, 3).forEach((suggestion, index) => {
      output.push(`    ${c('green', `${index + 1}.`)} ${suggestion}`)
    })
    output.push('')
  }

  // 底部状态
  const status = getOverallStatus(result.scores.overallScore, stats.totalErrors)
  output.push(c('cyan', '╭─────────────────────────────────────────────────╮'))
  output.push(c('cyan', '│') + c(status.color, ('  ' + status.icon + '  ' + status.text).padEnd(49)) + c('cyan', '│'))
  output.push(c('cyan', '╰─────────────────────────────────────────────────╯'))
  output.push('')
  
  return output.join('\n')
}

function createProgressBar(value, max, colorize = true, width = 15) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100))
  const filled = Math.round((percentage / 100) * width)
  const empty = width - filled
  
  const color = percentage >= 80 ? 'green' : percentage >= 60 ? 'yellow' : 'red'
  const c = (color, text) => colorize ? chalk[color](text) : text
  
  const bar = c(color, '█'.repeat(filled)) + c('gray', '░'.repeat(empty))
  return `[${bar}]`
}

function getOverallStatus(score, errors) {
  if (errors > 0) {
    return { 
      text: '发现类型错误，需要修复', 
      color: 'red',
      icon: '❌'
    }
  }
  
  if (score >= 95) {
    return { 
      text: '代码质量优秀！', 
      color: 'green',
      icon: '🎉'
    }
  } else if (score >= 80) {
    return { 
      text: '类型系统健康', 
      color: 'green',
      icon: '✅'
    }
  } else if (score >= 60) {
    return { 
      text: '有改进空间', 
      color: 'yellow',
      icon: '⚠️'
    }
  } else {
    return { 
      text: '需要重点优化', 
      color: 'red',
      icon: '🔧'
    }
  }
}

// Markdown报告生成
async function generateMarkdownReport(result, outputDir) {
  if (!existsSync(outputDir)) {
    const { mkdirSync } = await import('fs')
    mkdirSync(outputDir, { recursive: true })
  }

  const content = []
  const stats = result.statistics
  const projectRoot = process.cwd()

  // 标题和元信息
  content.push('# 🛠️  TypeScript 类型分析报告')
  content.push('')
  content.push(`**生成时间**: ${new Date().toLocaleString('zh-CN')}  `)
  content.push(`**项目路径**: \`${projectRoot}\`  `)
  content.push(`**报告文件**: \`${join(outputDir, `type-analysis-${new Date().toISOString().slice(0, 10)}.md`)}\`  `)
  content.push('')

  // 执行摘要
  content.push('## 📋  执行摘要')
  content.push('')
  const scoreEmoji = result.scores.overallScore >= 80 ? '🟢' : 
                     result.scores.overallScore >= 60 ? '🟡' : '🔴'
  content.push(`### ${scoreEmoji} 综合评分: ${result.scores.overallScore}/100`)
  content.push('')

  // 评分细节
  content.push('**评分细节：**')
  content.push(`- 健康分数: ${result.scores.healthScore}/100`)
  content.push(`- 验证分数: ${result.scores.validationScore}/100`)
  content.push('')

  // 状态描述
  if (result.scores.overallScore >= 90) {
    content.push('🎉  **优秀**: 代码类型系统非常健康，继续保持！')
  } else if (result.scores.overallScore >= 75) {
    content.push('✅  **良好**: 类型系统基本健康，有小幅改进空间。')
  } else if (result.scores.overallScore >= 60) {
    content.push('⚠️  **一般**: 发现一些问题，建议进行优化。')
  } else {
    content.push('🚨  **需要改进**: 类型系统存在较多问题，需要重点关注。')
  }
  content.push('')

  // 核心指标表格
  content.push('## 📊  核心指标')
  content.push('')
  content.push('| 指标 | 数值 | 状态 |')
  content.push('|------|------|------|')
  
  const metrics = [
    ['📁  源文件', stats.sourceFiles, '✅  正常'],
    ['🎯  类型定义', stats.typeDefinitions, stats.typeDefinitions > 0 ? '✅  正常' : '⚠️  无定义'],
    ['🔗  类型引用', stats.usageReferences, stats.usageReferences > 0 ? '✅  正常' : '⚠️  无引用'],
    ['🗑️   未使用类型', stats.unusedTypes, stats.unusedTypes === 0 ? '🟢  优秀' : '🟡  需清理'],
    ['⚠️   重复定义', stats.duplicateDefinitions, stats.duplicateDefinitions === 0 ? '🟢  优秀' : '🔴  需修复'],
    ['🚨  类型错误', stats.totalErrors, stats.totalErrors === 0 ? '🟢  优秀' : '🔴  需修复'],
    ['⚠️  类型警告', stats.totalWarnings, stats.totalWarnings === 0 ? '🟢  优秀' : '🟡  需关注'],
  ]

  metrics.forEach(([metric, value, status]) => {
    content.push(`| ${metric} | **${value}** | ${status} |`)
  })
  content.push('')

  // 类型错误详情
  if (result.details.errors.length > 0) {
    content.push('## 🚨  类型错误详情')
    content.push('')
    content.push(`共发现 **${result.details.errors.length}** 个类型错误，需要立即修复。`)
    content.push('')
    
    // 按文件分组错误
    const errorsByFile = {}
    result.details.errors.forEach(error => {
      const relativePath = relative(projectRoot, error.file).replace(/\\/g, '/')
      if (!errorsByFile[relativePath]) {
        errorsByFile[relativePath] = []
      }
      errorsByFile[relativePath].push(error)
    })
    
    Object.entries(errorsByFile).forEach(([file, errors]) => {
      content.push(`### 📄 \`${file}\``)
      content.push('')
      content.push(`该文件包含 **${errors.length}** 个错误：`)
      content.push('')
      
      errors.forEach((error, index) => {
        content.push(`#### ${index + 1}. ${error.code}`)
        content.push('')
        content.push(`- **位置**: 第 ${error.line} 行`)
        content.push(`- **错误信息**: ${error.message}`)
        content.push(`- **快速定位**: \`${file}:${error.line}\``)
        content.push('')
      })
    })
  }

  // 类型警告详情
  if (result.details.warnings.length > 0) {
    content.push('## ⚠️  类型警告详情')
    content.push('')
    content.push(`共发现 **${result.details.warnings.length}** 个类型警告。`)
    content.push('')
    
    const warningsByFile = {}
    result.details.warnings.forEach(warning => {
      const relativePath = relative(projectRoot, warning.file).replace(/\\/g, '/')
      if (!warningsByFile[relativePath]) {
        warningsByFile[relativePath] = []
      }
      warningsByFile[relativePath].push(warning)
    })
    
    // 只显示前5个文件的警告
    const fileEntries = Object.entries(warningsByFile).slice(0, 5)
    fileEntries.forEach(([file, warnings]) => {
      content.push(`### 📄 \`${file}\``)
      content.push('')
      
      warnings.slice(0, 3).forEach((warning, index) => {
        content.push(`${index + 1}. **${warning.code}** (第 ${warning.line} 行)`)
        content.push(`   > ${warning.message.slice(0, 100)}${warning.message.length > 100 ? '...' : ''}`)
        content.push('')
      })
      
      if (warnings.length > 3) {
        content.push(`   _... 还有 ${warnings.length - 3} 个警告_`)
        content.push('')
      }
    })
    
    if (Object.keys(warningsByFile).length > 5) {
      content.push(`> 还有 ${Object.keys(warningsByFile).length - 5} 个文件包含警告`)
      content.push('')
    }
  }

  // 未使用类型详情
  if (result.details.unusedTypes.length > 0) {
    content.push('## 🗑️  未使用类型详情')
    content.push('')
    content.push(`发现 **${result.details.unusedTypes.length}** 个未使用的类型定义，建议清理以保持代码整洁。`)
    content.push('')
    
    // 按文件分组未使用类型
    const unusedByFile = {}
    result.details.unusedTypes.forEach(typeName => {
      const typeInfo = result.details.typeDefinitions[typeName]
      if (typeInfo) {
        const relativePath = relative(projectRoot, typeInfo.file).replace(/\\/g, '/')
        if (!unusedByFile[relativePath]) {
          unusedByFile[relativePath] = []
        }
        unusedByFile[relativePath].push({ name: typeName, ...typeInfo })
      }
    })
    
    Object.entries(unusedByFile).forEach(([file, types]) => {
      content.push(`### 📄 \`${file}\``)
      content.push('')
      content.push('| 类型名 | 类型 | 行号 | 操作建议 |')
      content.push('|--------|------|------|----------|')
      
      types.forEach(type => {
        const action = type.exported ? '考虑是否需要导出' : '可以安全删除'
        content.push(`| \`${type.name}\` | ${type.type} | ${type.line} | ${action} |`)
      })
      content.push('')
    })
  }

  // 重复定义详情
  if (result.details.duplicates && Object.keys(result.details.duplicates).length > 0) {
    content.push('## ⚠️  重复定义详情')
    content.push('')
    content.push(`发现 **${Object.keys(result.details.duplicates).length}** 个重复的类型定义，建议合并或重命名。`)
    content.push('')
    
    Object.entries(result.details.duplicates).forEach(([typeName, definitions], index) => {
      content.push(`### ${index + 1}. \`${typeName}\``)
      content.push('')
      content.push('定义位置：')
      
      // 添加第一个定义（从typeMap中）
      const mainDef = result.details.typeDefinitions[typeName]
      if (mainDef) {
        const relativePath = relative(projectRoot, mainDef.file).replace(/\\/g, '/')
        content.push(`- \`${relativePath}:${mainDef.line}\` (${mainDef.type})`)
      }
      
      // 添加其他重复定义
      definitions.forEach(def => {
        const relativePath = relative(projectRoot, def.file).replace(/\\/g, '/')
        content.push(`- \`${relativePath}:${def.line}\` (${def.type})`)
      })
      content.push('')
    })
  }

  // 改进建议
  content.push('## 💡  改进建议')
  content.push('')
  
  if (result.suggestions.length > 0) {
    content.push('### 优先处理事项')
    content.push('')
    result.suggestions.forEach((suggestion, index) => {
      content.push(`${index + 1}. ${suggestion}`)
    })
    content.push('')
  }
  
  // 添加快速修复指南
  content.push('### 快速修复指南')
  content.push('')
  content.push('1. **修复类型错误**: 打开错误详情中列出的文件，根据行号定位并修复错误')
  content.push('2. **清理未使用类型**: 删除标记为"可以安全删除"的类型定义')
  content.push('3. **处理重复定义**: 将重复的类型定义合并到一个文件中，或使用不同的名称')
  content.push('4. **运行检查**: 修复后运行 `npx ts-type-cleaner check` 验证修复效果')
  content.push('')

  // VSCode 集成提示
  content.push('### 在 VSCode 中快速定位')
  content.push('')
  content.push('1. 使用 `Ctrl/Cmd + P` 打开快速打开面板')
  content.push('2. 粘贴文件路径和行号（如 `src/types/index.ts:10`）')
  content.push('3. 按回车直接跳转到对应位置')
  content.push('')

  // 添加页脚
  content.push('---')
  content.push('')
  content.push('_使用 [ts-type-cleaner](https://github.com/cheny-cheny/ts-type-cleaner) 生成_')

  // 生成文件
  const fileName = `type-analysis-${new Date().toISOString().slice(0, 10)}.md`
  const outputPath = join(outputDir, fileName)
  writeFileSync(outputPath, content.join('\n'))
  return outputPath
}

// 错误处理
process.on('uncaughtException', (error) => {
  console.error(chalk.red('💥  未捕获异常:'), error.message)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('💥  未处理拒绝:'), reason)
  process.exit(1)
})

program.parse()