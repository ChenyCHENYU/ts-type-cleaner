import chalk from 'chalk'
import { readFileSync } from 'fs'
import { relative } from 'path'

export class Formatter {
  constructor(options = {}) {
    this.options = {
      colorize: options.colorize !== false,
      showContext: options.showContext !== false,
      maxErrors: options.maxErrors || 10,
      compact: options.compact || false,
      ...options,
    }
  }

  formatAnalysisResult(result) {
    const output = []
    const stats = result.statistics
    
    // 标题
    output.push('')
    output.push(this.c('cyan', '╭─────────────────────────────────────────────────╮'))
    output.push(this.c('cyan', '│') + this.center('🛠️  TypeScript 类型分析报告', 47) + this.c('cyan', '│'))
    output.push(this.c('cyan', '╰─────────────────────────────────────────────────╯'))
    output.push('')

    // 核心指标卡片
    output.push(this.c('blue', '📊 核心指标'))
    output.push(this.c('gray', '─'.repeat(50)))
    
    const scoreColor = this.getScoreColor(result.scores.overallScore)
    const scoreBar = this.createProgressBar(result.scores.overallScore, 100)
    
    output.push('')
    output.push(`   ${this.c('white', '综合评分')}  ${this.c(scoreColor, result.scores.overallScore.toString().padStart(3))}${this.c('gray', '/100')}  ${scoreBar}`)
    output.push('')

    // 详细统计
    const metrics = [
      ['📁 源文件', stats.sourceFiles.toString(), this.getCountColor(stats.sourceFiles, 0)],
      ['🎯 类型定义', stats.typeDefinitions.toString(), this.getCountColor(stats.typeDefinitions, 0)],
      ['🔗 使用引用', stats.usageReferences.toString(), this.getCountColor(stats.usageReferences, 0)],
      ['', '', ''], // 分隔线
      ['🗑️ 未使用类型', stats.unusedTypes.toString(), this.getCountColor(stats.unusedTypes, 0, true)],
      ['⚠️ 重复定义', stats.duplicateDefinitions.toString(), this.getCountColor(stats.duplicateDefinitions, 0, true)],
      ['🚨 类型错误', stats.totalErrors.toString(), this.getCountColor(stats.totalErrors, 0, true)],
      ['💛 警告', stats.totalWarnings.toString(), this.getCountColor(stats.totalWarnings, 0, true)],
    ]

    metrics.forEach(([label, value, color]) => {
      if (label === '') {
        output.push(`   ${this.c('gray', '┄'.repeat(40))}`)
      } else {
        const paddedLabel = label.padEnd(12)
        const paddedValue = value.padStart(6)
        output.push(`   ${paddedLabel} ${this.c(color, paddedValue)}`)
      }
    })

    // 分数详情
    if (result.scores.healthScore !== result.scores.validationScore) {
      output.push('')
      output.push(this.c('blue', '📈 分数详情'))
      output.push(this.c('gray', '─'.repeat(50)))
      output.push(`   类型健康度    ${this.formatScore(result.scores.healthScore)}`)
      output.push(`   验证准确性    ${this.formatScore(result.scores.validationScore)}`)
    }

    // 问题详情
    if (result.details.errors.length > 0) {
      output.push('')
      output.push(this.c('red', '🚨 类型错误'))
      output.push(this.c('gray', '─'.repeat(50)))
      
      result.details.errors.slice(0, this.options.maxErrors).forEach((error, index) => {
        const fileInfo = this.c('gray', `${relative(process.cwd(), error.file)}:${error.line}`)
        output.push(`   ${this.c('red', `${(index + 1).toString().padStart(2)}.`)} ${fileInfo}`)
        output.push(`      ${this.c('red', '▶')} ${error.message}`)
        if (error.code) {
          output.push(`      ${this.c('gray', `[${error.code}]`)}`)
        }
        output.push('')
      })

      if (result.details.errors.length > this.options.maxErrors) {
        const remaining = result.details.errors.length - this.options.maxErrors
        output.push(`   ${this.c('gray', `... 还有 ${remaining} 个错误（查看完整报告）`)}`)
        output.push('')
      }
    }

    // 未使用类型
    if (result.details.unusedTypes.length > 0) {
      output.push('')
      output.push(this.c('yellow', '🗑️ 未使用类型'))
      output.push(this.c('gray', '─'.repeat(50)))
      
      const unusedToShow = Math.min(5, result.details.unusedTypes.length)
      result.details.unusedTypes.slice(0, unusedToShow).forEach((typeName, index) => {
        const typeInfo = result.details.typeDefinitions[typeName]
        if (typeInfo) {
          const fileInfo = this.c('gray', `${relative(process.cwd(), typeInfo.file)}:${typeInfo.line}`)
          output.push(`   ${this.c('yellow', `${(index + 1).toString().padStart(2)}.`)} ${this.c('white', typeName)} ${fileInfo}`)
        }
      })

      if (result.details.unusedTypes.length > unusedToShow) {
        const remaining = result.details.unusedTypes.length - unusedToShow
        output.push(`   ${this.c('gray', `... 还有 ${remaining} 个未使用类型`)}`)
      }
      output.push('')
    }

    // 改进建议
    if (result.suggestions.length > 0) {
      output.push('')
      output.push(this.c('green', '💡 改进建议'))
      output.push(this.c('gray', '─'.repeat(50)))
      result.suggestions.slice(0, 3).forEach((suggestion, index) => {
        output.push(`   ${this.c('green', `${index + 1}.`)} ${suggestion}`)
      })
      output.push('')
    }

    // 底部状态
    const status = this.getOverallStatus(result.scores.overallScore, stats.totalErrors)
    output.push(this.c('cyan', '╭─────────────────────────────────────────────────╮'))
    output.push(this.c('cyan', '│') + this.center(status.text, 47) + this.c('cyan', '│'))
    output.push(this.c('cyan', '╰─────────────────────────────────────────────────╯'))
    
    return output.join('\n')
  }

  formatQuickResult(result, format = 'text') {
    switch (format) {
      case 'json':
        return JSON.stringify({
          passed: result.passed,
          score: result.score,
          errors: result.errors,
          warnings: result.warnings,
          summary: result.summary
        }, null, 2)
      
      case 'junit':
        return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="TypeScript Type Check" tests="1" failures="${result.passed ? 0 : 1}">
    <testcase name="Type Validation" ${result.passed ? '/>' : `><failure message="${result.summary}"/></testcase>`}
  </testsuite>
</testsuites>`
      
      default:
        const icon = result.passed ? '✅' : '❌'
        const color = result.passed ? 'green' : 'red'
        return `${icon} ${this.c(color, result.summary)}`
    }
  }

  // 工具方法
  c(color, text) {
    return this.options.colorize ? chalk[color](text) : text
  }

  center(text, width) {
    const cleanText = text.replace(/\u001b\[[0-9;]*m/g, '') // 移除ANSI颜色代码
    const padding = Math.max(0, width - cleanText.length)
    const leftPad = Math.floor(padding / 2)
    const rightPad = padding - leftPad
    return ' '.repeat(leftPad) + text + ' '.repeat(rightPad)
  }

  createProgressBar(value, max, width = 20) {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100))
    const filled = Math.round((percentage / 100) * width)
    const empty = width - filled
    
    const color = this.getScoreColor(percentage)
    const bar = this.c(color, '█'.repeat(filled)) + this.c('gray', '░'.repeat(empty))
    
    return `[${bar}] ${percentage.toFixed(0)}%`
  }

  getScoreColor(score) {
    if (score >= 90) return 'green'
    if (score >= 75) return 'yellow'
    if (score >= 60) return 'orange'
    return 'red'
  }

  getCountColor(count, threshold = 0, isError = false) {
    if (isError) {
      return count === 0 ? 'green' : count <= 5 ? 'yellow' : 'red'
    }
    return count > threshold ? 'green' : 'gray'
  }

  formatScore(score) {
    const color = this.getScoreColor(score)
    const bar = this.createProgressBar(score, 100, 15)
    return `${this.c(color, score.toString().padStart(3))}${this.c('gray', '/100')} ${bar}`
  }

  getOverallStatus(score, errors) {
    if (errors > 0) {
      return { text: '❌ 发现类型错误，需要修复', color: 'red' }
    }
    
    if (score >= 95) {
      return { text: '🎉 代码质量优秀！', color: 'green' }
    } else if (score >= 80) {
      return { text: '✅ 类型系统健康', color: 'green' }
    } else if (score >= 60) {
      return { text: '⚠️ 有改进空间', color: 'yellow' }
    } else {
      return { text: '🔧 需要重点优化', color: 'red' }
    }
  }
}

export function formatResult(result, options = {}) {
  const formatter = new Formatter(options)
  return formatter.formatAnalysisResult(result)
}