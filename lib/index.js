import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join, relative, extname, resolve, dirname } from 'path'
import ts from 'typescript'

export class TypeAnalyzer {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd()
    this.verbose = Boolean(options.verbose)
    
    // 简单清晰的数据结构
    this.sourceFiles = []
    this.typeDefinitions = new Map() // typeName -> [所有定义位置]
    this.typeUsages = new Map()      // typeName -> [所有使用位置]
    this.errors = []
    this.warnings = []
  }

  async analyze() {
    try {
      this.log('🔍 开始分析 TypeScript 类型...')
      
      this.scanFiles()
      const program = this.createProgram()
      this.collectDefinitions(program)
      this.collectUsages(program)
      this.collectErrors(program)
      
      const report = this.generateReport()
      this.saveReport(report)
      
      return report
    } catch (error) {
      console.error('❌ 分析失败:', error.message)
      throw error
    }
  }

  log(message) {
    if (this.verbose) console.log(message)
  }

  // 1. 扫描源文件
  scanFiles() {
    const srcDir = join(this.rootDir, 'src')
    const startDir = existsSync(srcDir) ? srcDir : this.rootDir
    
    this.sourceFiles = this.walkDirectory(startDir)
      .filter(file => /\.(ts|tsx|vue)$/.test(file))
      .filter(file => !file.includes('node_modules') && !file.endsWith('.d.ts'))
    
    this.log(`📄 找到 ${this.sourceFiles.length} 个源文件`)
  }

  walkDirectory(dir) {
    let files = []
    try {
      const items = readdirSync(dir)
      for (const item of items) {
        if (item.startsWith('.') || ['node_modules', 'dist', 'build'].includes(item)) continue
        
        const fullPath = join(dir, item)
        const stat = statSync(fullPath)
        
        if (stat.isDirectory()) {
          files = files.concat(this.walkDirectory(fullPath))
        } else {
          files.push(fullPath)
        }
      }
    } catch (error) {
      // 忽略访问错误
    }
    return files
  }

  // 2. 创建 TypeScript 程序
  createProgram() {
    const tsFiles = this.sourceFiles.filter(f => /\.(ts|tsx)$/.test(f))
    if (tsFiles.length === 0) return null

    const options = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      skipLibCheck: true,
      noEmit: true,
      allowJs: false,
      strict: false
    }

    return ts.createProgram(tsFiles, options)
  }

  // 3. 收集类型定义
  collectDefinitions(program) {
    // 处理 TS/TSX 文件
    if (program) {
      for (const sourceFile of program.getSourceFiles()) {
        if (this.isProjectFile(sourceFile.fileName)) {
          this.extractDefinitions(sourceFile)
        }
      }
    }

    // 处理 Vue 文件
    for (const file of this.sourceFiles) {
      if (file.endsWith('.vue')) {
        this.extractVueDefinitions(file)
      }
    }

    this.log(`📊 找到 ${Array.from(this.typeDefinitions.values()).flat().length} 个类型定义`)
  }

  isProjectFile(fileName) {
    const normalized = resolve(fileName).replace(/\\/g, '/')
    return this.sourceFiles.some(f => resolve(f).replace(/\\/g, '/') === normalized)
  }

  extractDefinitions(sourceFile) {
    const filePath = resolve(sourceFile.fileName).replace(/\\/g, '/')
    
    const visitor = (node) => {
      // 检查是否是类型定义节点
      const typeInfo = this.getTypeInfo(node, sourceFile, filePath)
      if (typeInfo) {
        this.addDefinition(typeInfo)
      }
      
      // 继续遍历
      ts.forEachChild(node, visitor)
    }
    
    visitor(sourceFile)
  }

  extractVueDefinitions(filePath) {
    try {
      const content = readFileSync(filePath, 'utf8')
      // 提取 script setup 或 lang="ts" 的内容
      const scriptMatch = content.match(/<script[^>]*(?:setup|lang=["']ts["'])[^>]*>([\s\S]*?)<\/script>/i)
      
      if (scriptMatch) {
        const scriptContent = scriptMatch[1]
        const sourceFile = ts.createSourceFile(filePath, scriptContent, ts.ScriptTarget.Latest, true)
        this.extractDefinitions(sourceFile)
      }
    } catch (error) {
      // 忽略解析错误
    }
  }

  getTypeInfo(node, sourceFile, filePath) {
    let name = null
    let kind = null

    switch (node.kind) {
      case ts.SyntaxKind.InterfaceDeclaration:
        name = node.name?.text
        kind = 'interface'
        break
      case ts.SyntaxKind.TypeAliasDeclaration:
        name = node.name?.text
        kind = 'type'
        break
      case ts.SyntaxKind.EnumDeclaration:
        name = node.name?.text
        kind = 'enum'
        break
      case ts.SyntaxKind.ClassDeclaration:
        name = node.name?.text
        kind = 'class'
        break
    }

    if (!name || this.isBuiltinType(name)) return null

    const line = this.getLineNumber(sourceFile, node)
    const exported = Boolean(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))

    return { name, kind, file: filePath, line, exported }
  }

  getLineNumber(sourceFile, node) {
    try {
      const start = node.getStart ? node.getStart() : node.pos
      const pos = ts.getLineAndCharacterOfPosition(sourceFile, start)
      return pos.line + 1
    } catch (error) {
      return 1
    }
  }

  isBuiltinType(name) {
    const builtins = ['string', 'number', 'boolean', 'Array', 'Promise', 'Record', 'Partial', 'Required', 'Pick', 'Omit']
    return builtins.includes(name)
  }

  addDefinition(typeInfo) {
    const { name } = typeInfo
    
    if (!this.typeDefinitions.has(name)) {
      this.typeDefinitions.set(name, [])
    }
    
    this.typeDefinitions.get(name).push(typeInfo)
  }

  // 4. 收集类型使用
  collectUsages(program) {
    if (!program) return

    for (const sourceFile of program.getSourceFiles()) {
      if (this.isProjectFile(sourceFile.fileName)) {
        this.extractUsages(sourceFile)
      }
    }
  }

  extractUsages(sourceFile) {
    const filePath = resolve(sourceFile.fileName).replace(/\\/g, '/')
    
    const visitor = (node) => {
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        const typeName = node.typeName.text
        if (!this.isBuiltinType(typeName)) {
          this.addUsage(typeName, {
            file: filePath,
            line: this.getLineNumber(sourceFile, node)
          })
        }
      }
      
      ts.forEachChild(node, visitor)
    }
    
    visitor(sourceFile)
  }

  addUsage(typeName, usage) {
    if (!this.typeUsages.has(typeName)) {
      this.typeUsages.set(typeName, [])
    }
    this.typeUsages.get(typeName).push(usage)
  }

  // 5. 收集错误
  collectErrors(program) {
    if (!program) return

    const diagnostics = ts.getPreEmitDiagnostics(program)
    
    for (const diagnostic of diagnostics) {
      if (!diagnostic.file || !this.isProjectFile(diagnostic.file.fileName)) continue
      
      // 只关注重要的类型错误
      if ([2322, 2345, 2531, 2532, 2571].includes(diagnostic.code)) {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        
        // 跳过环境相关错误
        if (message.includes('import.meta') || message.includes('vite')) continue
        
        const position = diagnostic.start ? 
          ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start) : 
          { line: 0, character: 0 }

        this.errors.push({
          file: resolve(diagnostic.file.fileName).replace(/\\/g, '/'),
          line: position.line + 1,
          code: `TS${diagnostic.code}`,
          message
        })
      }
    }
  }

  // 6. 生成报告
  generateReport() {
    const duplicates = this.findDuplicates()
    const unused = this.findUnused()
    
    const stats = {
      sourceFiles: this.sourceFiles.length,
      typeDefinitions: Array.from(this.typeDefinitions.values()).flat().length,
      usageReferences: Array.from(this.typeUsages.values()).flat().length,
      unusedTypes: unused.length,
      duplicateDefinitions: Object.keys(duplicates).length,
      totalErrors: this.errors.length,
      totalWarnings: this.warnings.length
    }

    const healthScore = this.calculateHealthScore(stats)
    const validationScore = stats.totalErrors === 0 ? 100 : Math.max(0, 100 - stats.totalErrors * 10)
    const overallScore = Math.round((healthScore + validationScore) / 2)

    return {
      timestamp: new Date().toISOString(),
      statistics: stats,
      scores: { healthScore, validationScore, overallScore },
      details: {
        duplicates: this.formatDuplicates(duplicates),
        unused,
        errors: this.errors.map(e => ({...e, file: this.relativePath(e.file)})),
        warnings: this.warnings.map(w => ({...w, file: this.relativePath(w.file)}))
      },
      suggestions: this.generateSuggestions(stats)
    }
  }

  // 核心：找出真正的重复类型
  findDuplicates() {
    const duplicates = {}
    
    for (const [typeName, definitions] of this.typeDefinitions) {
      if (definitions.length <= 1) continue
      
      // 按文件分组
      const fileGroups = new Map()
      for (const def of definitions) {
        if (!fileGroups.has(def.file)) {
          fileGroups.set(def.file, [])
        }
        fileGroups.get(def.file).push(def)
      }
      
      // 只有在多个不同文件中定义才算重复
      if (fileGroups.size > 1) {
        duplicates[typeName] = definitions
      }
    }
    
    return duplicates
  }

  findUnused() {
    const unused = []
    
    for (const [typeName, definitions] of this.typeDefinitions) {
      // 只检查第一个定义（通常是主要定义）
      const mainDef = definitions[0]
      
      // 跳过导出的类型
      if (mainDef.exported) continue
      
      const usages = this.typeUsages.get(typeName) || []
      
      // 过滤掉定义处附近的"使用"（可能是同一行的定义）
      const realUsages = usages.filter(usage => 
        !(usage.file === mainDef.file && Math.abs(usage.line - mainDef.line) <= 1)
      )
      
      if (realUsages.length === 0) {
        unused.push(typeName)
      }
    }
    
    return unused
  }

  formatDuplicates(duplicates) {
    const formatted = {}
    
    for (const [typeName, definitions] of Object.entries(duplicates)) {
      formatted[typeName] = definitions.map(def => ({
        file: this.relativePath(def.file),
        line: def.line,
        type: def.kind
      }))
    }
    
    return formatted
  }

  calculateHealthScore(stats) {
    if (stats.typeDefinitions === 0) return 100
    
    let score = 100
    const unusedRatio = stats.unusedTypes / stats.typeDefinitions
    const duplicateRatio = stats.duplicateDefinitions / stats.typeDefinitions
    
    score -= Math.min(40, unusedRatio * 100)
    score -= Math.min(30, duplicateRatio * 100)
    
    return Math.max(0, Math.round(score))
  }

  generateSuggestions(stats) {
    const suggestions = []
    
    if (stats.totalErrors > 0) {
      suggestions.push(`🔴 修复 ${stats.totalErrors} 个类型错误`)
    }
    if (stats.unusedTypes > 0) {
      suggestions.push(`🗑️ 清理 ${stats.unusedTypes} 个未使用的类型定义`)
    }
    if (stats.duplicateDefinitions > 0) {
      suggestions.push(`⚠️ 处理 ${stats.duplicateDefinitions} 个重复的类型定义`)
    }
    
    return suggestions.length > 0 ? suggestions : ['🎉 类型系统状态良好！']
  }

  relativePath(filePath) {
    return relative(this.rootDir, filePath).replace(/\\/g, '/')
  }

  // 7. 保存 Markdown 报告
  saveReport(report) {
    const reportDir = join(this.rootDir, 'type-reports')
    if (!existsSync(reportDir)) {
      mkdirSync(reportDir, { recursive: true })
    }

    const date = new Date().toISOString().split('T')[0]
    const reportFile = join(reportDir, `type-analysis-${date}.md`)
    const markdown = this.generateMarkdown(report)
    
    writeFileSync(reportFile, markdown, 'utf8')
    this.log(`📄 报告已保存: ${reportFile}`)
  }

  generateMarkdown(report) {
    const { statistics: stats, scores, details } = report
    const date = new Date().toLocaleString('zh-CN')
    
    let md = `# 🛠️ TypeScript 类型分析报告

**生成时间**: ${date}  
**项目路径**: \`${this.rootDir}\`  

## 📋 执行摘要

### ${scores.overallScore >= 80 ? '🟢' : scores.overallScore >= 60 ? '🟡' : '🔴'} 综合评分: ${scores.overallScore}/100

**评分细节：**
- 健康分数: ${scores.healthScore}/100
- 验证分数: ${scores.validationScore}/100

${scores.overallScore >= 80 ? '🎉 **优秀**: 代码类型系统非常健康，继续保持！' : 
  scores.overallScore >= 60 ? '⚠️ **良好**: 代码类型系统基本健康，有改进空间。' : 
  '🚨 **需要改进**: 代码类型系统存在一些问题，建议及时修复。'}

## 📊 核心指标

| 指标 | 数值 | 状态 |
|------|------|------|
| 📁 源文件 | **${stats.sourceFiles}** | ✅ 正常 |
| 🎯 类型定义 | **${stats.typeDefinitions}** | ✅ 正常 |
| 🔗 类型引用 | **${stats.usageReferences}** | ✅ 正常 |
| 🗑️ 未使用类型 | **${stats.unusedTypes}** | ${stats.unusedTypes === 0 ? '🟢 优秀' : '🔴 需修复'} |
| ⚠️ 重复定义 | **${stats.duplicateDefinitions}** | ${stats.duplicateDefinitions === 0 ? '🟢 优秀' : '🔴 需修复'} |
| 🚨 类型错误 | **${stats.totalErrors}** | ${stats.totalErrors === 0 ? '🟢 优秀' : '🔴 需修复'} |
| ⚠️ 类型警告 | **${stats.totalWarnings}** | ${stats.totalWarnings === 0 ? '🟢 优秀' : '🟡 注意'} |

`

    // 重复定义详情
    if (Object.keys(details.duplicates).length > 0) {
      md += `\n## ⚠️ 重复定义详情\n\n发现 **${Object.keys(details.duplicates).length}** 个重复的类型定义，建议合并或重命名。\n\n`
      
      let index = 1
      for (const [typeName, locations] of Object.entries(details.duplicates)) {
        md += `### ${index}. \`${typeName}\`\n\n定义位置：\n`
        for (const loc of locations) {
          md += `- \`${loc.file}:${loc.line}\` (${loc.type})\n`
        }
        md += '\n'
        index++
      }
    }

    // 类型错误详情
    if (details.errors.length > 0) {
      md += `\n## 🚨 类型错误详情\n\n发现 **${details.errors.length}** 个类型错误，需要修复。\n\n`
      
      for (const [index, error] of details.errors.entries()) {
        md += `### ${index + 1}. ${error.file}:${error.line}\n\n`
        md += `**错误代码**: ${error.code}\n\n`
        md += `**错误信息**: ${error.message}\n\n`
      }
    }

    // 改进建议
    md += `\n## 💡 改进建议\n\n`
    
    if (report.suggestions.length > 0) {
      md += `### 优先处理事项\n\n`
      for (const [index, suggestion] of report.suggestions.entries()) {
        md += `${index + 1}. ${suggestion}\n`
      }
    }

    md += `\n### 快速修复指南\n\n`
    md += `1. **修复类型错误**: 打开错误详情中列出的文件，根据行号定位并修复错误\n`
    md += `2. **清理未使用类型**: 删除标记为未使用的类型定义\n`
    md += `3. **处理重复定义**: 将重复的类型定义合并到一个文件中，或使用不同的名称\n`
    md += `4. **运行检查**: 修复后重新运行分析验证修复效果\n\n`

    md += `---\n\n_使用 TypeScript 类型分析器生成_`

    return md
  }
}

// 导出函数
export async function analyzeProject(options = {}) {
  const analyzer = new TypeAnalyzer(options)
  return await analyzer.analyze()
}

export async function quickCheck(options = {}) {
  const result = await analyzeProject({ ...options, verbose: false })
  const threshold = options.threshold || 70

  return {
    passed: result.details.errors.length === 0 && result.scores.overallScore >= threshold,
    score: result.scores.overallScore,
    errors: result.details.errors.length,
    warnings: result.details.warnings.length,
    summary: result.details.errors.length === 0 
      ? `✅ 类型检查通过 (评分: ${result.scores.overallScore}/100)`
      : `❌ 发现 ${result.details.errors.length} 个类型错误`
  }
}