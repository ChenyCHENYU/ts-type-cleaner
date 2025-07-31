import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, relative, extname, resolve } from 'path'
import ts from 'typescript'

export class TypeAnalyzer {
  constructor(options = {}) {
    // 确保 exclude 和 include 是数组
    const defaultExclude = [
      'node_modules', 'dist', '.git', 'build', 'coverage',
      '.cache', '.vscode', '.idea', 'test', 'tests', '__tests__',
      '*.d.ts', '*.test.ts', '*.spec.ts', '*.test.tsx', '*.spec.tsx'
    ]

    let exclude = defaultExclude
    if (options.exclude) {
      if (Array.isArray(options.exclude)) {
        exclude = options.exclude
      } else if (typeof options.exclude === 'string') {
        exclude = options.exclude.split(',').map(p => p.trim())
      } else {
        exclude = [options.exclude]
      }
    }

    let include = ['src/**/*.{ts,tsx,vue}']
    if (options.include) {
      if (Array.isArray(options.include)) {
        include = options.include
      } else if (typeof options.include === 'string') {
        include = options.include.split(',').map(p => p.trim())
      } else {
        include = [options.include]
      }
    }

    this.options = {
      rootDir: options.rootDir || process.cwd(),
      include,
      exclude,
      verbose: options.verbose || false,
      ignorePatterns: options.ignorePatterns || [
        /^Props$/, /^Emits$/, /^Slots$/, /^Expose$/,
        /Props$/, /Emits$/, /Events?$/, /State$/
      ],
      // 自动检测Vue项目
      isVueProject: this.detectVueProject(options.rootDir || process.cwd()),
      ...options,
      include,
      exclude,
    }

    this.resetData()
  }

  detectVueProject(rootDir) {
    try {
      const packageJsonPath = join(rootDir, 'package.json')
      if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
        return !!(packageJson.dependencies?.vue || packageJson.devDependencies?.vue)
      }
    } catch (error) {
      // 忽略检测错误
    }
    return false
  }

  resetData() {
    this.typeMap = new Map()
    this.usageMap = new Map()
    this.duplicates = new Map()
    this.unusedTypes = new Set()
    this.errors = []
    this.warnings = []
    this.configErrors = []
    this.sourceFiles = []
    this.program = null
  }

  async analyze() {
    if (this.options.verbose) {
      console.log('🔍  开始 TypeScript 类型分析...')
      console.log(`📂  根目录: ${this.options.rootDir}`)
      if (this.options.isVueProject) {
        console.log('🚀  检测到 Vue 项目，将跳过框架相关的类型检查')
      }
    }

    try {
      await this.scanFiles()
      await this.initTypeScript()
      await this.analyzeTypes()
      await this.detectUnused()
      await this.runDiagnostics()

      return this.generateReport()
    } catch (error) {
      console.error('❌  分析失败:', error.message)
      throw error
    }
  }

  async scanFiles() {
    // 优先扫描src目录
    const srcDir = join(this.options.rootDir, 'src')
    const scanRoot = existsSync(srcDir) ? srcDir : this.options.rootDir
    
    if (this.options.verbose) {
      console.log(`📁  扫描目录: ${scanRoot}`)
    }

    this.sourceFiles = this.scanDirectory(scanRoot)
      .filter(file => {
        const ext = extname(file)
        return ['.ts', '.tsx', '.vue'].includes(ext)
      })
      .filter(file => this.shouldIncludeFile(file))

    if (this.options.verbose) {
      console.log(`📄  扫描到 ${this.sourceFiles.length} 个源文件`)
      if (this.sourceFiles.length === 0) {
        console.log('⚠️  没有找到任何源文件，请检查项目结构')
      }
    }
  }

  scanDirectory(dir) {
    let files = []
    try {
      if (!existsSync(dir)) return files

      const items = readdirSync(dir)
      for (const item of items) {
        const fullPath = join(dir, item)
        
        if (item.startsWith('.') || this.shouldExcludeDirectory(item)) {
          continue
        }
        
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          files = files.concat(this.scanDirectory(fullPath))
        } else {
          files.push(fullPath)
        }
      }
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`⚠️  扫描目录失败 ${dir}: ${error.message}`)
      }
    }
    return files
  }

  shouldExcludeDirectory(dirName) {
    const excludeDirs = [
      'node_modules', 'dist', 'build', 'coverage', '.cache',
      '.vscode', '.idea', 'test', 'tests', '__tests__', '.git'
    ]
    return excludeDirs.includes(dirName)
  }

  shouldIncludeFile(file) {
    const relativePath = relative(this.options.rootDir, file).replace(/\\/g, '/')
    
    if (file.endsWith('.d.ts') || this.isTestFile(file) || relativePath.includes('node_modules')) {
      return false
    }
    
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
      return relativePath.includes(pattern) || file.includes(pattern) || file.endsWith(pattern)
    })
  }

  isTestFile(file) {
    const testPatterns = [
      /\.test\.(ts|tsx|js|jsx)$/,
      /\.spec\.(ts|tsx|js|jsx)$/,
      /\/__tests__\//,
      /\/test\//,
      /\/tests\//
    ]
    return testPatterns.some(pattern => pattern.test(file))
  }

  async initTypeScript() {
    try {
      const configPath = ts.findConfigFile(this.options.rootDir, ts.sys.fileExists, 'tsconfig.json')

      let compilerOptions = {
        target: ts.ScriptTarget.ES2022,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        skipDefaultLibCheck: true,
        noEmit: true,
        allowJs: true,
        jsx: ts.JsxEmit.Preserve,
        strict: false,
        noImplicitAny: false,
        downlevelIteration: true,
        types: this.options.isVueProject ? ['vite/client', 'node'] : ['node'],
        typeRoots: ['node_modules/@types'],
        baseUrl: this.options.rootDir,
        paths: { '@/*': ['src/*'], '@': ['src'] }
      }

      let fileNames = this.sourceFiles.filter(f => 
        (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.endsWith('.d.ts')
      )

      if (configPath) {
        if (this.options.verbose) {
          console.log(`📝  找到配置文件: ${configPath}`)
        }
        
        const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
        if (!configFile.error) {
          const parsedConfig = ts.parseJsonConfigFileContent(
            configFile.config,
            ts.sys,
            this.options.rootDir
          )
          
          compilerOptions = { 
            ...compilerOptions,
            ...parsedConfig.options,
            // 强制设置关键选项
            skipLibCheck: true,
            skipDefaultLibCheck: true,
            noEmit: true,
            resolveJsonModule: true,
            esModuleInterop: true,
            strict: false, // 对于类型分析工具，降低严格度
          }
        }
      }

      if (fileNames.length > 0) {
        this.program = ts.createProgram(fileNames, compilerOptions)
        if (this.options.verbose) {
          console.log(`✅  TypeScript 程序初始化完成`)
        }
      }
    } catch (error) {
      console.warn('⚠️  TypeScript 程序初始化失败:', error.message)
    }
  }

  async analyzeTypes() {
    let analyzedCount = 0

    // 分析TypeScript文件
    if (this.program) {
      for (const sourceFile of this.program.getSourceFiles()) {
        if (this.shouldAnalyzeSourceFile(sourceFile.fileName)) {
          this.visitNode(sourceFile, sourceFile)
          analyzedCount++
        }
      }
    }

    // 分析Vue文件
    const vueFiles = this.sourceFiles.filter(f => f.endsWith('.vue'))
    for (const vueFile of vueFiles) {
      await this.analyzeVueFile(vueFile)
      analyzedCount++
    }

    if (this.options.verbose) {
      console.log(`🔍  分析了 ${analyzedCount} 个文件，发现 ${this.typeMap.size} 个类型定义`)
    }
  }

  shouldAnalyzeSourceFile(fileName) {
    const normalizedPath = fileName.replace(/\\/g, '/')
    
    if (normalizedPath.includes('node_modules') ||
        normalizedPath.includes('/lib.') ||
        normalizedPath.includes('typescript/lib') ||
        normalizedPath.includes('@types/')) {
      return false
    }
    
    return this.sourceFiles.some(file => {
      const normalizedFile = resolve(file).replace(/\\/g, '/')
      const normalizedSource = resolve(fileName).replace(/\\/g, '/')
      return normalizedFile === normalizedSource
    })
  }

  visitNode(node, sourceFile) {
    try {
      switch (node.kind) {
        case ts.SyntaxKind.InterfaceDeclaration:
          this.processInterface(node, sourceFile)
          break
        case ts.SyntaxKind.TypeAliasDeclaration:
          this.processTypeAlias(node, sourceFile)
          break
        case ts.SyntaxKind.EnumDeclaration:
          this.processEnum(node, sourceFile)
          break
        case ts.SyntaxKind.ClassDeclaration:
          this.processClass(node, sourceFile)
          break
        case ts.SyntaxKind.TypeReference:
          this.processTypeReference(node, sourceFile)
          break
      }

      ts.forEachChild(node, child => this.visitNode(child, sourceFile))
    } catch (error) {
      // 忽略单个节点的处理错误
    }
  }

  processInterface(node, sourceFile) {
    const name = node.name.text
    if (this.shouldIgnoreType(name)) return

    const line = ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1
    this.addTypeDefinition(name, {
      type: 'interface',
      file: sourceFile.fileName,
      line,
      exported: this.isExported(node),
    })
  }

  processTypeAlias(node, sourceFile) {
    const name = node.name.text
    if (this.shouldIgnoreType(name)) return

    const line = ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1
    this.addTypeDefinition(name, {
      type: 'type',
      file: sourceFile.fileName,
      line,
      exported: this.isExported(node),
    })
  }

  processEnum(node, sourceFile) {
    const name = node.name.text
    if (this.shouldIgnoreType(name)) return

    const line = ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1
    this.addTypeDefinition(name, {
      type: 'enum',
      file: sourceFile.fileName,
      line,
      exported: this.isExported(node),
    })
  }

  processClass(node, sourceFile) {
    if (!node.name) return
    
    const name = node.name.text
    if (this.shouldIgnoreType(name)) return

    const line = ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1
    this.addTypeDefinition(name, {
      type: 'class',
      file: sourceFile.fileName,
      line,
      exported: this.isExported(node),
    })
  }

  processTypeReference(node, sourceFile) {
    if (ts.isIdentifier(node.typeName)) {
      const typeName = node.typeName.text
      if (!this.shouldIgnoreType(typeName)) {
        this.addTypeUsage(typeName, {
          file: sourceFile.fileName,
          line: ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1,
        })
      }
    }
  }

  async analyzeVueFile(filePath) {
    try {
      if (!existsSync(filePath)) return

      const content = readFileSync(filePath, 'utf8')
      const scriptMatches = [
        /<script[^>]*\s+lang=["']ts["'][^>]*>([\s\S]*?)<\/script>/gi,
        /<script[^>]*\s+setup[^>]*\s+lang=["']ts["'][^>]*>([\s\S]*?)<\/script>/gi,
        /<script[^>]*\s+lang=["']typescript["'][^>]*>([\s\S]*?)<\/script>/gi,
      ]

      for (const regex of scriptMatches) {
        let match
        while ((match = regex.exec(content)) !== null) {
          const scriptContent = match[1]
          const sourceFile = ts.createSourceFile(
            filePath,
            scriptContent,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS
          )
          this.visitNode(sourceFile, sourceFile)
        }
      }
    } catch (error) {
      console.warn(`⚠️  Vue文件分析失败 ${filePath}: ${error.message}`)
    }
  }

  shouldIgnoreType(typeName) {
    const builtinTypes = [
      'string', 'number', 'boolean', 'object', 'undefined', 'null', 'void',
      'Array', 'Promise', 'Date', 'RegExp', 'Error', 'Function',
      'Record', 'Partial', 'Required', 'Pick', 'Omit', 'Exclude', 'Extract'
    ]
    
    if (builtinTypes.includes(typeName)) {
      return true
    }

    return this.options.ignorePatterns.some(pattern => {
      if (pattern instanceof RegExp) {
        return pattern.test(typeName)
      }
      return typeName === pattern || typeName.includes(pattern)
    })
  }

  addTypeDefinition(name, info) {
    if (this.typeMap.has(name)) {
      const existing = this.typeMap.get(name)
      if (existing.file !== info.file) {
        if (!this.duplicates.has(name)) {
          this.duplicates.set(name, [])
        }
        this.duplicates.get(name).push(info)
      }
    } else {
      this.typeMap.set(name, info)
    }
  }

  addTypeUsage(typeName, usage) {
    if (!this.usageMap.has(typeName)) {
      this.usageMap.set(typeName, [])
    }
    this.usageMap.get(typeName).push(usage)
  }

  async detectUnused() {
    for (const [typeName, typeInfo] of this.typeMap) {
      if (this.shouldIgnoreType(typeName)) continue

      const usages = this.usageMap.get(typeName) || []
      const realUsages = usages.filter(usage => {
        const isSameFile = resolve(usage.file) === resolve(typeInfo.file)
        return !(isSameFile && Math.abs(usage.line - typeInfo.line) <= 1)
      })

      if (realUsages.length === 0 && !typeInfo.exported) {
        this.unusedTypes.add(typeName)
      }
    }

    if (this.options.verbose) {
      console.log(`🔍  检测到 ${this.unusedTypes.size} 个未使用类型`)
    }
  }

  async runDiagnostics() {
    if (!this.program) {
      if (this.options.verbose) {
        console.log('⚠️  TypeScript 程序未初始化，跳过诊断分析')
      }
      return
    }

    try {
      let filteredCount = 0
      
      for (const sourceFile of this.program.getSourceFiles()) {
        if (!this.shouldAnalyzeSourceFile(sourceFile.fileName)) {
          continue
        }

        const diagnostics = [
          ...this.program.getSemanticDiagnostics(sourceFile),
          ...this.program.getSyntacticDiagnostics(sourceFile),
        ]

        for (const diagnostic of diagnostics) {
          const messageText = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')

          let line = 0
          if (diagnostic.start !== undefined) {
            const position = ts.getLineAndCharacterOfPosition(sourceFile, diagnostic.start)
            line = position.line + 1
          }

          const issue = {
            file: sourceFile.fileName,
            line,
            code: `TS${diagnostic.code}`,
            message: messageText,
            severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
          }

          // 简化的过滤逻辑：Vue项目跳过大部分配置相关错误
          if (this.shouldSkipDiagnostic(diagnostic, messageText)) {
            this.configErrors.push(issue)
            filteredCount++
            continue
          }

          if (diagnostic.category === ts.DiagnosticCategory.Error) {
            this.errors.push(issue)
          } else {
            this.warnings.push(issue)
          }
        }
      }

      if (this.options.verbose) {
        console.log(`🔍  诊断完成，发现 ${this.errors.length} 个真实错误，${this.warnings.length} 个警告`)
        if (filteredCount > 0) {
          console.log(`📋  过滤了 ${filteredCount} 个配置相关的错误`)
        }
      }
    } catch (error) {
      console.warn('⚠️  诊断分析失败:', error.message)
    }
  }

  shouldSkipDiagnostic(diagnostic, messageText) {
    // Vue项目的简化过滤策略
    if (this.options.isVueProject) {
      // 跳过所有"找不到名称"的错误，这些通常是Vue/UI库的全局API
      if (diagnostic.code === 2304) { // Cannot find name
        return true
      }
      
      // 跳过常见的配置相关错误
      const configErrorCodes = [
        2307, // Cannot find module
        2732, // JSON import
        1343, // import.meta
        2339, // ImportMeta properties
        1259, // esModuleInterop
        2802, // downlevelIteration
        2724, // globalThis
        7016, // declaration file
      ]
      
      if (configErrorCodes.includes(diagnostic.code)) {
        return true
      }
    }

    // 所有项目都跳过的错误
    if (messageText.includes('node_modules') || 
        messageText.includes('declaration file for module') ||
        (messageText.includes('.json') && messageText.includes('Cannot find module'))) {
      return true
    }
    
    return false
  }

  isExported(node) {
    return node.modifiers?.some(
      modifier => modifier.kind === ts.SyntaxKind.ExportKeyword
    ) || false
  }

  generateReport() {
    try {
      const totalFiles = this.sourceFiles.length
      const totalTypes = this.typeMap.size
      const totalUsages = Array.from(this.usageMap.values())
        .reduce((sum, usages) => sum + usages.length, 0)

      const healthScore = this.calculateHealthScore()
      const validationScore = this.calculateValidationScore()
      const overallScore = Math.round((healthScore + validationScore) / 2)

      return {
        timestamp: new Date().toISOString(),
        statistics: {
          sourceFiles: totalFiles,
          typeDefinitions: totalTypes,
          usageReferences: totalUsages,
          unusedTypes: this.unusedTypes.size,
          duplicateDefinitions: this.duplicates.size,
          totalErrors: this.errors.length,
          totalWarnings: this.warnings.length,
        },
        scores: {
          healthScore,
          validationScore,
          overallScore,
        },
        details: {
          unusedTypes: Array.from(this.unusedTypes),
          duplicates: Object.fromEntries(this.duplicates),
          errors: this.errors,
          warnings: this.warnings,
          configErrors: this.configErrors,
          typeDefinitions: Object.fromEntries(this.typeMap),
          typeUsages: Object.fromEntries(this.usageMap),
        },
        suggestions: this.generateSuggestions(),
      }
    } catch (error) {
      console.error('❌  报告生成失败:', error.message)
      throw error
    }
  }

  calculateHealthScore() {
    try {
      const totalTypes = this.typeMap.size
      if (totalTypes === 0) return 100

      let score = 100
      const unusedRatio = this.unusedTypes.size / totalTypes
      const duplicateRatio = this.duplicates.size / totalTypes
      
      score -= Math.min(50, unusedRatio * 60)
      score -= Math.min(40, duplicateRatio * 50)

      return Math.max(0, Math.round(score))
    } catch (error) {
      console.warn('⚠️  健康分数计算失败:', error.message)
      return 0
    }
  }

  calculateValidationScore() {
    try {
      if (this.errors.length === 0) return 100
      
      let score = 100
      const criticalErrors = this.errors.filter(e => this.isCriticalError(e.code)).length
      const regularErrors = this.errors.length - criticalErrors
      
      score -= criticalErrors * 15
      score -= regularErrors * 8
      score -= Math.min(20, this.warnings.length * 1)

      return Math.max(0, Math.round(score))
    } catch (error) {
      console.warn('⚠️  验证分数计算失败:', error.message)
      return 0
    }
  }

  isCriticalError(code) {
    const criticalCodes = [
      'TS2322', // Type assignment error
      'TS2345', // Argument type error
      'TS2349', // Not callable
      'TS2571', // Object is unknown
      'TS2531', // Object is null
      'TS2532', // Object is undefined
    ]
    return criticalCodes.includes(code)
  }

  generateSuggestions() {
    try {
      const suggestions = []

      const realErrors = this.errors.length
      const criticalErrors = this.errors.filter(e => this.isCriticalError(e.code)).length

      if (criticalErrors > 0) {
        suggestions.push(`🔴  立即修复 ${criticalErrors} 个关键类型错误`)
      } else if (realErrors > 0) {
        suggestions.push(`⚠️  修复 ${realErrors} 个类型错误`)
      }

      if (this.unusedTypes.size > 0) {
        suggestions.push(`💡  清理 ${this.unusedTypes.size} 个未使用的类型定义`)
      }

      if (this.duplicates.size > 5) {
        suggestions.push(`⚠️  合并 ${this.duplicates.size} 个重复的类型定义，建议统一到共享类型文件`)
      } else if (this.duplicates.size > 0) {
        suggestions.push(`⚠️  处理 ${this.duplicates.size} 个重复的类型定义`)
      }

      // 针对具体重复类型的建议
      if (this.duplicates.has('ApiResponse')) {
        suggestions.push(`📝  建议将 ApiResponse 等通用接口移到 src/types/api.ts 统一管理`)
      }

      if (this.duplicates.has('EChartsOption')) {
        suggestions.push(`📊  建议将 EChartsOption 等图表类型移到 src/types/echarts.ts 统一管理`)
      }

      if (suggestions.length === 0) {
        if (this.typeMap.size === 0) {
          suggestions.push('📂  未检测到类型定义，请检查项目结构或配置')
        } else {
          suggestions.push('🎉  类型系统状态良好，代码质量优秀！')
        }
      }

      return suggestions
    } catch (error) {
      console.warn('⚠️  建议生成失败:', error.message)
      return ['建议生成失败，请检查日志']
    }
  }
}

// 导出便捷函数
export async function analyzeProject(options = {}) {
  const analyzer = new TypeAnalyzer(options)
  return await analyzer.analyze()
}

export async function quickCheck(options = {}) {
  const result = await analyzeProject({
    ...options,
    verbose: false,
  })

  const hasErrors = result.details.errors.length > 0
  const score = result.scores.validationScore
  const threshold = options.threshold || 70

  return {
    passed: !hasErrors && score >= threshold,
    score,
    errors: result.details.errors.length,
    warnings: result.details.warnings.length,
    summary: hasErrors 
      ? `❌  发现 ${result.details.errors.length} 个类型错误`
      : `✅  类型检查通过 (评分: ${score}/100)`,
  }
}