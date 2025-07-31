import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, relative, extname, resolve } from 'path'
import ts from 'typescript'

export class TypeAnalyzer {
  constructor(options = {}) {
    // 确保参数正确处理
    const defaultInclude = ['src/**/*.{ts,tsx,vue}']
    const defaultExclude = [
      'node_modules', 'dist', '.git', 'build', 'coverage',
      '**/*.d.ts', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'
    ]

    this.options = {
      rootDir: options.rootDir || process.cwd(),
      include: this.normalizePatterns(options.include) || defaultInclude,
      exclude: this.normalizePatterns(options.exclude) || defaultExclude,
      verbose: options.verbose || false,
      ignorePatterns: options.ignorePatterns || [
        /^Props$/, /^Emits$/, /^Slots$/, /^Expose$/,
        /Props$/, /Emits$/, /Events?$/, /State$/
      ],
      ...options,
    }

    // 确保关键属性是数组
    if (!Array.isArray(this.options.include)) {
      this.options.include = defaultInclude
    }
    if (!Array.isArray(this.options.exclude)) {
      this.options.exclude = defaultExclude
    }

    this.resetData()
  }

  normalizePatterns(patterns) {
    if (!patterns) return null
    if (Array.isArray(patterns)) return patterns
    if (typeof patterns === 'string') {
      return patterns.split(',').map(p => p.trim()).filter(Boolean)
    }
    return [patterns]
  }

  resetData() {
    this.typeDefinitions = new Map() // 类型定义：name -> { file, line, type, exported }
    this.typeUsages = new Map()      // 类型使用：name -> [{ file, line }]
    this.duplicateTypes = new Map()  // 重复定义：name -> [definitions]
    this.unusedTypes = new Set()     // 未使用类型
    this.errors = []                 // 真实的类型错误
    this.warnings = []               // 类型警告
    this.sourceFiles = []            // 源文件列表
    this.program = null              // TypeScript 程序
  }

  async analyze() {
    if (this.options.verbose) {
      console.log('🔍  开始分析 TypeScript 类型...')
    }

    try {
      await this.scanSourceFiles()
      await this.createTypeScriptProgram()
      await this.analyzeTypeDefinitions()
      await this.analyzeTypeUsages()
      await this.detectUnusedTypes()
      await this.runTypeChecking()

      return this.generateReport()
    } catch (error) {
      console.error('❌  分析失败:', error.message)
      throw error
    }
  }

  async scanSourceFiles() {
    const srcDir = join(this.options.rootDir, 'src')
    const scanRoot = existsSync(srcDir) ? srcDir : this.options.rootDir
    
    this.sourceFiles = this.scanDirectory(scanRoot)
      .filter(file => this.isTypeScriptFile(file))
      .filter(file => this.shouldIncludeFile(file))

    if (this.options.verbose) {
      console.log(`📄  找到 ${this.sourceFiles.length} 个源文件`)
    }
  }

  scanDirectory(dir) {
    let files = []
    try {
      if (!existsSync(dir)) return files

      const items = readdirSync(dir)
      for (const item of items) {
        if (item.startsWith('.')) continue
        
        const fullPath = join(dir, item)
        const stat = statSync(fullPath)
        
        if (stat.isDirectory()) {
          if (!this.shouldExcludeDirectory(item)) {
            files = files.concat(this.scanDirectory(fullPath))
          }
        } else {
          files.push(fullPath)
        }
      }
    } catch (error) {
      // 忽略权限错误
    }
    return files
  }

  isTypeScriptFile(file) {
    return ['.ts', '.tsx', '.vue'].includes(extname(file))
  }

  shouldExcludeDirectory(dirName) {
    return ['node_modules', 'dist', 'build', 'coverage', '.git'].includes(dirName)
  }

  shouldIncludeFile(file) {
    const relativePath = relative(this.options.rootDir, file).replace(/\\/g, '/')
    
    // 排除规则
    if (file.endsWith('.d.ts') || 
        relativePath.includes('node_modules') ||
        /\.(test|spec)\.(ts|tsx)$/.test(file)) {
      return false
    }
    
    // 检查排除模式
    return !this.options.exclude.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(
          '^' + pattern
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*')
            .replace(/\./g, '\\.')
            .replace(/\?/g, '.') + '$'
        )
        return regex.test(relativePath)
      }
      return relativePath.includes(pattern)
    })
  }

  async createTypeScriptProgram() {
    // 创建适合类型分析的 TypeScript 配置
    const compilerOptions = this.createCompilerOptions()
    
    // 只包含 TypeScript 文件
    const tsFiles = this.sourceFiles.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
    
    if (tsFiles.length > 0) {
      this.program = ts.createProgram(tsFiles, compilerOptions)
      
      if (this.options.verbose) {
        console.log(`🔧  创建 TypeScript 程序，包含 ${tsFiles.length} 个文件`)
      }
    }
  }

  createCompilerOptions() {
    // 查找项目的 tsconfig.json
    const configPath = ts.findConfigFile(this.options.rootDir, ts.sys.fileExists, 'tsconfig.json')
    
    // 基础配置 - 适合类型分析的设置
    let options = {
      target: ts.ScriptTarget.ES2020,
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      allowJs: false,
      checkJs: false,
      declaration: false,
      outDir: undefined,
      rootDir: undefined,
      removeComments: false,
      noEmit: true,
      importHelpers: false,
      downlevelIteration: true,
      isolatedModules: false,
      
      // 类型检查配置
      strict: true,
      noImplicitAny: true,
      strictNullChecks: true,
      strictFunctionTypes: true,
      strictBindCallApply: true,
      strictPropertyInitialization: true,
      noImplicitThis: true,
      alwaysStrict: true,
      
      // 额外检查
      noUnusedLocals: false,        // 我们自己检查
      noUnusedParameters: false,    // 我们自己检查
      noImplicitReturns: true,
      noFallthroughCasesInSwitch: true,
      
      // 模块解析
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      
      // 路径映射
      baseUrl: this.options.rootDir,
      paths: {
        '@/*': ['src/*']
      },
      
      // 跳过库检查以提高性能
      skipLibCheck: true,
      skipDefaultLibCheck: true,
    }

    // 如果存在项目配置，合并关键设置
    if (configPath) {
      try {
        const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
        if (!configFile.error) {
          const parsedConfig = ts.parseJsonConfigFileContent(
            configFile.config,
            ts.sys,
            this.options.rootDir
          )
          
          // 合并配置，但保持我们的核心设置
          options = {
            ...options,
            ...parsedConfig.options,
            // 强制保持这些设置
            noEmit: true,
            skipLibCheck: true,
            skipDefaultLibCheck: true,
          }
        }
      } catch (error) {
        if (this.options.verbose) {
          console.warn('⚠️  读取 tsconfig.json 失败，使用默认配置')
        }
      }
    }

    return options
  }

  async analyzeTypeDefinitions() {
    if (!this.program) {
      // 没有 TypeScript 程序，直接分析文件
      for (const file of this.sourceFiles) {
        if (file.endsWith('.vue')) {
          await this.analyzeVueFile(file)
        }
      }
      return
    }

    // 分析 TypeScript 程序中的类型定义
    for (const sourceFile of this.program.getSourceFiles()) {
      if (this.isProjectFile(sourceFile.fileName)) {
        this.visitTypeDefinitions(sourceFile)
      }
    }

    // 分析 Vue 文件
    for (const file of this.sourceFiles) {
      if (file.endsWith('.vue')) {
        await this.analyzeVueFile(file)
      }
    }

    if (this.options.verbose) {
      console.log(`📊  发现 ${this.typeDefinitions.size} 个类型定义`)
    }
  }

  isProjectFile(fileName) {
    const normalizedPath = resolve(fileName).replace(/\\/g, '/')
    
    // 排除系统库和 node_modules
    if (normalizedPath.includes('node_modules') ||
        normalizedPath.includes('/lib.') ||
        normalizedPath.includes('typescript/lib')) {
      return false
    }
    
    // 检查是否是我们的源文件
    return this.sourceFiles.some(file => {
      return resolve(file).replace(/\\/g, '/') === normalizedPath
    })
  }

  visitTypeDefinitions(sourceFile) {
    const visit = (node) => {
      switch (node.kind) {
        case ts.SyntaxKind.InterfaceDeclaration:
          this.processInterfaceDeclaration(node, sourceFile)
          break
        case ts.SyntaxKind.TypeAliasDeclaration:
          this.processTypeAliasDeclaration(node, sourceFile)
          break
        case ts.SyntaxKind.EnumDeclaration:
          this.processEnumDeclaration(node, sourceFile)
          break
        case ts.SyntaxKind.ClassDeclaration:
          this.processClassDeclaration(node, sourceFile)
          break
      }
      
      ts.forEachChild(node, visit)
    }
    
    visit(sourceFile)
  }

  processInterfaceDeclaration(node, sourceFile) {
    const name = node.name.text
    if (this.shouldIgnoreType(name)) return

    const info = {
      name,
      type: 'interface',
      file: sourceFile.fileName,
      line: ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1,
      exported: this.hasExportModifier(node)
    }

    this.addTypeDefinition(name, info)
  }

  processTypeAliasDeclaration(node, sourceFile) {
    const name = node.name.text
    if (this.shouldIgnoreType(name)) return

    const info = {
      name,
      type: 'type',
      file: sourceFile.fileName,
      line: ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1,
      exported: this.hasExportModifier(node)
    }

    this.addTypeDefinition(name, info)
  }

  processEnumDeclaration(node, sourceFile) {
    const name = node.name.text
    if (this.shouldIgnoreType(name)) return

    const info = {
      name,
      type: 'enum',
      file: sourceFile.fileName,
      line: ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1,
      exported: this.hasExportModifier(node)
    }

    this.addTypeDefinition(name, info)
  }

  processClassDeclaration(node, sourceFile) {
    if (!node.name) return
    
    const name = node.name.text
    if (this.shouldIgnoreType(name)) return

    const info = {
      name,
      type: 'class',
      file: sourceFile.fileName,
      line: ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1,
      exported: this.hasExportModifier(node)
    }

    this.addTypeDefinition(name, info)
  }

  addTypeDefinition(name, info) {
    if (this.typeDefinitions.has(name)) {
      // 检测重复定义
      const existing = this.typeDefinitions.get(name)
      if (existing.file !== info.file) {
        // 真正的重复定义（不同文件）
        if (!this.duplicateTypes.has(name)) {
          this.duplicateTypes.set(name, [existing])
        }
        this.duplicateTypes.get(name).push(info)
      }
      // 同文件中的重复可能是接口合并，更新信息
    } else {
      this.typeDefinitions.set(name, info)
    }
  }

  hasExportModifier(node) {
    return node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) || false
  }

  shouldIgnoreType(typeName) {
    // 忽略内置类型
    const builtinTypes = [
      'string', 'number', 'boolean', 'object', 'undefined', 'null', 'void',
      'Array', 'Promise', 'Date', 'RegExp', 'Error', 'Function', 'Object',
      'Record', 'Partial', 'Required', 'Pick', 'Omit', 'Exclude', 'Extract',
      'NonNullable', 'Parameters', 'ReturnType', 'InstanceType'
    ]
    
    if (builtinTypes.includes(typeName)) return true

    // 检查用户定义的忽略模式
    return this.options.ignorePatterns.some(pattern => {
      if (pattern instanceof RegExp) {
        return pattern.test(typeName)
      }
      return typeName === pattern || typeName.includes(pattern)
    })
  }

  async analyzeVueFile(filePath) {
    try {
      const content = readFileSync(filePath, 'utf8')
      
      // 提取 Vue 文件中的 TypeScript 代码
      const scriptRegex = /<script[^>]*(?:\s+lang=["'](?:ts|typescript)["']|\s+setup)[^>]*>([\s\S]*?)<\/script>/gi
      let match
      
      while ((match = scriptRegex.exec(content)) !== null) {
        const scriptContent = match[1]
        
        // 创建临时的 TypeScript 源文件进行分析
        const sourceFile = ts.createSourceFile(
          filePath,
          scriptContent,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS
        )
        
        this.visitTypeDefinitions(sourceFile)
      }
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`⚠️  分析 Vue 文件失败 ${filePath}: ${error.message}`)
      }
    }
  }

  async analyzeTypeUsages() {
    if (!this.program) return

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
  }

  visitTypeUsages(sourceFile) {
    const visit = (node) => {
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        const typeName = node.typeName.text
        if (!this.shouldIgnoreType(typeName)) {
          this.addTypeUsage(typeName, {
            file: sourceFile.fileName,
            line: ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1
          })
        }
      }
      
      ts.forEachChild(node, visit)
    }
    
    visit(sourceFile)
  }

  addTypeUsage(typeName, usage) {
    if (!this.typeUsages.has(typeName)) {
      this.typeUsages.set(typeName, [])
    }
    this.typeUsages.get(typeName).push(usage)
  }

  async detectUnusedTypes() {
    for (const [typeName, typeInfo] of this.typeDefinitions) {
      const usages = this.typeUsages.get(typeName) || []
      
      // 过滤掉定义处的"使用"
      const realUsages = usages.filter(usage => {
        const isSameFile = resolve(usage.file) === resolve(typeInfo.file)
        const isNearDefinition = Math.abs(usage.line - typeInfo.line) <= 2
        return !(isSameFile && isNearDefinition)
      })

      // 如果没有真实使用且未导出，标记为未使用
      if (realUsages.length === 0 && !typeInfo.exported) {
        this.unusedTypes.add(typeName)
      }
    }

    if (this.options.verbose) {
      console.log(`🗑️  发现 ${this.unusedTypes.size} 个未使用类型`)
    }
  }

  async runTypeChecking() {
    if (!this.program) {
      if (this.options.verbose) {
        console.log('⚠️  无 TypeScript 程序，跳过类型检查')
      }
      return
    }

    const allDiagnostics = ts.getPreEmitDiagnostics(this.program)
    
    for (const diagnostic of allDiagnostics) {
      if (!diagnostic.file || !this.isProjectFile(diagnostic.file.fileName)) {
        continue
      }

      // 只处理真正的类型错误
      if (this.isRealTypeError(diagnostic)) {
        const issue = this.createIssueFromDiagnostic(diagnostic)
        
        if (diagnostic.category === ts.DiagnosticCategory.Error) {
          this.errors.push(issue)
        } else if (diagnostic.category === ts.DiagnosticCategory.Warning) {
          this.warnings.push(issue)
        }
      }
    }

    if (this.options.verbose) {
      console.log(`🚨  发现 ${this.errors.length} 个类型错误，${this.warnings.length} 个警告`)
    }
  }

  isRealTypeError(diagnostic) {
    // 基于错误代码判断是否是真实的类型错误
    const realErrorCodes = [
      2322, // Type 'X' is not assignable to type 'Y'
      2339, // Property 'X' does not exist on type 'Y'
      2345, // Argument of type 'X' is not assignable to parameter of type 'Y'
      2349, // This expression is not callable
      2531, // Object is possibly 'null'
      2532, // Object is possibly 'undefined'
      2571, // Object is of type 'unknown'
      2740, // Type 'X' is missing the following properties from type 'Y'
      2741, // Property 'X' is missing in type 'Y' but required in type 'Z'
    ]

    // 排除的配置相关错误
    const configErrorCodes = [
      2304, // Cannot find name (通常是全局 API)
      2307, // Cannot find module
      1343, // import.meta
      2732, // resolveJsonModule
      1259, // esModuleInterop
    ]

    if (configErrorCodes.includes(diagnostic.code)) {
      return false
    }

    return realErrorCodes.includes(diagnostic.code)
  }

  createIssueFromDiagnostic(diagnostic) {
    const messageText = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    let line = 0

    if (diagnostic.start !== undefined && diagnostic.file) {
      const position = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start)
      line = position.line + 1
    }

    return {
      file: diagnostic.file.fileName,
      line,
      code: `TS${diagnostic.code}`,
      message: messageText,
      severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning'
    }
  }

  generateReport() {
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
  }

  calculateHealthScore() {
    const totalTypes = this.typeDefinitions.size
    if (totalTypes === 0) return 100

    let score = 100
    
    // 未使用类型扣分
    const unusedRatio = this.unusedTypes.size / totalTypes
    score -= Math.min(40, unusedRatio * 50)
    
    // 重复定义扣分
    const duplicateRatio = this.duplicateTypes.size / totalTypes
    score -= Math.min(30, duplicateRatio * 40)

    return Math.max(0, Math.round(score))
  }

  calculateValidationScore() {
    if (this.errors.length === 0) return 100
    
    let score = 100
    
    // 错误扣分
    const criticalErrors = this.errors.filter(e => this.isCriticalError(e.code)).length
    const regularErrors = this.errors.length - criticalErrors
    
    score -= criticalErrors * 10
    score -= regularErrors * 5
    score -= Math.min(10, this.warnings.length * 1)

    return Math.max(0, Math.round(score))
  }

  isCriticalError(code) {
    const criticalCodes = ['TS2322', 'TS2339', 'TS2345', 'TS2531', 'TS2532', 'TS2571']
    return criticalCodes.includes(code)
  }

  generateSuggestions() {
    const suggestions = []

    if (this.errors.length > 0) {
      const criticalCount = this.errors.filter(e => this.isCriticalError(e.code)).length
      if (criticalCount > 0) {
        suggestions.push(`🔴  修复 ${criticalCount} 个关键类型错误`)
      }
      
      const regularCount = this.errors.length - criticalCount
      if (regularCount > 0) {
        suggestions.push(`⚠️  修复 ${regularCount} 个一般类型错误`)
      }
    }

    if (this.unusedTypes.size > 0) {
      suggestions.push(`🗑️  清理 ${this.unusedTypes.size} 个未使用的类型定义`)
    }

    if (this.duplicateTypes.size > 0) {
      suggestions.push(`⚠️  处理 ${this.duplicateTypes.size} 个重复的类型定义`)
      
      // 具体建议
      const duplicateNames = Array.from(this.duplicateTypes.keys())
      const apiTypes = duplicateNames.filter(n => /api|response|request/i.test(n))
      const formTypes = duplicateNames.filter(n => /form|field/i.test(n))
      const chartTypes = duplicateNames.filter(n => /chart|echarts|option/i.test(n))
      
      if (apiTypes.length > 0) {
        suggestions.push(`📝  建议将 API 相关类型统一到 src/types/api.ts`)
      }
      if (formTypes.length > 0) {
        suggestions.push(`📝  建议将表单相关类型统一到 src/types/form.ts`)
      }
      if (chartTypes.length > 0) {
        suggestions.push(`📊  建议将图表相关类型统一到 src/types/chart.ts`)
      }
    }

    if (suggestions.length === 0) {
      suggestions.push('🎉  类型系统状态良好！')
    }

    return suggestions
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