import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, relative } from 'path'

export class ReportGenerator {
  constructor(options = {}) {
    this.options = {
      outputDir: options.outputDir || './type-reports',
      format: options.format || 'markdown',
      ...options,
    }
  }

  async generateDetailedGuide(analysisResult, validationResult) {
    if (!existsSync(this.options.outputDir)) {
      mkdirSync(this.options.outputDir, { recursive: true })
    }

    const guide = this.buildGuideContent(analysisResult, validationResult)
    const fileName = 'TYPE_CLEANUP_GUIDE.md'
    const outputPath = join(this.options.outputDir, fileName)

    writeFileSync(outputPath, guide.join('\n'))
    return outputPath
  }

  buildGuideContent(analysisResult, validationResult) {
    const guide = []

    guide.push('# 🛠️ TypeScript 类型清理和修复指南')
    guide.push('')
    guide.push('> 自动生成于: ' + new Date().toLocaleString())
    guide.push('')

    // 统计信息
    guide.push('## 📊 问题统计')
    guide.push('')
    guide.push(`- 🗑️ 未使用类型: ${analysisResult.unusedTypes} 个`)
    guide.push(`- 🔗 重复定义: ${analysisResult.duplicateDefinitions} 个`)
    guide.push(`- ❌ 类型错误: ${validationResult.errors.length} 个`)
    guide.push(`- ⚠️ 警告问题: ${validationResult.warnings.length} 个`)
    guide.push(`- 📈 健康评分: ${analysisResult.healthScore}/100`)
    guide.push('')

    // 未使用的类型
    if (analysisResult.details.unusedTypes.length > 0) {
      guide.push('## 🗑️ 未使用的类型定义清理')
      guide.push('')

      analysisResult.details.unusedTypes.forEach((typeName, index) => {
        const typeInfo = analysisResult.details.typeDefinitions[typeName]
        if (typeInfo) {
          guide.push(`### ${index + 1}. ${typeName}`)
          guide.push(
            `- **文件**: \`${relative(process.cwd(), typeInfo.file)}\``
          )
          guide.push(`- **位置**: 第 ${typeInfo.line} 行`)
          guide.push(`- **类型**: ${typeInfo.type}`)
          guide.push(`- **操作**: 删除整个类型定义`)
          guide.push('')
        }
      })
    }

    // 重复类型定义
    if (analysisResult.details.duplicates.length > 0) {
      guide.push('## 🔗 重复类型定义合并')
      guide.push('')

      analysisResult.details.duplicates.forEach((typeName, index) => {
        guide.push(`### ${index + 1}. ${typeName}`)
        guide.push('**建议**: 选择一个主要位置保留定义，删除其他重复项')
        guide.push('')
      })
    }

    // 类型错误
    if (validationResult.errors.length > 0) {
      guide.push('## 🚨 类型错误修复')
      guide.push('')

      validationResult.errors.slice(0, 10).forEach((error, index) => {
        guide.push(`### ${index + 1}. ${error.type.toUpperCase()} 错误`)
        guide.push(`- **文件**: \`${relative(process.cwd(), error.file)}\``)
        guide.push(`- **位置**: 第 ${error.line} 行`)
        guide.push(`- **问题**: ${error.message}`)
        if (error.code) {
          guide.push(`- **错误代码**: ${error.code}`)
        }
        guide.push('')
      })

      if (validationResult.errors.length > 10) {
        guide.push(
          `> 还有 ${validationResult.errors.length - 10} 个错误未显示...`
        )
        guide.push('')
      }
    }

    // 建议
    guide.push('## 💡 改进建议')
    guide.push('')
    analysisResult.suggestions.forEach(suggestion => {
      guide.push(`- ${suggestion}`)
    })
    validationResult.suggestions.forEach(suggestion => {
      guide.push(`- ${suggestion}`)
    })
    guide.push('')

    return guide
  }
}
