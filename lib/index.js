import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, relative, extname, resolve } from 'path'
import ts from 'typescript'

export class TypeAnalyzer {
  constructor(options = {}) {
    this.options = this.normalizeOptions(options)
    this.resetData()
  }

  normalizeOptions(options) {
    const defaultInclude = ['src/**/*.{ts,tsx,vue}']
    const defaultExclude = [
      'node_modules', 'dist', '.git', 'build', 'coverage',
      '**/*.d.ts', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'
    ]

    let include = defaultInclude
    if (options.include) {
      if (typeof options.include === 'string') {
        include = options.include.split(',').map(s => s.trim()).filter(Boolean)
      } else if (Array.isArray(options.include)) {
        include = options.include
      }
    }

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
    // 核心修复：使用 Map 来存储所有定义，按文件:行号:类型名组织
    this.allDefinitions = new Map() // key: "file:line:typeName", value: 定义信息
    this.typeDefinitions = new Map() // key: typeName, value: 第一个定义
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
      const srcDir = join(this.options.rootDir, 'src')
      const scanRoot = existsSync(srcDir) ? srcDir : this.options.rootDir
      
      this.sourceFiles = this.scanDirectory(scanRoot)
        .filter(file => this.isTypeScriptFile(file))
        .filter(file => this.shouldIncludeFile(file))

      if (this.options.verbose) {
        console.log(`📄  扫描到 ${this.sourceFiles.length} 个源文件`)
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
      
      if (file.endsWith('.d.ts') || 
          relativePath.includes('node_modules') ||
          /\.(test|spec)\.(ts|tsx)$/.test(file)) {
        return false
      }
      
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
      strict: false,
      allowJs: false,
      baseUrl: this.options.rootDir,
      paths: { '@/*': ['src/*'] },
      types: ['vite/client'],
      typeRoots: ['node_modules/@types'],
    }

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
            noEmit: true,
            skipLibCheck: true,
            skipDefaultLibCheck: true,
            types: [...(parsedConfig.options.types || []), 'vite/client'],
          }
        }
      }
    } catch (error) {
      // 使用默认配置
    }

    return defaultOptions
  }

  async analyzeTypeDefinitions() {
    // 第一阶段：收集所有定义
    if (this.program) {
      for (const sourceFile of this.program.getSourceFiles()) {
        if (this.isProjectFile(sourceFile.fileName)) {
          this.collectTypeDefinitions(sourceFile)
        }
      }
    }

    // 分析 Vue 文件
    for (const file of this.sourceFiles) {
      if (file.endsWith('.vue')) {
        await this.analyzeVueFile(file)
      }
    }

    // 第二阶段：分析重复定义
    this.analyzeForDuplicates()

    if (this.options.verbose) {
      console.log(`📊  发现 ${this.typeDefinitions.size} 个唯一类型定义`)
      console.log(`🔍  总计扫描了 ${this.allDefinitions.size} 个定义位置`)
      console.log(`🔄  检测到 ${this.duplicateTypes.size} 个重复类型`)
    }
  }

  isProjectFile(fileName) {
    try {
      const normalizedPath = this.normalizePath(fileName)
      
      if (normalizedPath.includes('node_modules') ||
          normalizedPath.includes('/lib.') ||
          normalizedPath.includes('typescript/lib')) {
        return false
      }
      
      return this.sourceFiles.some(file => {
        return this.normalizePath(file) === normalizedPath
      })
    } catch (error) {
      return false
    }
  }

  normalizePath(filePath) {
    try {
      return resolve(filePath).replace(/\\/g, '/')
    } catch (error) {
      return filePath.replace(/\\/g, '/')
    }
  }

  // 核心修复：简化的定义收集器
  collectTypeDefinitions(sourceFile) {
    const filePath = this.normalizePath(sourceFile.fileName)
    
    const visit = (node) => {
      if (!node) return

      let typeName = null
      let typeKind = null

      // 识别类型定义节点
      switch (node.kind) {
        case ts.SyntaxKind.InterfaceDeclaration:
          if (node.name && node.name.text) {
            typeName = node.name.text
            typeKind = 'interface'
          }
          break
        case ts.SyntaxKind.TypeAliasDeclaration:
          if (node.name && node.name.text) {
            typeName = node.name.text
            typeKind = 'type'
          }
          break
        case ts.SyntaxKind.EnumDeclaration:
          if (node.name && node.name.text) {
            typeName = node.name.text
            typeKind = 'enum'
          }
          break
        case ts.SyntaxKind.ClassDeclaration:
          if (node.name && node.name.text) {
            typeName = node.name.text
            typeKind = 'class'
          }
          break
      }

      // 如果找到了类型定义
      if (typeName && typeKind && !this.shouldIgnoreType(typeName)) {
        const line = this.getNodeLine(sourceFile, node)
        const exported = this.hasExportModifier(node)
        
        // 创建绝对唯一的key：文件路径 + 行号 + 类型名
        const uniqueKey = `${filePath}:${line}:${typeName}`
        
        const definition = {
          name: typeName,
          type: typeKind,
          file: filePath,
          line: line,
          exported: exported
        }

        // 只添加一次 - 绝对防重复
        if (!this.allDefinitions.has(uniqueKey)) {
          this.allDefinitions.set(uniqueKey, definition)
          
          if (this.options.verbose) {
            console.log(`📝  发现类型定义: ${typeName} at ${this.getRelativePath(filePath)}:${line}`)
          }
        }
      }

      // 继续遍历子节点
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  async analyzeVueFile(filePath) {
    try {
      const content = readFileSync(filePath, 'utf8')
      const scriptRegex = /<script[^>]*(?:\s+lang=["'](?:ts|typescript)["']|\s+setup)[^>]*>([\s\S]*?)<\/script>/gi
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
          
          this.collectTypeDefinitions(sourceFile)
        } catch (error) {
          if (this.options.verbose) {
            console.warn(`Vue script 块解析失败: ${filePath}`, error.message)
          }
          continue
        }
      }
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`Vue 文件分析失败: ${filePath}`, error.message)
      }
    }
  }

  // 核心修复：全新的重复分析逻辑
  analyzeForDuplicates() {
    // 按类型名分组所有定义
    const typeGroups = new Map()
    
    for (const [uniqueKey, definition] of this.allDefinitions) {
      const typeName = definition.name
      
      if (!typeGroups.has(typeName)) {
        typeGroups.set(typeName, [])
      }
      typeGroups.get(typeName).push(definition)
    }

    // 分析每个类型组
    for (const [typeName, definitions] of typeGroups) {
      // 记录第一个定义作为主定义
      this.typeDefinitions.set(typeName, definitions[0])
      
      // 如果有多个定义，检查是否真的重复
      if (definitions.length > 1) {
        // 按文件:行号去重
        const uniqueLocations = new Map()
        
        for (const def of definitions) {
          const locationKey = `${def.file}:${def.line}`
          if (!uniqueLocations.has(locationKey)) {
            uniqueLocations.set(locationKey, def)
          }
        }
        
        // 只有真正有多个不同位置的定义才算重复
        if (uniqueLocations.size > 1) {
          this.duplicateTypes.set(typeName, Array.from(uniqueLocations.values()))
          
          if (this.options.verbose) {
            console.log(`🔄  发现重复类型: ${typeName} (${uniqueLocations.size} 个位置)`)
            for (const def of uniqueLocations.values()) {
              console.log(`    - ${this.getRelativePath(def.file)}:${def.line} (${def.type})`)
            }
          }
        }
      }
    }
  }

  getNodeLine(sourceFile, node) {
    try {
      let start = 0
      
      if (typeof node.getStart === 'function') {
        start = node.getStart(sourceFile)
      } else if (typeof node.getFullStart === 'function') {
        start = node.getFullStart()
      } else if (node.pos !== undefined) {
        start = node.pos
      }
      
      const position = ts.getLineAndCharacterOfPosition(sourceFile, start)
      return position.line + 1
    } catch (error) {
      try {
        if (node.name && typeof node.name.getStart === 'function') {
          const nameStart = node.name.getStart(sourceFile)
          const position = ts.getLineAndCharacterOfPosition(sourceFile, nameStart)
          return position.line + 1
        }
      } catch (e) {
        // 最后备用
      }
      return 1
    }
  }

  hasExportModifier(node) {
    try {
      return node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) || false
    } catch (error) {
      return false
    }
  }

  shouldIgnoreType(typeName) {
    try {
      const builtinTypes = [
        'string', 'number', 'boolean', 'object', 'undefined', 'null', 'void',
        'Array', 'Promise', 'Date', 'RegExp', 'Error', 'Function',
        'Record', 'Partial', 'Required', 'Pick', 'Omit'
      ]
      
      if (builtinTypes.includes(typeName)) return true

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
              file: this.normalizePath(sourceFile.fileName),
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
        if (this.isGlobalTypeExtension(typeName, typeInfo)) {
          continue
        }
        
        const usages = this.typeUsages.get(typeName) || []
        
        const realUsages = usages.filter(usage => {
          try {
            const isSameFile = usage.file === typeInfo.file
            const isNearDefinition = Math.abs(usage.line - typeInfo.line) <= 2
            return !(isSameFile && isNearDefinition)
          } catch (error) {
            return true
          }
        })

        const isInVueFile = typeInfo.file.endsWith('.vue')
        const isExported = typeInfo.exported
        
        if (isExported || isInVueFile || realUsages.length > 0) {
          continue
        }
        
        if (this.isCommonType(typeName)) {
          continue
        }

        this.unusedTypes.add(typeName)
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

  isGlobalTypeExtension(typeName, typeInfo) {
    try {
      const content = readFileSync(typeInfo.file, 'utf8')
      
      if (content.includes('declare global')) {
        const globalBlockRegex = /declare\s+global\s*\{[\s\S]*?\}/g
        let match
        
        while ((match = globalBlockRegex.exec(content)) !== null) {
          const globalBlock = match[0]
          if (globalBlock.includes(`interface ${typeName}`) || 
              globalBlock.includes(`type ${typeName}`) ||
              globalBlock.includes(`namespace ${typeName}`)) {
            return true
          }
        }
      }
      
      const globalTypeNames = ['Window', 'Document', 'Global', 'NodeJS', 'ComponentCustomProperties']
      return globalTypeNames.includes(typeName)
    } catch (error) {
      return false
    }
  }

  isCommonType(typeName) {
    const commonTypePatterns = [
      /Props$/i, /Emits$/i, /Slots$/i, /Expose$/i,
      /Config$/i, /Options$/i, /State$/i, /Data$/i,
      /Event$/i, /Handler$/i, /Callback$/i,
    ]
    
    return commonTypePatterns.some(pattern => pattern.test(typeName))
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
    const code = diagnostic.code
    const messageText = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    
    const skipCodes = [
      2304, 2307, 1343, 2732, 1259, 7016,
    ]
    
    if (skipCodes.includes(code)) {
      return false
    }
    
    if (messageText.includes('ImportMeta') || 
        messageText.includes('import.meta') ||
        messageText.includes('glob') ||
        messageText.includes('env')) {
      return false
    }
    
    if (messageText.includes('unknown') && 
        messageText.includes('Promise<unknown>') &&
        messageText.includes('import.meta.glob')) {
      return false
    }
    
    const realErrorCodes = [2322, 2345, 2531, 2532, 2571]
    
    if ([2322, 2345].includes(code)) {
      if (messageText.includes('import.meta') ||
          messageText.includes('Promise<unknown>') ||
          messageText.includes('unknown') && messageText.includes('{}')) {
        return false
      }
    }
    
    return realErrorCodes.includes(code)
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
        file: diagnostic.file ? this.normalizePath(diagnostic.file.fileName) : '',
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

  getRelativePath(filePath) {
    try {
      return relative(this.options.rootDir, filePath).replace(/\\/g, '/')
    } catch (error) {
      return filePath
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
          duplicates: this.generateCleanDuplicateReport(),
          errors: this.errors.map(err => ({...err, file: this.getRelativePath(err.file)})),
          warnings: this.warnings.map(warn => ({...warn, file: this.getRelativePath(warn.file)})),
          typeDefinitions: Object.fromEntries(
            Array.from(this.typeDefinitions.entries()).map(([key, value]) => [
              key, 
              { ...value, file: this.getRelativePath(value.file) }
            ])
          ),
          typeUsages: Object.fromEntries(
            Array.from(this.typeUsages.entries()).map(([key, usages]) => [
              key,
              usages.map(usage => ({ ...usage, file: this.getRelativePath(usage.file) }))
            ])
          ),
        },
        suggestions: this.generateSuggestions(),
      }
    } catch (error) {
      throw new Error(`生成报告失败: ${error.message}`)
    }
  }

  // 核心修复：生成干净的重复报告
  generateCleanDuplicateReport() {
    const cleanReport = {}
    
    for (const [typeName, definitions] of this.duplicateTypes) {
      const cleanDefinitions = definitions.map(def => ({
        file: this.getRelativePath(def.file),
        line: def.line,
        type: def.type
      }))
      
      // 确保没有完全重复的条目
      const uniqueDefinitions = []
      const seen = new Set()
      
      for (const def of cleanDefinitions) {
        const key = `${def.file}:${def.line}:${def.type}`
        if (!seen.has(key)) {
          seen.add(key)
          uniqueDefinitions.push(def)
        }
      }
      
      // 只有真正有多个位置才添加到报告
      if (uniqueDefinitions.length > 1) {
        cleanReport[typeName] = uniqueDefinitions
      }
    }
    
    return cleanReport
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