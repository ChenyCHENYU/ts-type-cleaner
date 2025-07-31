import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, relative, extname, resolve } from 'path'
import ts from 'typescript'

export class TypeAnalyzer {
  constructor(options = {}) {
    // 安全的参数处理
    this.options = this.normalizeOptions(options)
    this.resetData()
  }

  normalizeOptions(options) {
    const defaultInclude = ['src/**/*.{ts,tsx,vue}']
    const defaultExclude = [
      'node_modules', 'dist', '.git', 'build', 'coverage',
      '**/*.d.ts', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'
    ]

    // 安全地处理 include
    let include = defaultInclude
    if (options.include) {
      if (typeof options.include === 'string') {
        include = options.include.split(',').map(s => s.trim()).filter(Boolean)
      } else if (Array.isArray(options.include)) {
        include = options.include
      }
    }

    // 安全地处理 exclude
    let exclude = defaultExclude
    if (options.exclude) {
      if (typeof options.exclude === 'string') {
        exclude = options.exclude.split(',').map(s => s.trim()).filter(Boolean)
      } else if (Array.isArray(options.exclude)) {
        exclude = options.exclude
      }
    }

    return {
      rootDir: options.rootDir || process.cwd(),
      include,
      exclude,
      verbose: Boolean(options.verbose),
      ignorePatterns: options.ignorePatterns || [
        /^Props$/, /^Emits$/, /^Slots$/, /^Expose$/,
        /Props$/, /Emits$/, /Events?$/, /State$/
      ],
    }
  }

  resetData() {
    this.typeDefinitions = new Map()
    this.typeUsages = new Map()
    this.duplicateTypes = new Map()
    this.unusedTypes = new Set()
    this.errors = []
    this.warnings = []
    this.sourceFiles = []
    this.program = null
  }

  async analyze() {
    try {
      if (this.options.verbose) {
        console.log('🔍  开始分析 TypeScript 类型...')
        console.log(`📂  项目根目录: ${this.options.rootDir}`)
      }

      await this.scanSourceFiles()
      await this.createTypeScriptProgram()
      await this.analyzeTypeDefinitions()
      await this.analyzeTypeUsages()
      await this.detectUnusedTypes()
      await this.runTypeChecking()

      return this.generateReport()
    } catch (error) {
      console.error('❌  分析过程出错:', error.message)
      if (this.options.verbose) {
        console.error(error.stack)
      }
      throw error
    }
  }

  async scanSourceFiles() {
    try {
      // 优先扫描 src 目录
      const srcDir = join(this.options.rootDir, 'src')
      const scanRoot = existsSync(srcDir) ? srcDir : this.options.rootDir
      
      this.sourceFiles = this.scanDirectory(scanRoot)
        .filter(file => this.isTypeScriptFile(file))
        .filter(file => this.shouldIncludeFile(file))

      if (this.options.verbose) {
        console.log(`📄  扫描到 ${this.sourceFiles.length} 个源文件`)
        if (this.sourceFiles.length === 0) {
          console.log('⚠️  未找到源文件，请检查项目结构')
        }
      }
    } catch (error) {
      throw new Error(`文件扫描失败: ${error.message}`)
    }
  }

  scanDirectory(dir) {
    const files = []
    try {
      if (!existsSync(dir)) return files

      const items = readdirSync(dir)
      for (const item of items) {
        if (item.startsWith('.')) continue
        
        const fullPath = join(dir, item)
        try {
          const stat = statSync(fullPath)
          
          if (stat.isDirectory()) {
            if (!this.shouldExcludeDirectory(item)) {
              files.push(...this.scanDirectory(fullPath))
            }
          } else {
            files.push(fullPath)
          }
        } catch (e) {
          // 忽略单个文件/目录的权限错误
          continue
        }
      }
    } catch (error) {
      // 忽略目录访问错误
    }
    return files
  }

  isTypeScriptFile(file) {
    return ['.ts', '.tsx', '.vue'].includes(extname(file))
  }

  shouldExcludeDirectory(dirName) {
    const excludeDirs = ['node_modules', 'dist', 'build', 'coverage', '.git', '.svn']
    return excludeDirs.includes(dirName)
  }

  shouldIncludeFile(file) {
    try {
      const relativePath = relative(this.options.rootDir, file).replace(/\\/g, '/')
      
      // 基本排除规则
      if (file.endsWith('.d.ts') || 
          relativePath.includes('node_modules') ||
          /\.(test|spec)\.(ts|tsx)$/.test(file)) {
        return false
      }
      
      // 检查用户定义的排除规则
      return !this.options.exclude.some(pattern => {
        if (pattern.includes('*')) {
          try {
            const regex = new RegExp(
              '^' + pattern
                .replace(/\*\*/g, '.*')
                .replace(/\*/g, '[^/]*')
                .replace(/\./g, '\\.')
                .replace(/\?/g, '.') + '$'
            )
            return regex.test(relativePath)
          } catch (e) {
            return false
          }
        }
        return relativePath.includes(pattern)
      })
    } catch (error) {
      return false
    }
  }

  async createTypeScriptProgram() {
    try {
      const compilerOptions = this.getCompilerOptions()
      const tsFiles = this.sourceFiles.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
      
      if (tsFiles.length > 0) {
        this.program = ts.createProgram(tsFiles, compilerOptions)
        
        if (this.options.verbose) {
          console.log(`🔧  创建 TypeScript 程序: ${tsFiles.length} 个文件`)
        }
      } else {
        if (this.options.verbose) {
          console.log('⚠️  未找到 TypeScript 文件')
        }
      }
    } catch (error) {
      if (this.options.verbose) {
        console.warn('⚠️  创建 TypeScript 程序失败:', error.message)
      }
    }
  }

  getCompilerOptions() {
    const defaultOptions = {
      target: ts.ScriptTarget.ES2020,
      lib: ['ES2020', 'DOM'],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      skipDefaultLibCheck: true,
      noEmit: true,
      strict: false, // 降低严格度，减少配置相关错误
      allowJs: false,
      baseUrl: this.options.rootDir,
      paths: { '@/*': ['src/*'] }
    }

    // 尝试读取项目配置
    try {
      const configPath = ts.findConfigFile(this.options.rootDir, ts.sys.fileExists, 'tsconfig.json')
      if (configPath) {
        const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
        if (!configFile.error) {
          const parsedConfig = ts.parseJsonConfigFileContent(
            configFile.config,
            ts.sys,
            this.options.rootDir
          )
          
          return {
            ...defaultOptions,
            ...parsedConfig.options,
            // 保持关键设置
            noEmit: true,
            skipLibCheck: true,
            skipDefaultLibCheck: true,
          }
        }
      }
    } catch (error) {
      // 使用默认配置
    }

    return defaultOptions
  }

  async analyzeTypeDefinitions() {
    let definitionCount = 0

    // 分析 TypeScript 程序
    if (this.program) {
      for (const sourceFile of this.program.getSourceFiles()) {
        if (this.isProjectFile(sourceFile.fileName)) {
          definitionCount += this.visitTypeDefinitions(sourceFile)
        }
      }
    }

    // 分析 Vue 文件
    for (const file of this.sourceFiles) {
      if (file.endsWith('.vue')) {
        definitionCount += await this.analyzeVueFile(file)
      }
    }

    if (this.options.verbose) {
      console.log(`📊  发现 ${this.typeDefinitions.size} 个类型定义`)
    }
  }

  isProjectFile(fileName) {
    try {
      const normalizedPath = resolve(fileName).replace(/\\/g, '/')
      
      // 排除系统文件
      if (normalizedPath.includes('node_modules') ||
          normalizedPath.includes('/lib.') ||
          normalizedPath.includes('typescript/lib')) {
        return false
      }
      
      // 检查是否是项目文件
      return this.sourceFiles.some(file => {
        return resolve(file).replace(/\\/g, '/') === normalizedPath
      })
    } catch (error) {
      return false
    }
  }

  visitTypeDefinitions(sourceFile) {
    let count = 0
    
    const visit = (node) => {
      try {
        if (!node) return
        
        switch (node.kind) {
          case ts.SyntaxKind.InterfaceDeclaration:
            if (this.processInterfaceDeclaration(node, sourceFile)) count++
            break
          case ts.SyntaxKind.TypeAliasDeclaration:
            if (this.processTypeAliasDeclaration(node, sourceFile)) count++
            break
          case ts.SyntaxKind.EnumDeclaration:
            if (this.processEnumDeclaration(node, sourceFile)) count++
            break
          case ts.SyntaxKind.ClassDeclaration:
            if (this.processClassDeclaration(node, sourceFile)) count++
            break
        }
        
        ts.forEachChild(node, visit)
      } catch (error) {
        // 忽略单个节点处理错误
      }
    }
    
    visit(sourceFile)
    return count
  }

  processInterfaceDeclaration(node, sourceFile) {
    try {
      if (!node || !node.name || !node.name.text) return false
      
      const name = node.name.text
      if (this.shouldIgnoreType(name)) return false

      const info = {
        name,
        type: 'interface',
        file: sourceFile.fileName,
        line: this.getNodeLine(sourceFile, node),
        exported: this.hasExportModifier(node)
      }

      this.addTypeDefinition(name, info)
      return true
    } catch (error) {
      return false
    }
  }

  processTypeAliasDeclaration(node, sourceFile) {
    try {
      if (!node || !node.name || !node.name.text) return false
      
      const name = node.name.text
      if (this.shouldIgnoreType(name)) return false

      const info = {
        name,
        type: 'type',
        file: sourceFile.fileName,
        line: this.getNodeLine(sourceFile, node),
        exported: this.hasExportModifier(node)
      }

      this.addTypeDefinition(name, info)
      return true
    } catch (error) {
      return false
    }
  }

  processEnumDeclaration(node, sourceFile) {
    try {
      if (!node || !node.name || !node.name.text) return false
      
      const name = node.name.text
      if (this.shouldIgnoreType(name)) return false

      const info = {
        name,
        type: 'enum',
        file: sourceFile.fileName,
        line: this.getNodeLine(sourceFile, node),
        exported: this.hasExportModifier(node)
      }

      this.addTypeDefinition(name, info)
      return true
    } catch (error) {
      return false
    }
  }

  processClassDeclaration(node, sourceFile) {
    try {
      if (!node || !node.name || !node.name.text) return false
      
      const name = node.name.text
      if (this.shouldIgnoreType(name)) return false

      const info = {
        name,
        type: 'class',
        file: sourceFile.fileName,
        line: this.getNodeLine(sourceFile, node),
        exported: this.hasExportModifier(node)
      }

      this.addTypeDefinition(name, info)
      return true
    } catch (error) {
      return false
    }
  }

  getNodeLine(sourceFile, node) {
    try {
      const start = node.getStart ? node.getStart() : node.pos
      const position = ts.getLineAndCharacterOfPosition(sourceFile, start)
      return position.line + 1
    } catch (error) {
      return 0
    }
  }

  hasExportModifier(node) {
    try {
      return node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) || false
    } catch (error) {
      return false
    }
  }

  addTypeDefinition(name, info) {
    try {
      if (this.typeDefinitions.has(name)) {
        const existing = this.typeDefinitions.get(name)
        if (existing.file !== info.file) {
          // 真正的重复定义
          if (!this.duplicateTypes.has(name)) {
            this.duplicateTypes.set(name, [existing])
          }
          this.duplicateTypes.get(name).push(info)
        }
      } else {
        this.typeDefinitions.set(name, info)
      }
    } catch (error) {
      // 忽略添加错误
    }
  }

  shouldIgnoreType(typeName) {
    try {
      // 内置类型
      const builtinTypes = [
        'string', 'number', 'boolean', 'object', 'undefined', 'null', 'void',
        'Array', 'Promise', 'Date', 'RegExp', 'Error', 'Function',
        'Record', 'Partial', 'Required', 'Pick', 'Omit'
      ]
      
      if (builtinTypes.includes(typeName)) return true

      // 用户定义的忽略模式
      return this.options.ignorePatterns.some(pattern => {
        if (pattern instanceof RegExp) {
          return pattern.test(typeName)
        }
        return typeName === pattern || typeName.includes(pattern)
      })
    } catch (error) {
      return false
    }
  }

  async analyzeVueFile(filePath) {
    try {
      const content = readFileSync(filePath, 'utf8')
      const scriptRegex = /<script[^>]*(?:\s+lang=["'](?:ts|typescript)["']|\s+setup)[^>]*>([\s\S]*?)<\/script>/gi
      let count = 0
      let match
      
      while ((match = scriptRegex.exec(content)) !== null) {
        try {
          const scriptContent = match[1]
          const sourceFile = ts.createSourceFile(
            filePath,
            scriptContent,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS
          )
          
          count += this.visitTypeDefinitions(sourceFile)
        } catch (error) {
          // 忽略单个 script 块的解析错误
          continue
        }
      }
      
      return count
    } catch (error) {
      return 0
    }
  }

  async analyzeTypeUsages() {
    if (!this.program) return

    try {
      for (const sourceFile of this.program.getSourceFiles()) {
        if (this.isProjectFile(sourceFile.fileName)) {
          this.visitTypeUsages(sourceFile)
        }
      }

      if (this.options.verbose) {
        const totalUsages = Array.from(this.typeUsages.values())
          .reduce((sum, usages) => sum + usages.length, 0)
        console.log(`🔗  发现 ${totalUsages} 个类型引用`)
      }
    } catch (error) {
      if (this.options.verbose) {
        console.warn('⚠️  类型使用分析失败:', error.message)
      }
    }
  }

  visitTypeUsages(sourceFile) {
    const visit = (node) => {
      try {
        if (!node) return
        
        if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
          const typeName = node.typeName.text
          if (!this.shouldIgnoreType(typeName)) {
            this.addTypeUsage(typeName, {
              file: sourceFile.fileName,
              line: this.getNodeLine(sourceFile, node)
            })
          }
        }
        
        ts.forEachChild(node, visit)
      } catch (error) {
        // 忽略单个节点错误
      }
    }
    
    visit(sourceFile)
  }

  addTypeUsage(typeName, usage) {
    try {
      if (!this.typeUsages.has(typeName)) {
        this.typeUsages.set(typeName, [])
      }
      this.typeUsages.get(typeName).push(usage)
    } catch (error) {
      // 忽略添加错误
    }
  }

  async detectUnusedTypes() {
    try {
      for (const [typeName, typeInfo] of this.typeDefinitions) {
        const usages = this.typeUsages.get(typeName) || []
        
        // 过滤掉定义处的"使用"
        const realUsages = usages.filter(usage => {
          try {
            const isSameFile = resolve(usage.file) === resolve(typeInfo.file)
            const isNearDefinition = Math.abs(usage.line - typeInfo.line) <= 2
            return !(isSameFile && isNearDefinition)
          } catch (error) {
            return true // 保守处理，认为是真实使用
          }
        })

        if (realUsages.length === 0 && !typeInfo.exported) {
          this.unusedTypes.add(typeName)
        }
      }

      if (this.options.verbose) {
        console.log(`🗑️  发现 ${this.unusedTypes.size} 个未使用类型`)
      }
    } catch (error) {
      if (this.options.verbose) {
        console.warn('⚠️  未使用类型检测失败:', error.message)
      }
    }
  }

  async runTypeChecking() {
    if (!this.program) return

    try {
      const allDiagnostics = ts.getPreEmitDiagnostics(this.program)
      
      for (const diagnostic of allDiagnostics) {
        try {
          if (!diagnostic.file || !this.isProjectFile(diagnostic.file.fileName)) {
            continue
          }

          if (this.isRealTypeError(diagnostic)) {
            const issue = this.createIssueFromDiagnostic(diagnostic)
            
            if (diagnostic.category === ts.DiagnosticCategory.Error) {
              this.errors.push(issue)
            } else if (diagnostic.category === ts.DiagnosticCategory.Warning) {
              this.warnings.push(issue)
            }
          }
        } catch (error) {
          // 忽略单个诊断的处理错误
          continue
        }
      }

      if (this.options.verbose) {
        console.log(`🚨  发现 ${this.errors.length} 个类型错误，${this.warnings.length} 个警告`)
      }
    } catch (error) {
      if (this.options.verbose) {
        console.warn('⚠️  类型检查失败:', error.message)
      }
    }
  }

  isRealTypeError(diagnostic) {
    // 真实的类型错误
    const realErrorCodes = [
      2322, // Type 'X' is not assignable to type 'Y'
      2339, // Property 'X' does not exist on type 'Y'
      2345, // Argument of type 'X' is not assignable
      2531, // Object is possibly 'null'
      2532, // Object is possibly 'undefined'
      2571, // Object is of type 'unknown'
    ]

    // 配置相关错误（跳过）
    const configErrorCodes = [
      2304, // Cannot find name
      2307, // Cannot find module
      1343, // import.meta
      2732, // resolveJsonModule
    ]

    return realErrorCodes.includes(diagnostic.code) && !configErrorCodes.includes(diagnostic.code)
  }

  createIssueFromDiagnostic(diagnostic) {
    try {
      const messageText = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
      let line = 0

      if (diagnostic.start !== undefined && diagnostic.file) {
        try {
          const position = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start)
          line = position.line + 1
        } catch (error) {
          line = 0
        }
      }

      return {
        file: diagnostic.file ? diagnostic.file.fileName : '',
        line,
        code: `TS${diagnostic.code}`,
        message: messageText,
        severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning'
      }
    } catch (error) {
      return {
        file: '',
        line: 0,
        code: 'TS0000',
        message: '处理诊断信息时出错',
        severity: 'error'
      }
    }
  }

  generateReport() {
    try {
      const stats = {
        sourceFiles: this.sourceFiles.length,
        typeDefinitions: this.typeDefinitions.size,
        usageReferences: Array.from(this.typeUsages.values()).reduce((sum, usages) => sum + usages.length, 0),
        unusedTypes: this.unusedTypes.size,
        duplicateDefinitions: this.duplicateTypes.size,
        totalErrors: this.errors.length,
        totalWarnings: this.warnings.length,
      }

      const scores = {
        healthScore: this.calculateHealthScore(),
        validationScore: this.calculateValidationScore(),
      }
      scores.overallScore = Math.round((scores.healthScore + scores.validationScore) / 2)

      return {
        timestamp: new Date().toISOString(),
        statistics: stats,
        scores,
        details: {
          unusedTypes: Array.from(this.unusedTypes),
          duplicates: Object.fromEntries(this.duplicateTypes),
          errors: this.errors,
          warnings: this.warnings,
          typeDefinitions: Object.fromEntries(this.typeDefinitions),
          typeUsages: Object.fromEntries(this.typeUsages),
        },
        suggestions: this.generateSuggestions(),
      }
    } catch (error) {
      throw new Error(`生成报告失败: ${error.message}`)
    }
  }

  calculateHealthScore() {
    try {
      const totalTypes = this.typeDefinitions.size
      if (totalTypes === 0) return 100

      let score = 100
      
      const unusedRatio = this.unusedTypes.size / totalTypes
      score -= Math.min(40, unusedRatio * 50)
      
      const duplicateRatio = this.duplicateTypes.size / totalTypes
      score -= Math.min(30, duplicateRatio * 40)

      return Math.max(0, Math.round(score))
    } catch (error) {
      return 50
    }
  }

  calculateValidationScore() {
    try {
      if (this.errors.length === 0) return 100
      
      let score = 100
      score -= this.errors.length * 10
      score -= this.warnings.length * 2

      return Math.max(0, Math.round(score))
    } catch (error) {
      return 50
    }
  }

  generateSuggestions() {
    try {
      const suggestions = []

      if (this.errors.length > 0) {
        suggestions.push(`🔴  修复 ${this.errors.length} 个类型错误`)
      }

      if (this.unusedTypes.size > 0) {
        suggestions.push(`🗑️  清理 ${this.unusedTypes.size} 个未使用的类型定义`)
      }

      if (this.duplicateTypes.size > 0) {
        suggestions.push(`⚠️  处理 ${this.duplicateTypes.size} 个重复的类型定义`)
      }

      if (suggestions.length === 0) {
        suggestions.push('🎉  类型系统状态良好！')
      }

      return suggestions
    } catch (error) {
      return ['生成建议时出错']
    }
  }
}

// 导出便捷函数
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
      ? `✅  类型检查通过 (评分: ${result.scores.overallScore}/100)`
      : `❌  发现 ${result.details.errors.length} 个类型错误`,
  }
}