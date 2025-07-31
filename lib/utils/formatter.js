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
    
    output.push(this.c('blue', '🛠️ TypeScript 类型分析报告'), '')
    output.push(this.c('blue', '═'.repeat(50)), '')

    // 统计信息
    const stats = result.statistics
    output.push(this.c('cyan', '📊 分析统计'), '')
    
    const statsTable = [
      ['📁 源文件', stats.sourceFiles],
      ['🎯 类型定义', stats.typeDefinitions],
      ['❌ 未使用类型', this.colorizeCount(stats.unusedTypes, 'red')],
      ['⚠️ 重复定义', this.colorizeCount(stats.duplicateDefinitions, 'yellow')],
      ['🚨 类型错误', this.colorizeCount(stats.totalErrors, 'red')],
      ['💯 健康评分', this.colorizeScore(result.scores.healthScore)],
    ]

    statsTable.forEach(([label, value]) => {
      output.push(`   ${label.padEnd(15)} ${value}`)
    })

    // 错误详情
    if (result.details.errors.length > 0) {
      output.push('', this.c('red', '🚨 错误详情'), '')
      result.details.errors.slice(0, this.options.maxErrors).forEach((error, index) => {
        output.push(`   ${this.c('red', `${index + 1}.`)} ${this.c('gray', relative(process.cwd(), error.file))}:${this.c('yellow', error.line)}`)
        output.push(`      ${this.c('red', '▶')} ${error.message}`)
        if (index < Math.min(result.details.errors.length - 1, this.options.maxErrors - 1)) output.push('')
      })
    }

    // 建议
    if (result.suggestions.length > 0) {
      output.push('', this.c('green', '💡 改进建议'), '')
      result.suggestions.forEach((suggestion, index) => {
        output.push(`   ${this.c('green', `${index + 1}.`)} ${suggestion}`)
      })
    }

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
        return result.summary
    }
  }

  // 工具方法
  c(color, text) {
    return this.options.colorize ? chalk[color](text) : text
  }

  colorizeCount(count, color = 'white') {
    if (count === 0) return this.c('green', '0')
    return this.c(color, count.toString())
  }

  colorizeScore(score) {
    if (score >= 90) return this.c('green', `${score}/100`)
    if (score >= 70) return this.c('yellow', `${score}/100`)
    return this.c('red', `${score}/100`)
  }
}

export function formatResult(result, options = {}) {
  const formatter = new Formatter(options)
  return formatter.formatAnalysisResult(result)
}