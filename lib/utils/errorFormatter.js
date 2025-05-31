// lib/utils/errorFormatter.js
import chalk from 'chalk'
import { readFileSync } from 'fs'
import { relative } from 'path'

export class ErrorFormatter {
  constructor(options = {}) {
    this.options = {
      showContext: options.showContext !== false, // 默认显示上下文
      contextLines: options.contextLines || 3, // 上下文行数
      showSuggestions: options.showSuggestions !== false,
      colorize: options.colorize !== false,
      ...options,
    }
  }

  /**
   * 格式化单个错误
   */
  formatError(error, index = 0) {
    const lines = []

    // 错误标题
    const errorNumber = `${index + 1}.`
    const errorTitle = this.options.colorize
      ? chalk.red.bold(`${errorNumber} ${error.type?.toUpperCase() || 'ERROR'}`)
      : `${errorNumber} ${error.type?.toUpperCase() || 'ERROR'}`

    lines.push(errorTitle)

    // 文件信息
    const relativePath = relative(process.cwd(), error.file)
    const location = error.line
      ? `:${error.line}` + (error.column ? `:${error.column}` : '')
      : ''
    const fileInfo = this.options.colorize
      ? chalk.cyan(`   📁 ${relativePath}${location}`)
      : `   📁 ${relativePath}${location}`

    lines.push(fileInfo)

    // 错误消息
    const message = this.options.colorize
      ? chalk.yellow(`   💬 ${error.message}`)
      : `   💬 ${error.message}`

    lines.push(message)

    // 错误代码
    if (error.code) {
      const code = this.options.colorize
        ? chalk.gray(`   🏷️  ${error.code}`)
        : `   🏷️  ${error.code}`
      lines.push(code)
    }

    // 显示代码上下文
    if (this.options.showContext && error.file && error.line) {
      const context = this.getCodeContext(error.file, error.line)
      if (context) {
        lines.push('')
        lines.push(
          this.options.colorize
            ? chalk.gray('   📝 代码上下文:')
            : '   📝 代码上下文:'
        )
        lines.push(...context)
      }
    }

    // 智能建议
    if (this.options.showSuggestions) {
      const suggestions = this.generateSuggestions(error)
      if (suggestions.length > 0) {
        lines.push('')
        lines.push(
          this.options.colorize
            ? chalk.green('   💡 修复建议:')
            : '   💡 修复建议:'
        )
        suggestions.forEach(suggestion => {
          const text = this.options.colorize
            ? chalk.green(`      • ${suggestion}`)
            : `      • ${suggestion}`
          lines.push(text)
        })
      }
    }

    return lines.join('\n')
  }

  /**
   * 批量格式化错误
   */
  formatErrors(errors, title = '错误列表') {
    if (!errors || errors.length === 0) {
      return this.options.colorize
        ? chalk.green('✨ 没有发现错误！')
        : '✨ 没有发现错误！'
    }

    const lines = []

    // 标题
    const titleText = this.options.colorize
      ? chalk.red.bold(`\n🚨 ${title} (${errors.length} 个)`)
      : `\n🚨 ${title} (${errors.length} 个)`

    lines.push(titleText)
    lines.push('='.repeat(60))

    // 错误详情
    errors.forEach((error, index) => {
      lines.push('')
      lines.push(this.formatError(error, index))
    })

    // 统计信息
    lines.push('')
    lines.push(this.generateErrorSummary(errors))

    return lines.join('\n')
  }

  /**
   * 获取代码上下文
   */
  getCodeContext(filePath, lineNumber) {
    try {
      const content = readFileSync(filePath, 'utf8')
      const lines = content.split('\n')
      const startLine = Math.max(0, lineNumber - this.options.contextLines - 1)
      const endLine = Math.min(
        lines.length,
        lineNumber + this.options.contextLines
      )

      const contextLines = []

      for (let i = startLine; i < endLine; i++) {
        const isErrorLine = i === lineNumber - 1
        const lineNum = (i + 1).toString().padStart(4, ' ')
        const code = lines[i] || ''

        if (isErrorLine) {
          const text = this.options.colorize
            ? chalk.red(`   ${lineNum} ▶ ${code}`)
            : `   ${lineNum} ▶ ${code}`
          contextLines.push(text)
        } else {
          const text = this.options.colorize
            ? chalk.gray(`   ${lineNum}   ${code}`)
            : `   ${lineNum}   ${code}`
          contextLines.push(text)
        }
      }

      return contextLines
    } catch (error) {
      return null
    }
  }

  /**
   * 生成智能修复建议
   */
  generateSuggestions(error) {
    const suggestions = []

    // 基于错误代码的建议
    if (error.code) {
      const codeSuggestions = this.getCodeSpecificSuggestions(
        error.code,
        error.message
      )
      suggestions.push(...codeSuggestions)
    }

    // 基于错误类型的建议
    const typeSuggestions = this.getTypeSpecificSuggestions(
      error.type,
      error.message
    )
    suggestions.push(...typeSuggestions)

    // 基于错误消息的建议
    const messageSuggestions = this.getMessageBasedSuggestions(error.message)
    suggestions.push(...messageSuggestions)

    return [...new Set(suggestions)] // 去重
  }

  /**
   * TypeScript 错误代码特定建议
   */
  getCodeSpecificSuggestions(code, message) {
    const suggestions = []

    switch (code) {
      case 'TS2304':
        if (message.includes('Cannot find name')) {
          suggestions.push('检查变量/类型名是否拼写正确')
          suggestions.push('确认是否已正确导入所需的类型或变量')
          suggestions.push('检查 tsconfig.json 中的路径配置')
        }
        break

      case 'TS2322':
        suggestions.push('检查赋值的类型是否匹配')
        suggestions.push('考虑使用类型断言或类型守卫')
        suggestions.push('验证接口定义是否正确')
        break

      case 'TS2339':
        suggestions.push('检查属性名是否存在于类型定义中')
        suggestions.push('考虑使用可选属性或扩展接口')
        break

      case 'TS7053':
        suggestions.push('为对象添加索引签名')
        suggestions.push('使用 Record<string, unknown> 类型')
        break

      case 'TS2571':
        suggestions.push('检查对象字面量的属性是否与接口匹配')
        suggestions.push('移除多余的属性或添加到接口定义中')
        break
    }

    return suggestions
  }

  /**
   * 错误类型特定建议
   */
  getTypeSpecificSuggestions(type, message) {
    const suggestions = []

    switch (type) {
      case 'typescript':
        suggestions.push('运行 tsc --noEmit 获取详细错误信息')
        break

      case 'best-practice':
        if (message.includes('any')) {
          suggestions.push('使用具体的类型定义替代 any')
          suggestions.push('考虑使用 unknown 类型更安全')
        }
        break

      case 'unused-import':
        suggestions.push('移除未使用的导入语句')
        suggestions.push('使用 ESLint 自动清理未使用的导入')
        break
    }

    return suggestions
  }

  /**
   * 基于错误消息的建议
   */
  getMessageBasedSuggestions(message) {
    const suggestions = []

    if (message.includes('is not assignable to')) {
      suggestions.push('检查类型兼容性')
      suggestions.push('使用联合类型或泛型')
    }

    if (message.includes('Property') && message.includes('does not exist')) {
      suggestions.push('检查属性名拼写')
      suggestions.push('验证类型定义是否完整')
    }

    if (message.includes('Cannot find module')) {
      suggestions.push('检查模块路径是否正确')
      suggestions.push('确认依赖是否已安装')
    }

    return suggestions
  }

  /**
   * 生成错误统计摘要
   */
  generateErrorSummary(errors) {
    const summary = []

    // 按类型分组统计
    const byType = {}
    const bySeverity = {}

    errors.forEach(error => {
      // 按类型统计
      const type = error.type || 'unknown'
      byType[type] = (byType[type] || 0) + 1

      // 按严重程度统计
      const severity = error.severity || 'error'
      bySeverity[severity] = (bySeverity[severity] || 0) + 1
    })

    const summaryTitle = this.options.colorize
      ? chalk.blue.bold('📊 错误统计:')
      : '📊 错误统计:'

    summary.push(summaryTitle)

    // 类型统计
    Object.entries(byType).forEach(([type, count]) => {
      const text = this.options.colorize
        ? chalk.gray(`   ${type}: ${count} 个`)
        : `   ${type}: ${count} 个`
      summary.push(text)
    })

    // 严重程度统计
    if (Object.keys(bySeverity).length > 1) {
      summary.push('')
      Object.entries(bySeverity).forEach(([severity, count]) => {
        const color = severity === 'error' ? 'red' : 'yellow'
        const text = this.options.colorize
          ? chalk[color](`   ${severity}: ${count} 个`)
          : `   ${severity}: ${count} 个`
        summary.push(text)
      })
    }

    return summary.join('\n')
  }
}
