import { readFileSync } from 'fs'
import { join, relative } from 'path'
import { scanFiles } from '../utils/fileScanner.js'

export class TypeManager {
  constructor(options = {}) {
    this.options = {
      rootDir: options.rootDir || process.cwd(),
      outputDir: options.outputDir || './type-reports',
      exclude: options.exclude || ['node_modules', 'dist', '.git'],
      verbose: options.verbose || false,
      ...options,
    }

    this.typeDefinitions = new Map()
    this.typeUsages = new Map()
    this.duplicates = new Set()
    this.unusedTypes = new Set()
    this.sourceFiles = []
  }

  async analyze() {
    try {
      await this.scanSourceFiles()
      await this.analyzeTypeDefinitions()
      await this.analyzeTypeUsages()
      this.detectIssues()
      return this.generateReport()
    } catch (error) {
      console.error('分析过程中出现错误:', error.message)
      throw error
    }
  }

  async scanSourceFiles() {
    const srcDir = join(this.options.rootDir, 'src')
    this.sourceFiles = scanFiles(
      srcDir,
      ['.ts', '.vue', '.js'],
      this.options.exclude
    )

    if (this.options.verbose) {
      console.log(`扫描到 ${this.sourceFiles.length} 个文件`)
    }
  }

  async analyzeTypeDefinitions() {
    const typeRegex = /(?:interface|type|enum|class)\s+([A-Z][A-Za-z0-9_]*)/g

    for (const filePath of this.sourceFiles) {
      try {
        const content = readFileSync(filePath, 'utf8')
        let match

        while ((match = typeRegex.exec(content)) !== null) {
          const typeName = match[1]

          if (this.typeDefinitions.has(typeName)) {
            this.duplicates.add(typeName)
          }

          this.typeDefinitions.set(typeName, {
            name: typeName,
            file: filePath,
            line: this.getLineNumber(content, match.index),
            type: this.getDefinitionType(match[0]),
          })
        }
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`无法读取文件 ${filePath}: ${error.message}`)
        }
      }
    }
  }

  async analyzeTypeUsages() {
    for (const filePath of this.sourceFiles) {
      try {
        const content = readFileSync(filePath, 'utf8')

        for (const [typeName] of this.typeDefinitions) {
          const usageRegex = new RegExp(
            `\\b${this.escapeRegExp(typeName)}\\b`,
            'g'
          )
          const matches = [...content.matchAll(usageRegex)]

          const definitionCount = ['interface', 'type', 'enum', 'class'].filter(
            keyword => content.includes(`${keyword} ${typeName}`)
          ).length

          const usageCount = matches.length - definitionCount

          if (usageCount > 0) {
            if (!this.typeUsages.has(typeName)) {
              this.typeUsages.set(typeName, [])
            }

            this.typeUsages.get(typeName).push({
              file: filePath,
              count: usageCount,
            })
          }
        }
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`无法分析文件 ${filePath}: ${error.message}`)
        }
      }
    }
  }

  detectIssues() {
    for (const [typeName] of this.typeDefinitions) {
      if (!this.typeUsages.has(typeName)) {
        this.unusedTypes.add(typeName)
      }
    }
  }

  generateReport() {
    const totalFiles = this.sourceFiles.length
    const totalTypes = this.typeDefinitions.size
    const totalUsages = Array.from(this.typeUsages.values()).reduce(
      (sum, usages) => sum + usages.reduce((s, u) => s + u.count, 0),
      0
    )

    const healthScore = this.calculateHealthScore(
      totalTypes,
      this.unusedTypes.size,
      this.duplicates.size
    )

    return {
      timestamp: new Date().toISOString(),
      sourceFiles: totalFiles,
      typeDefinitions: totalTypes,
      usageReferences: totalUsages,
      unusedTypes: this.unusedTypes.size,
      duplicateDefinitions: this.duplicates.size,
      healthScore,
      details: {
        unusedTypes: Array.from(this.unusedTypes),
        duplicates: Array.from(this.duplicates),
        typeDefinitions: Object.fromEntries(this.typeDefinitions),
        typeUsages: Object.fromEntries(this.typeUsages),
      },
      suggestions: this.generateSuggestions(),
    }
  }

  calculateHealthScore(totalTypes, unusedCount, duplicateCount) {
    if (totalTypes === 0) return 100
    const unusedPenalty = (unusedCount / totalTypes) * 30
    const duplicatePenalty = (duplicateCount / totalTypes) * 40
    return Math.max(0, Math.round(100 - unusedPenalty - duplicatePenalty))
  }

  generateSuggestions() {
    const suggestions = []

    if (this.unusedTypes.size > 0) {
      suggestions.push(
        `💡 发现 ${this.unusedTypes.size} 个未使用的类型定义，建议清理`
      )
    }

    if (this.duplicates.size > 0) {
      suggestions.push(
        `⚠️ 发现 ${this.duplicates.size} 个重复的类型定义，建议合并`
      )
    }

    if (suggestions.length === 0) {
      suggestions.push('🎉 类型系统状态良好！')
    }

    return suggestions
  }

  getLineNumber(content, index) {
    return content.substring(0, index).split('\n').length
  }

  getDefinitionType(match) {
    if (match.startsWith('interface')) return 'interface'
    if (match.startsWith('type')) return 'type'
    if (match.startsWith('enum')) return 'enum'
    if (match.startsWith('class')) return 'class'
    return 'unknown'
  }

  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
