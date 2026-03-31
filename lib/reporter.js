import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, relative } from 'path'
import chalk from 'chalk'

export class ReportGenerator {
  constructor(rootDir) {
    this.rootDir = rootDir
  }

  // 生成精美的控制台输出
  generateConsoleOutput(report) {
    const { statistics: stats, healthScore, issues } = report
    
    console.log('\n' + '═'.repeat(60))
    console.log(chalk.cyan.bold('🛠️  TypeScript 类型分析报告'))
    console.log('═'.repeat(60))
    
    // 健康度评分
    this.printHealthScore(healthScore)
    
    // 统计信息
    this.printStatistics(stats)
    
    // 问题详情
    if (issues.errors.length > 0) {
      this.printTypeErrors(issues.errors)
    }
    
    if (Object.keys(issues.duplicates).length > 0) {
      this.printDuplicateTypes(issues.duplicates)
    }
    
    if (issues.unused.length > 0) {
      this.printUnusedTypes(issues.unused)
    }
    
    // 改进建议
    this.printRecommendations(report.recommendations)
    
    console.log('═'.repeat(60) + '\n')
  }

  printHealthScore(score) {
    console.log('\n📊 健康度评分')
    console.log('─'.repeat(30))
    
    const color = score >= 80 ? 'green' : score >= 60 ? 'yellow' : 'red'
    const emoji = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🔴'
    const status = score >= 80 ? '优秀' : score >= 60 ? '良好' : '需改进'
    
    console.log(`${emoji} 综合评分: ${chalk[color].bold(score)}/100 (${status})`)
    console.log(this.createProgressBar(score, 100))
  }

  printStatistics(stats) {
    console.log('\n📈 统计信息')
    console.log('─'.repeat(30))
    
    const data = [
      ['📁 源文件', stats.totalFiles, 'cyan'],
      ['🎯 类型定义', stats.totalTypes, 'cyan'],
      ['🔗 类型引用', stats.totalUsages, 'cyan'],
      ['🚨 类型错误', stats.totalErrors, stats.totalErrors > 0 ? 'red' : 'green'],
      ['⚠️  重复定义', stats.duplicateTypes, stats.duplicateTypes > 0 ? 'yellow' : 'green'],
      ['🗑️  未使用类型', stats.unusedTypes, stats.unusedTypes > 0 ? 'yellow' : 'green']
    ]
    
    // 两列布局
    for (let i = 0; i < data.length; i += 2) {
      const left = data[i]
      const right = data[i + 1]
      
      const leftText = `${left[0]} ${chalk[left[2]](left[1].toString().padStart(3))}`
      const rightText = right ? `${right[0]} ${chalk[right[2]](right[1].toString().padStart(3))}` : ''
      
      console.log(`${leftText.padEnd(25)} ${rightText}`)
    }
  }

  printTypeErrors(errors) {
    console.log(`\n🚨 类型错误 (${errors.length})`)
    console.log('─'.repeat(50))
    
    // 按文件分组
    const errorsByFile = this.groupErrorsByFile(errors)
    
    Object.entries(errorsByFile).slice(0, 5).forEach(([file, fileErrors]) => {
      console.log(`\n📄 ${chalk.blue(this.relativePath(file))}`)
      
      fileErrors.slice(0, 3).forEach((error, index) => {
        console.log(`  ${chalk.red(`${index + 1}.`)} 第 ${chalk.yellow(error.line)} 行`)
        console.log(`     ${chalk.gray('▶')} ${error.message.slice(0, 80)}${error.message.length > 80 ? '...' : ''}`)
      })
      
      if (fileErrors.length > 3) {
        console.log(`     ${chalk.gray(`... 还有 ${fileErrors.length - 3} 个错误`)}`)
      }
    })
    
    if (Object.keys(errorsByFile).length > 5) {
      console.log(`\n${chalk.gray(`... 还有 ${Object.keys(errorsByFile).length - 5} 个文件包含错误`)}`)
    }
  }

  printDuplicateTypes(duplicates) {
    const count = Object.keys(duplicates).length
    console.log(`\n⚠️  重复类型定义 (${count})`)
    console.log('─'.repeat(50))
    
    Object.entries(duplicates).slice(0, 3).forEach(([typeName, definitions]) => {
      console.log(`\n🔄 ${chalk.yellow.bold(typeName)}`)
      definitions.forEach((def, index) => {
        const file = this.relativePath(def.file)
        console.log(`  ${index + 1}. ${chalk.blue(file)}:${chalk.yellow(def.line)} (${def.kind})`)
      })
    })
    
    if (count > 3) {
      console.log(`\n${chalk.gray(`... 还有 ${count - 3} 个重复类型`)}`)
    }
  }

  printUnusedTypes(unused) {
    console.log(`\n🗑️  未使用类型 (${unused.length})`)
    console.log('─'.repeat(50))
    
    const sample = unused.slice(0, 8)
    const columns = 2
    const rows = Math.ceil(sample.length / columns)
    
    for (let i = 0; i < rows; i++) {
      const left = sample[i]
      const right = sample[i + rows]
      
      const leftText = left ? `• ${chalk.yellow(left.name)}` : ''
      const rightText = right ? `• ${chalk.yellow(right.name)}` : ''
      
      console.log(`${leftText.padEnd(25)} ${rightText}`)
    }
    
    if (unused.length > 8) {
      console.log(`${chalk.gray(`... 还有 ${unused.length - 8} 个未使用类型`)}`)
    }
  }

  printRecommendations(recommendations) {
    console.log('\n💡 改进建议')
    console.log('─'.repeat(30))
    
    recommendations.forEach((rec, index) => {
      console.log(`${index + 1}. ${rec}`)
    })
  }

  // 生成详细的 Markdown 报告
  async generateMarkdownReport(report) {
    const reportDir = join(this.rootDir, 'type-reports')
    if (!existsSync(reportDir)) {
      mkdirSync(reportDir, { recursive: true })
    }
    
    const date = new Date().toISOString().split('T')[0]
    const fileName = `type-analysis-${date}.md`
    const filePath = join(reportDir, fileName)
    
    const markdown = this.buildMarkdownContent(report)
    writeFileSync(filePath, markdown, 'utf8')
    
    console.log(`\n📋 详细报告已保存: ${chalk.green(this.relativePath(filePath))}`)
    return filePath
  }

  buildMarkdownContent(report) {
    const { statistics: stats, healthScore, issues } = report
    const timestamp = new Date().toLocaleString('zh-CN')
    
    let content = []
    
    // 标题和概览
    content.push('# 🛠️ TypeScript 类型分析报告')
    content.push('')
    content.push(`**生成时间**: ${timestamp}`)
    content.push(`**项目路径**: \`${this.rootDir}\``)
    content.push(`**分析范围**: 仅 src/ 目录下的自定义类型`)
    content.push('')
    
    // 执行摘要
    content.push('## 📋 执行摘要')
    content.push('')
    
    const scoreEmoji = healthScore >= 80 ? '🟢' : healthScore >= 60 ? '🟡' : '🔴'
    const scoreStatus = healthScore >= 80 ? '优秀' : healthScore >= 60 ? '良好' : '需要改进'
    
    content.push(`### ${scoreEmoji} 综合评分: ${healthScore}/100 (${scoreStatus})`)
    content.push('')
    
    if (healthScore >= 80) {
      content.push('🎉 **自定义类型系统状态优秀，继续保持！**')
    } else if (healthScore >= 60) {
      content.push('✅ **类型系统基本健康，有小幅改进空间。**')
    } else {
      content.push('🚨 **类型系统需要重点关注和优化。**')
    }
    content.push('')
    
    // 统计数据表格
    content.push('## 📊 统计数据')
    content.push('')
    content.push('| 指标 | 数值 | 状态 |')
    content.push('|------|------|------|')
    
    const metrics = [
      ['📁 源文件', stats.totalFiles, '✅ 正常'],
      ['🎯 自定义类型', stats.totalTypes, stats.totalTypes > 0 ? '✅ 正常' : '⚠️ 无自定义类型'],
      ['🔗 类型引用', stats.totalUsages, stats.totalUsages > 0 ? '✅ 正常' : '⚠️ 无引用'],
      ['🚨 类型错误', stats.totalErrors, stats.totalErrors === 0 ? '🟢 优秀' : '🔴 需修复'],
      ['⚠️ 类型警告', stats.totalWarnings, stats.totalWarnings === 0 ? '🟢 优秀' : '🟡 需关注'],
      ['🔄 重复定义', stats.duplicateTypes, stats.duplicateTypes === 0 ? '🟢 优秀' : '🟡 需处理'],
      ['🗑️ 未使用类型', stats.unusedTypes, stats.unusedTypes === 0 ? '🟢 优秀' : '🟡 可清理']
    ]
    
    metrics.forEach(([metric, value, status]) => {
      content.push(`| ${metric} | **${value}** | ${status} |`)
    })
    content.push('')

    // 分析说明
    content.push('## ℹ️ 分析说明')
    content.push('')
    content.push('本工具专门针对 Vue3 + TypeScript 项目优化，**已自动排除**：')
    content.push('- Vue3 Composition API 相关错误 (ref, reactive, computed 等)')
    content.push('- UI 库组件相关错误 (NButton, NInput 等)')  
    content.push('- Vite 环境变量相关错误 (import.meta.env, import.meta.glob)')
    content.push('- 第三方依赖库类型错误')
    content.push('- TypeScript 内置类型')
    content.push('- **src/stores/ 目录下的所有文件** (状态管理类型通常都是必要的)')
    content.push('')
    content.push('**专注分析**：你自己定义的 interface、type、enum 等自定义类型')
    content.push('')
    
    // 检测方法说明
    if (report.analysisMethod) {
      const methodName = report.analysisMethod === 'ts-unused-exports' ? 
        '使用专业的 ts-unused-exports 库进行精确检测' :
        report.analysisMethod === 'basic-detection' ?
        '使用基础检测方法（专业库不可用时的备用方案）' :
        '混合检测方法'
      
      content.push(`**未使用类型检测**：${methodName}`)
      content.push('')
    }
    
    // 类型错误详情
    if (issues.errors.length > 0) {
      content.push('## 🚨 类型错误详情')
      content.push('')
      content.push(`发现 **${issues.errors.length}** 个真正的类型错误，需要修复：`)
      content.push('')
      
      const errorsByFile = this.groupErrorsByFile(issues.errors)
      
      Object.entries(errorsByFile).forEach(([file, fileErrors]) => {
        const relativePath = this.relativePath(file)
        content.push(`### 📄 \`${relativePath}\``)
        content.push('')
        
        content.push('| 行号 | 错误代码 | 严重程度 | 错误信息 |')
        content.push('|------|----------|----------|----------|')
        
        fileErrors.forEach(error => {
          const severityEmoji = error.severity === 'error' ? '🔴' : 
                               error.severity === 'warning' ? '🟡' : '🔵'
          const message = error.message.length > 80 ? 
            error.message.slice(0, 80) + '...' : error.message
          content.push(`| ${error.line} | \`${error.code}\` | ${severityEmoji} ${error.severity} | ${message} |`)
        })
        content.push('')
      })
    }
    
    // 类型警告详情
    if (issues.warnings.length > 0) {
      content.push('## ⚠️ 类型警告详情')
      content.push('')
      content.push(`发现 **${issues.warnings.length}** 个类型警告，建议处理：`)
      content.push('')
      
      const warningsByFile = this.groupErrorsByFile(issues.warnings)
      
      Object.entries(warningsByFile).slice(0, 5).forEach(([file, warnings]) => {
        const relativePath = this.relativePath(file)
        content.push(`### 📄 \`${relativePath}\``)
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
    }
    
    // 重复类型详情
    if (Object.keys(issues.duplicates).length > 0) {
      content.push('## 🔄 重复类型定义')
      content.push('')
      content.push(`发现 **${Object.keys(issues.duplicates).length}** 个重复的自定义类型：`)
      content.push('')
      
      Object.entries(issues.duplicates).forEach(([typeName, definitions]) => {
        content.push(`### 🔄 \`${typeName}\` (${definitions[0].kind})`)
        content.push('')
        content.push('**定义位置：**')
        
        definitions.forEach((def, index) => {
          const relativePath = this.relativePath(def.file)
          content.push(`${index + 1}. \`${relativePath}:${def.line}\``)
        })
        content.push('')
        
        content.push('**建议：** 将重复定义合并到一个文件中，或使用不同的类型名称。')
        content.push('')
      })
    }
    
    // 未使用类型
    if (issues.unused.length > 0) {
      content.push('## 🗑️ 未使用的自定义类型')
      content.push('')
      content.push(`发现 **${issues.unused.length}** 个未使用的自定义类型定义：`)
      content.push('')
      
      // 按文件分组
      const unusedByFile = {}
      issues.unused.forEach(item => {
        if (!unusedByFile[item.file]) {
          unusedByFile[item.file] = []
        }
        unusedByFile[item.file].push(item)
      })
      
      Object.entries(unusedByFile).forEach(([file, items]) => {
        content.push(`### 📄 \`${file}\``)
        content.push('')
        content.push('| 类型名 | 类型 | 行号 | 建议 |')
        content.push('|--------|------|------|------|')
        
        items.forEach(item => {
          content.push(`| \`${item.name}\` | ${item.type} | ${item.line} | 可安全删除 |`)
        })
        content.push('')
      })
    }
    
    // 改进建议
    content.push('## 💡 改进建议')
    content.push('')
    
    if (report.recommendations.length > 0) {
      report.recommendations.forEach((rec, index) => {
        content.push(`${index + 1}. ${rec}`)
      })
      content.push('')
    }
    
    // 快速修复指南
    content.push('### 🔧 快速修复指南')
    content.push('')
    content.push('1. **修复类型错误**: 打开对应文件，根据行号和错误信息修复')
    content.push('2. **合并重复类型**: 选择一个主要文件，将其他重复定义移动过来')  
    content.push('3. **清理未使用类型**: 确认类型确实未使用后，安全删除')
    content.push('4. **处理类型警告**: 根据警告信息优化类型定义')
    content.push('5. **重新检查**: 修复后再次运行工具验证结果')
    content.push('')
    
    // 页脚
    content.push('---')
    content.push('')
    content.push('*由 ts-type-cleaner 类型分析工具生成*')
    
    return content.join('\n')
  }

  // 工具方法
  groupErrorsByFile(errors) {
    const groups = {}
    errors.forEach(error => {
      if (!groups[error.file]) {
        groups[error.file] = []
      }
      groups[error.file].push(error)
    })
    return groups
  }

  createProgressBar(value, max, width = 30) {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100))
    const filled = Math.round((percentage / 100) * width)
    const empty = width - filled
    
    const color = percentage >= 80 ? 'green' : percentage >= 60 ? 'yellow' : 'red'
    
    const bar = chalk[color]('█'.repeat(filled)) + chalk.gray('░'.repeat(empty))
    return `[${bar}] ${percentage.toFixed(0)}%`
  }

  relativePath(filePath) {
    return relative(this.rootDir, filePath).replace(/\\/g, '/')
  }
}