import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, resolve, relative, extname } from 'path'
import ts from 'typescript'

export class TypeAnalyzer {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd()
    this.srcDir = join(this.rootDir, 'src')
    this.verbose = options.verbose || false
    
    // 清晰的数据结构
    this.sourceFiles = []
    this.types = {
      definitions: new Map(), // 类型名 -> 定义信息
      usages: new Map(),      // 类型名 -> 使用位置数组
      errors: [],             // 类型错误
    }
  }

  async analyze() {
    console.log('🔍 开始分析 TypeScript 类型...')
    
    try {
      // 1. 扫描源文件
      this.scanSourceFiles()
      
      // 2. 创建 TypeScript 程序
      const program = this.createTSProgram()
      
      // 3. 收集类型信息
      this.collectTypeDefinitions(program)
      this.collectTypeUsages(program)
      this.collectTypeErrors(program)
      
      // 4. 分析结果
      const report = this.generateReport()
      
      return report
    } catch (error) {
      console.error('❌ 分析失败:', error.message)
      throw error
    }
  }

  // 扫描 src 目录下的 TS/TSX/Vue 文件
  scanSourceFiles() {
    if (!existsSync(this.srcDir)) {
      throw new Error(`src 目录不存在: ${this.srcDir}`)
    }
    
    this.sourceFiles = this.walkDirectory(this.srcDir)
      .filter(file => /\.(ts|tsx|vue)$/.test(file))
      .filter(file => !file.includes('.d.ts'))  // 排除声明文件
    
    this.log(`📁 找到 ${this.sourceFiles.length} 个源文件`)
  }

  walkDirectory(dir) {
    const files = []
    
    try {
      const items = readdirSync(dir)
      
      for (const item of items) {
        if (item.startsWith('.')) continue // 跳过隐藏文件
        
        const fullPath = join(dir, item)
        const stat = statSync(fullPath)
        
        if (stat.isDirectory()) {
          files.push(...this.walkDirectory(fullPath))
        } else {
          files.push(fullPath)
        }
      }
    } catch (error) {
      // 忽略权限错误等
    }
    
    return files
  }

  // 创建 TypeScript 程序
  createTSProgram() {
    const tsFiles = this.sourceFiles.filter(f => /\.(ts|tsx)$/.test(f))
    
    // 简化的编译选项
    const compilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      skipLibCheck: true,
      noEmit: true,
      strict: false,
      allowJs: false
    }
    
    return ts.createProgram(tsFiles, compilerOptions)
  }

  // 收集类型定义
  collectTypeDefinitions(program) {
    // 处理 TS/TSX 文件
    for (const sourceFile of program.getSourceFiles()) {
      if (this.isProjectFile(sourceFile.fileName)) {
        this.extractDefinitionsFromTS(sourceFile)
      }
    }
    
    // 处理 Vue 文件
    for (const file of this.sourceFiles) {
      if (file.endsWith('.vue')) {
        this.extractDefinitionsFromVue(file)
      }
    }
    
    this.log(`🎯 收集到 ${this.types.definitions.size} 个类型定义`)
  }

  isProjectFile(fileName) {
    const normalizedPath = resolve(fileName)
    return this.sourceFiles.some(f => resolve(f) === normalizedPath)
  }

  extractDefinitionsFromTS(sourceFile) {
    const visit = (node) => {
      const typeInfo = this.getTypeDefinition(node, sourceFile)
      if (typeInfo) {
        this.types.definitions.set(typeInfo.name, typeInfo)
      }
      ts.forEachChild(node, visit)
    }
    
    visit(sourceFile)
  }

  extractDefinitionsFromVue(filePath) {
    try {
      const content = readFileSync(filePath, 'utf8')
      
      // 提取 <script setup lang="ts"> 或 <script lang="ts"> 内容
      const scriptRegex = /<script[^>]*lang=["']ts["'][^>]*>([\s\S]*?)<\/script>/i
      const match = content.match(scriptRegex)
      
      if (match) {
        const scriptContent = match[1]
        const tempSourceFile = ts.createSourceFile(
          filePath,
          scriptContent,
          ts.ScriptTarget.Latest,
          true
        )
        this.extractDefinitionsFromTS(tempSourceFile)
      }
    } catch (error) {
      this.log(`⚠️ 解析 Vue 文件失败: ${filePath}`)
    }
  }

  getTypeDefinition(node, sourceFile) {
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
    const isExported = this.hasExportModifier(node)
    
    return {
      name,
      kind,
      file: resolve(sourceFile.fileName),
      line,
      isExported
    }
  }

  // 收集类型使用
  collectTypeUsages(program) {
    for (const sourceFile of program.getSourceFiles()) {
      if (this.isProjectFile(sourceFile.fileName)) {
        this.extractUsagesFromTS(sourceFile)
      }
    }
    
    this.log(`🔗 收集到 ${Array.from(this.types.usages.values()).flat().length} 个类型引用`)
  }

  extractUsagesFromTS(sourceFile) {
    const visit = (node) => {
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        const typeName = node.typeName.text
        
        if (!this.isBuiltinType(typeName)) {
          this.addTypeUsage(typeName, {
            file: resolve(sourceFile.fileName),
            line: this.getLineNumber(sourceFile, node)
          })
        }
      }
      
      ts.forEachChild(node, visit)
    }
    
    visit(sourceFile)
  }

  addTypeUsage(typeName, usage) {
    if (!this.types.usages.has(typeName)) {
      this.types.usages.set(typeName, [])
    }
    this.types.usages.get(typeName).push(usage)
  }

  // 收集类型错误
  collectTypeErrors(program) {
    const diagnostics = ts.getPreEmitDiagnostics(program)
    
    for (const diagnostic of diagnostics) {
      if (!diagnostic.file || !this.isProjectFile(diagnostic.file.fileName)) {
        continue
      }
      
      // 只关注关键的类型错误
      const importantErrorCodes = [
        2322, // Type 'X' is not assignable to type 'Y'
        2345, // Argument of type 'X' is not assignable to parameter of type 'Y'
        2304, // Cannot find name 'X'
        2339, // Property 'X' does not exist on type 'Y'
        2571, // Object is of type 'unknown'
        2531, // Object is possibly 'null'
        2532, // Object is possibly 'undefined'
      ]
      
      if (importantErrorCodes.includes(diagnostic.code)) {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        const position = diagnostic.start ? 
          ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start) : 
          { line: 0, character: 0 }
        
        this.types.errors.push({
          file: resolve(diagnostic.file.fileName),
          line: position.line + 1,
          column: position.character + 1,
          code: `TS${diagnostic.code}`,
          message: message.trim()
        })
      }
    }
    
    this.log(`🚨 发现 ${this.types.errors.length} 个类型错误`)
  }

  // 生成分析报告
  generateReport() {
    const duplicates = this.findDuplicateTypes()
    const unused = this.findUnusedTypes()
    
    const stats = {
      totalFiles: this.sourceFiles.length,
      totalTypes: this.types.definitions.size,
      totalUsages: Array.from(this.types.usages.values()).flat().length,
      totalErrors: this.types.errors.length,
      duplicateTypes: Object.keys(duplicates).length,
      unusedTypes: unused.length
    }
    
    const healthScore = this.calculateHealthScore(stats)
    
    return {
      timestamp: new Date().toISOString(),
      projectPath: this.rootDir,
      statistics: stats,
      healthScore,
      issues: {
        errors: this.types.errors,
        duplicates,
        unused
      },
      recommendations: this.generateRecommendations(stats)
    }
  }

  // 找出重复定义的类型（真正的重复，不是框架重复）
  findDuplicateTypes() {
    const duplicates = {}
    
    // 统计每个类型名出现的次数和位置
    const typeCount = new Map()
    
    for (const [typeName, definition] of this.types.definitions) {
      if (!typeCount.has(typeName)) {
        typeCount.set(typeName, [])
      }
      typeCount.get(typeName).push(definition)
    }
    
    // 找出真正的重复（同名但在不同文件中定义）
    for (const [typeName, definitions] of typeCount) {
      if (definitions.length > 1) {
        const fileSet = new Set(definitions.map(d => d.file))
        if (fileSet.size > 1) { // 确实在不同文件中定义
          duplicates[typeName] = definitions
        }
      }
    }
    
    return duplicates
  }

  // 找出未使用的类型
  findUnusedTypes() {
    const unused = []
    
    for (const [typeName, definition] of this.types.definitions) {
      // 跳过导出的类型（可能被外部使用）
      if (definition.isExported) continue
      
      const usages = this.types.usages.get(typeName) || []
      
      // 过滤掉定义位置的"使用"
      const actualUsages = usages.filter(usage => 
        !(usage.file === definition.file && 
          Math.abs(usage.line - definition.line) <= 2)
      )
      
      if (actualUsages.length === 0) {
        unused.push(typeName)
      }
    }
    
    return unused
  }

  // 计算健康度分数
  calculateHealthScore(stats) {
    if (stats.totalTypes === 0) return 100
    
    let score = 100
    
    // 类型错误严重扣分
    score -= Math.min(50, stats.totalErrors * 10)
    
    // 重复类型扣分
    const duplicateRatio = stats.duplicateTypes / stats.totalTypes
    score -= Math.min(25, duplicateRatio * 100)
    
    // 未使用类型轻微扣分
    const unusedRatio = stats.unusedTypes / stats.totalTypes
    score -= Math.min(15, unusedRatio * 50)
    
    return Math.max(0, Math.round(score))
  }

  // 生成改进建议
  generateRecommendations(stats) {
    const recommendations = []
    
    if (stats.totalErrors > 0) {
      recommendations.push(`🔴 立即修复 ${stats.totalErrors} 个类型错误`)
    }
    
    if (stats.duplicateTypes > 0) {
      recommendations.push(`⚠️ 合并或重命名 ${stats.duplicateTypes} 个重复类型`)
    }
    
    if (stats.unusedTypes > 0) {
      recommendations.push(`🗑️ 清理 ${stats.unusedTypes} 个未使用类型`)
    }
    
    if (recommendations.length === 0) {
      recommendations.push('🎉 类型系统状态良好！')
    }
    
    return recommendations
  }

  // 工具方法
  getLineNumber(sourceFile, node) {
    try {
      const start = node.getStart ? node.getStart() : node.pos
      const position = ts.getLineAndCharacterOfPosition(sourceFile, start)
      return position.line + 1
    } catch (error) {
      return 1
    }
  }

  hasExportModifier(node) {
    return node.modifiers?.some(modifier => 
      modifier.kind === ts.SyntaxKind.ExportKeyword
    ) || false
  }

  isBuiltinType(typeName) {
    const builtinTypes = [
      'string', 'number', 'boolean', 'object', 'undefined', 'null',
      'Array', 'Promise', 'Date', 'RegExp', 'Error',
      'Record', 'Partial', 'Required', 'Pick', 'Omit', 'Exclude'
    ]
    return builtinTypes.includes(typeName)
  }

  relativePath(filePath) {
    return relative(this.rootDir, filePath).replace(/\\/g, '/')
  }

  log(message) {
    if (this.verbose) {
      console.log(message)
    }
  }
}