#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { fileURLToPath } from 'url'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { TypeAnalyzer } from '../lib/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))

const program = new Command()

program
  .name('ts-type-cleaner')
  .description('🛠️ TypeScript 类型分析和清理工具')
  .version(packageJson.version)
  .option('-r, --root <path>', '项目根目录', process.cwd())
  .option('-v, --verbose', '显示详细信息', false)
  .option('--no-color', '禁用颜色输出')

// analyze 命令
program
  .command('analyze')
  .alias('a')
  .description('📊 分析项目类型使用情况')
  .option('-o, --output <path>', '输出目录', './type-reports')
  .option('-t, --threshold <number>', '健康分数阈值', '70')
  .option('--include <patterns>', '包含文件模式', 'src/**/*.{ts,tsx,vue}')
  .option('--exclude <patterns>', '排除文件模式', 'node_modules,dist,.git')
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
      console.log(chalk.cyan(`\n📋 详细报告: ${reportPath}`))

      const threshold = parseInt(options.threshold)
      if (result.scores.healthScore < threshold) {
        console.log(chalk.red.bold(`\n❌ 健康分数 ${result.scores.healthScore} 低于阈值 ${threshold}`))
        process.exit(1)
      }
    })
  })

// check 命令
program
  .command('check')
  .alias('c')
  .description('🎯 完整检查')
  .option('-t, --threshold <number>', '健康分数阈值', '70')
  .action(async (options) => {
    await runCommand(options, async (config) => {
      const analyzer = new TypeAnalyzer(config)
      const result = await analyzer.analyze()
      
      console.log(formatTerminalOutput(result, { colorize: !program.opts().noColor }))

      const threshold = parseInt(options.threshold)
      const hasErrors = result.details.errors.length > 0
      const lowScore = result.scores.healthScore < threshold

      if (hasErrors || lowScore) {
        console.log(chalk.red.bold('\n❌ 检查未通过'))
        process.exit(1)
      } else {
        console.log(chalk.green.bold('\n🎉 检查通过！'))
      }
    })
  })

// 通用命令处理
async function runCommand(options, handler) {
  const spinner = ora('⚙️  执行中...').start()
  
  try {
    const config = {
      rootDir: program.opts().root || process.cwd(),
      outputDir: options.output || './type-reports',
      verbose: program.opts().verbose || false,
      include: parsePatterns(options.include),
      exclude: parsePatterns(options.exclude),
      ...options,
    }

    await handler(config)
    spinner.succeed('✅ 完成')
  } catch (error) {
    spinner.fail('❌ 失败')
    console.error(chalk.red('错误:'), error.message)
    if (program.opts().verbose && error.stack) {
      console.error(chalk.gray(error.stack))
    }
    process.exit(1)
  }
}

function parsePatterns(patterns) {
  if (typeof patterns === 'string') {
    return patterns.split(',').map(p => p.trim())
  }
  return Array.isArray(patterns) ? patterns : [patterns]
}

// 终端输出格式化
function formatTerminalOutput(result, options = {}) {
  const { colorize = true } = options
  const c = (color, text) => colorize ? chalk[color](text) : text
  const stats = result.statistics
  
  const output = []
  
  // 精美的标题
  output.push('')
  output.push(c('cyan', '┌─────────────────────────────────────────────┐'))
  output.push(c('cyan', '│') + c('bold', '  🛠️  TypeScript 类型分析报告').padEnd(45) + c('cyan', '│'))
  output.push(c('cyan', '└─────────────────────────────────────────────┘'))
  output.push('')

  // 核心指标 - 卡片式布局
  const scoreColor = result.scores.overallScore >= 80 ? 'green' : 
                    result.scores.overallScore >= 60 ? 'yellow' : 'red'
  const scoreBar = createProgressBar(result.scores.overallScore, 100, colorize)
  
  output.push(c('blue', '📊 核心指标'))
  output.push(c('gray', '─'.repeat(45)))
  output.push('')
  output.push(`   综合评分  ${c(scoreColor, result.scores.overallScore.toString().padStart(3))}${c('gray', '/100')}  ${scoreBar}`)
  output.push('')

  // 统计数据 - 两列布局
  const leftColumn = [
    ['📁 源文件', stats.sourceFiles, 'green'],
    ['🎯 类型定义', stats.typeDefinitions, 'green'],
    ['🔗 使用引用', stats.usageReferences, 'green'],
  ]
  
  const rightColumn = [
    ['🗑️ 未使用', stats.unusedTypes, stats.unusedTypes === 0 ? 'green' : 'yellow'],
    ['⚠️ 重复定义', stats.duplicateDefinitions, stats.duplicateDefinitions === 0 ? 'green' : 'red'],
    ['🚨 类型错误', stats.totalErrors, stats.totalErrors === 0 ? 'green' : 'red'],
  ]

  for (let i = 0; i < Math.max(leftColumn.length, rightColumn.length); i++) {
    const left = leftColumn[i] || ['', '', 'gray']
    const right = rightColumn[i] || ['', '', 'gray']
    
    const leftText = left[0] ? `${left[0]} ${c(left[2], left[1].toString().padStart(4))}` : ''
    const rightText = right[0] ? `${right[0]} ${c(right[2], right[1].toString().padStart(4))}` : ''
    
    output.push(`   ${leftText.padEnd(18)} ${rightText}`)
  }
  
  output.push('')

  // 问题摘要
  if (result.details.errors.length > 0) {
    output.push(c('red', '🚨 类型错误'))
    output.push(c('gray', '─'.repeat(45)))
    
    const errorSample = result.details.errors.slice(0, 3)
    errorSample.forEach((error, index) => {
      const fileName = error.file.split('/').pop()
      output.push(`   ${c('red', `${index + 1}.`)} ${c('white', fileName)}:${error.line}`)
      output.push(`      ${c('gray', '▶')} ${error.message.slice(0, 60)}${error.message.length > 60 ? '...' : ''}`)
    })
    
    if (result.details.errors.length > 3) {
      output.push(`   ${c('gray', `... 还有 ${result.details.errors.length - 3} 个错误`)}`)
    }
    output.push('')
  }

  // 改进建议
  if (result.suggestions.length > 0) {
    output.push(c('green', '💡 改进建议'))
    output.push(c('gray', '─'.repeat(45)))
    result.suggestions.slice(0, 2).forEach((suggestion, index) => {
      output.push(`   ${c('green', `${index + 1}.`)} ${suggestion}`)
    })
    output.push('')
  }

  // 底部状态
  const status = getOverallStatus(result.scores.overallScore, stats.totalErrors)
  output.push(c('cyan', '┌─────────────────────────────────────────────┐'))
  output.push(c('cyan', '│') + c(status.color, status.text.padStart(22).padEnd(43)) + c('cyan', '│'))
  output.push(c('cyan', '└─────────────────────────────────────────────┘'))
  
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
    return { text: '❌ 发现类型错误，需要修复', color: 'red' }
  }
  
  if (score >= 95) {
    return { text: '🎉 代码质量优秀！', color: 'green' }
  } else if (score >= 80) {
    return { text: '✅  类型系统健康', color: 'green' }
  } else if (score >= 60) {
    return { text: '⚠️  有改进空间', color: 'yellow' }
  } else {
    return { text: '🔧 需要重点优化', color: 'red' }
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

  // 标题和元信息
  content.push('# 🛠️ TypeScript 类型分析报告')
  content.push('')
  content.push(`**生成时间**: ${new Date().toLocaleString('zh-CN')}`)
  content.push(`**项目路径**: \`${process.cwd()}\``)
  content.push('')

  // 执行摘要
  content.push('## 📋 执行摘要')
  content.push('')
  const scoreEmoji = result.scores.overallScore >= 80 ? '🟢' : 
                     result.scores.overallScore >= 60 ? '🟡' : '🔴'
  content.push(`### ${scoreEmoji} 综合评分: ${result.scores.overallScore}/100`)
  content.push('')

  // 状态描述
  if (result.scores.overallScore >= 90) {
    content.push('🎉 **优秀**: 代码类型系统非常健康，继续保持！')
  } else if (result.scores.overallScore >= 75) {
    content.push('✅ **良好**: 类型系统基本健康，有小幅改进空间。')
  } else if (result.scores.overallScore >= 60) {
    content.push('⚠️ **一般**: 发现一些问题，建议进行优化。')
  } else {
    content.push('🚨 **需要改进**: 类型系统存在较多问题，需要重点关注。')
  }
  content.push('')

  // 核心指标表格
  content.push('## 📊 核心指标')
  content.push('')
  content.push('| 指标 | 数值 | 状态 |')
  content.push('|------|------|------|')
  
  const metrics = [
    ['📁 源文件', stats.sourceFiles, '✅ 正常'],
    ['🎯 类型定义', stats.typeDefinitions, stats.typeDefinitions > 0 ? '✅ 正常' : '⚠️ 无定义'],
    ['🔗 类型引用', stats.usageReferences, stats.usageReferences > 0 ? '✅ 正常' : '⚠️ 无引用'],
    ['🗑️ 未使用类型', stats.unusedTypes, stats.unusedTypes === 0 ? '🟢 优秀' : '🟡 需清理'],
    ['⚠️ 重复定义', stats.duplicateDefinitions, stats.duplicateDefinitions === 0 ? '🟢 优秀' : '🔴 需修复'],
    ['🚨 类型错误', stats.totalErrors, stats.totalErrors === 0 ? '🟢 优秀' : '🔴 需修复'],
  ]

  metrics.forEach(([metric, value, status]) => {
    content.push(`| ${metric} | **${value}** | ${status} |`)
  })
  content.push('')

  // 问题详情
  if (result.details.errors.length > 0) {
    content.push('## 🚨 类型错误详情')
    content.push('')
    
    result.details.errors.slice(0, 10).forEach((error, index) => {
      content.push(`### ${index + 1}. ${error.code || 'TypeScript Error'}`)
      content.push(`**文件**: \`${error.file}:${error.line}\``)
      content.push(`**错误**: ${error.message}`)
      content.push('')
    })
  }

  // 未使用类型
  if (result.details.unusedTypes.length > 0) {
    content.push('## 🗑️ 未使用类型')
    content.push('')
    
    result.details.unusedTypes.slice(0, 20).forEach((typeName, index) => {
      const typeInfo = result.details.typeDefinitions[typeName]
      if (typeInfo) {
        content.push(`${index + 1}. \`${typeName}\` (${typeInfo.type}) - \`${typeInfo.file}:${typeInfo.line}\``)
      }
    })
    content.push('')
  }

  // 改进建议
  if (result.suggestions.length > 0) {
    content.push('## 💡 改进建议')
    content.push('')
    result.suggestions.forEach((suggestion, index) => {
      content.push(`${index + 1}. ${suggestion}`)
    })
    content.push('')
  }

  // 生成文件
  const fileName = `type-analysis-${new Date().toISOString().slice(0, 10)}.md`
  const outputPath = join(outputDir, fileName)
  writeFileSync(outputPath, content.join('\n'))
  return outputPath
}

// 错误处理
process.on('uncaughtException', (error) => {
  console.error(chalk.red('💥 未捕获异常:'), error.message)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('💥 未处理拒绝:'), reason)
  process.exit(1)
})

program.parse()