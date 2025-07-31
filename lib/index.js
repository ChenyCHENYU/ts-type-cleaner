import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, relative, extname, resolve, sep } from 'path'
import ts from 'typescript'

export class TypeAnalyzer {
  constructor(options = {}) {
    // 确保 exclude 是数组
    const defaultExclude = [
      'node_modules', 
      'dist', 
      '.git', 
      'build', 
      'coverage',
      '.cache',
      '.vscode',
      '.idea',
      'test',
      'tests',
      '__tests__',
      '*.d.ts',
      '*.test.ts',
      '*.spec.ts',
      '*.test.tsx',
      '*.spec.tsx'
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

    // 确保 include 是数组
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
      ...options,
      // 确保这些关键选项不被覆盖
      include,
      exclude,
    }

    this.resetData()
  }

  resetData() {
    this.typeMap = new Map()
    this.usageMap = new Map()
    this.duplicates = new Map() // 改为Map来存储重复定义的详细信息
    this.unusedTypes = new Set()
    this.errors = []
    this.warnings = []
    this.configErrors = [] // 新增：存储被过滤的配置相关错误
    this.sourceFiles = []
    this.program = null
  }

  async analyze() {
    if (this.options.verbose) {
      console.log('🔍  开始 TypeScript 类型分析...')
      console.log(`📂  根目录: ${this.options.rootDir}`)
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
    // 优化：默认扫描src目录，如果src不存在则扫描整个项目
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
        console.log(`    根目录: ${this.options.rootDir}`)
        console.log(`    扫描目录: ${scanRoot}`)
      } else {
        console.log('📋  找到的文件:')
        this.sourceFiles.slice(0, 5).forEach(file => {
          console.log(`    ${relative(this.options.rootDir, file)}`)
        })
        if (this.sourceFiles.length > 5) {
          console.log(`    ... 还有 ${this.sourceFiles.length - 5} 个文件`)
        }
      }
    }
  }

  scanDirectory(dir) {
    let files = []
    try {
      if (!existsSync(dir)) {
        if (this.options.verbose) {
          console.log(`⚠️  目录不存在: ${dir}`)
        }
        return files
      }

      const items = readdirSync(dir)
      for (const item of items) {
        const fullPath = join(dir, item)
        
        // 跳过隐藏文件和目录
        if (item.startsWith('.')) {
          continue
        }
        
        // 跳过常见的非源码目录
        if (this.shouldExcludeDirectory(item)) {
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
      'node_modules', 
      'dist', 
      'build', 
      'coverage',
      '.cache',
      '.vscode',
      '.idea',
      'test',
      'tests',
      '__tests__',
      '.git',
      '.svn',
      '.hg'
    ]
    return excludeDirs.includes(dirName)
  }

  shouldIncludeFile(file) {
    const absolutePath = resolve(file)
    const relativePath = relative(this.options.rootDir, file).replace(/\\/g, '/')
    
    // 排除 .d.ts 文件
    if (file.endsWith('.d.ts')) {
      return false
    }
    
    // 排除测试文件
    if (this.isTestFile(file)) {
      return false
    }
    
    // 排除 node_modules
    if (relativePath.includes('node_modules')) {
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
      
      return relativePath.includes(pattern) || 
             file.includes(pattern) ||
             file.endsWith(pattern)
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
      // 查找tsconfig.json
      const configPath = ts.findConfigFile(
        this.options.rootDir,
        ts.sys.fileExists,
        'tsconfig.json'
      )

      let compilerOptions = {
        target: ts.ScriptTarget.ES2022, // 提高目标版本
        lib: ['ES2022', 'DOM', 'DOM.Iterable'], // 添加必要的库
        module: ts.ModuleKind.ESNext, // 确保支持 import.meta
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
        downlevelIteration: true, // 支持迭代器
        types: ['vite/client', 'node'], // 添加Vite类型
        typeRoots: ['node_modules/@types'],
        baseUrl: this.options.rootDir,
        paths: {
          '@/*': ['src/*'],
          '@': ['src'],
        }
      }

      // 只包含TypeScript文件，Vue文件单独处理
      let fileNames = this.sourceFiles.filter(f => 
        (f.endsWith('.ts') || f.endsWith('.tsx')) && 
        !f.endsWith('.d.ts')
      )

      if (this.options.verbose) {
        console.log(`🔧  准备分析 ${fileNames.length} 个 TypeScript 文件`)
      }

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
          
          // 智能合并配置，优先使用项目配置但确保关键设置
          const projectOptions = parsedConfig.options
          compilerOptions = { 
            ...compilerOptions, // 我们的基础配置
            ...projectOptions, // 项目配置
            // 强制设置这些以确保工具正常工作
            skipLibCheck: true,
            skipDefaultLibCheck: true,
            noEmit: true,
            resolveJsonModule: true,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
            downlevelIteration: true,
            // 确保支持现代JS特性
            target: projectOptions.target || ts.ScriptTarget.ES2022,
            lib: projectOptions.lib || ['ES2022', 'DOM', 'DOM.Iterable'],
            module: projectOptions.module || ts.ModuleKind.ESNext,
            // 保持项目的路径配置
            baseUrl: projectOptions.baseUrl || this.options.rootDir,
            paths: projectOptions.paths || { '@/*': ['src/*'], '@': ['src'] },
          }

          if (this.options.verbose) {
            console.log(`📋  最终编译器选项:`)
            console.log(`    target: ${ts.ScriptTarget[compilerOptions.target]}`)
            console.log(`    module: ${ts.ModuleKind[compilerOptions.module]}`)
            console.log(`    resolveJsonModule: ${compilerOptions.resolveJsonModule}`)
            console.log(`    esModuleInterop: ${compilerOptions.esModuleInterop}`)
            console.log(`    downlevelIteration: ${compilerOptions.downlevelIteration}`)
            console.log(`    baseUrl: ${compilerOptions.baseUrl}`)
            console.log(`    paths: ${JSON.stringify(compilerOptions.paths || {})}`)
          }
        }
      }

      // 创建TypeScript程序
      if (fileNames.length > 0) {
        this.program = ts.createProgram(fileNames, compilerOptions)
        
        if (this.options.verbose) {
          console.log(`✅  TypeScript 程序初始化完成`)
        }
      } else {
        if (this.options.verbose) {
          console.log(`⚠️  没有找到 TypeScript 文件，跳过程序初始化`)
        }
      }
    } catch (error) {
      console.warn('⚠️  TypeScript 程序初始化失败:', error.message)
      if (this.options.verbose) {
        console.warn(error.stack)
      }
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
      if (this.typeMap.size > 0) {
        console.log('📋  类型定义预览:')
        Array.from(this.typeMap.entries()).slice(0, 5).forEach(([name, info]) => {
          console.log(`    ${name} (${info.type}) - ${relative(this.options.rootDir, info.file)}:${info.line}`)
        })
      }
    }
  }

  shouldAnalyzeSourceFile(fileName) {
    // 确保只分析项目文件
    const normalizedPath = fileName.replace(/\\/g, '/')
    
    // 排除系统库和node_modules
    if (normalizedPath.includes('node_modules') ||
        normalizedPath.includes('/lib.') ||
        normalizedPath.includes('typescript/lib') ||
        normalizedPath.includes('@types/')) {
      return false
    }
    
    // 检查是否是我们扫描到的源文件
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
        case ts.SyntaxKind.ImportSpecifier:
        case ts.SyntaxKind.ImportClause:
          // 处理类型导入
          this.processImport(node, sourceFile)
          break
      }

      ts.forEachChild(node, child => this.visitNode(child, sourceFile))
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`⚠️  节点处理警告: ${error.message}`)
      }
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

  processImport(node, sourceFile) {
    // 处理导入的类型引用
    if (node.name && ts.isIdentifier(node.name)) {
      const typeName = node.name.text
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
      if (!existsSync(filePath)) {
        if (this.options.verbose) {
          console.warn(`⚠️  Vue文件不存在: ${filePath}`)
        }
        return
      }

      const content = readFileSync(filePath, 'utf8')
      
      // 支持多种Vue script标签格式
      const scriptMatches = [
        /<script[^>]*\s+lang=["']ts["'][^>]*>([\s\S]*?)<\/script>/gi,
        /<script[^>]*\s+setup[^>]*\s+lang=["']ts["'][^>]*>([\s\S]*?)<\/script>/gi,
        /<script[^>]*\s+lang=["']typescript["'][^>]*>([\s\S]*?)<\/script>/gi,
      ]

      let foundScript = false
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
          foundScript = true
        }
      }

      if (!foundScript && this.options.verbose) {
        console.log(`⚠️  Vue文件中未找到TypeScript代码: ${relative(this.options.rootDir, filePath)}`)
      }
    } catch (error) {
      console.warn(`⚠️  Vue文件分析失败 ${filePath}: ${error.message}`)
    }
  }

  shouldIgnoreType(typeName) {
    // 忽略内置类型和常见框架类型
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
        // 记录重复定义
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
      
      // 过滤掉定义自身的使用
      const realUsages = usages.filter(usage => {
        const isSameFile = resolve(usage.file) === resolve(typeInfo.file)
        const isSameLine = usage.line === typeInfo.line
        return !(isSameFile && Math.abs(usage.line - typeInfo.line) <= 1) // 允许1行的误差
      })

      if (realUsages.length === 0 && !typeInfo.exported) {
        this.unusedTypes.add(typeName)
      }
    }

    if (this.options.verbose) {
      console.log(`🔍  检测到 ${this.unusedTypes.size} 个未使用类型`)
      if (this.unusedTypes.size > 0) {
        console.log('📋  未使用类型预览:')
        Array.from(this.unusedTypes).slice(0, 5).forEach(typeName => {
          const info = this.typeMap.get(typeName)
          if (info) {
            console.log(`    ${typeName} - ${relative(this.options.rootDir, info.file)}:${info.line}`)
          }
        })
      }
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
      let diagnosticsCount = 0
      
      for (const sourceFile of this.program.getSourceFiles()) {
        if (!this.shouldAnalyzeSourceFile(sourceFile.fileName)) {
          continue
        }

        const diagnostics = [
          ...this.program.getSemanticDiagnostics(sourceFile),
          ...this.program.getSyntacticDiagnostics(sourceFile),
        ]

        for (const diagnostic of diagnostics) {
          if (this.shouldSkipDiagnostic(diagnostic)) {
            continue
          }

          const messageText = ts.flattenDiagnosticMessageText(
            diagnostic.messageText,
            '\n'
          )

          let line = 0
          if (diagnostic.start !== undefined) {
            const position = ts.getLineAndCharacterOfPosition(
              sourceFile,
              diagnostic.start
            )
            line = position.line + 1
          }

          const issue = {
            file: sourceFile.fileName,
            line,
            code: `TS${diagnostic.code}`,
            message: messageText,
            severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
          }

          if (diagnostic.category === ts.DiagnosticCategory.Error) {
            this.errors.push(issue)
          } else {
            this.warnings.push(issue)
          }
          
          diagnosticsCount++
        }
      }

      if (this.options.verbose) {
        console.log(`🔍  诊断完成，发现 ${this.errors.length} 个错误，${this.warnings.length} 个警告`)
      }
    } catch (error) {
      console.warn('⚠️  诊断分析失败:', error.message)
    }
  }

  shouldSkipDiagnostic(diagnostic) {
    const messageText = typeof diagnostic.messageText === 'string' 
      ? diagnostic.messageText 
      : ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')

    // 需要跳过的错误代码
    const skipCodes = [
      2307, // Cannot find module (通常是路径解析问题)
      2792, // Cannot find module. Did you mean to set the 'moduleResolution'
      7016, // Could not find a declaration file for module
      2732, // Cannot find module. Consider using '--resolveJsonModule' (JSON导入)
      1343, // The 'import.meta' meta-property is only allowed (Vite特性)
      2339, // Property does not exist on type 'ImportMeta' (Vite特性)
      1259, // Module can only be default-imported using the 'esModuleInterop' flag
      2802, // Type can only be iterated through when using the '--downlevelIteration' flag
      2724, // 'globalThis' has no exported member (Vue类型问题)
    ]
    
    // 检查是否是配置相关的错误
    if (skipCodes.includes(diagnostic.code)) {
      return true
    }

    // 跳过 Vite 相关的错误
    if (messageText.includes('import.meta') || 
        messageText.includes('ImportMeta') ||
        messageText.includes('resolveJsonModule') ||
        messageText.includes('esModuleInterop') ||
        messageText.includes('downlevelIteration')) {
      return true
    }

    // 跳过 JSON 导入相关错误
    if (messageText.includes('.json') && 
        (messageText.includes('Cannot find module') || 
         messageText.includes('Consider using'))) {
      return true
    }

    // 跳过路径别名相关错误 (@/ 路径)
    if (messageText.includes("'@/") && messageText.includes('Cannot find module')) {
      return true
    }

    // 跳过 Vue 全局类型相关错误
    if (messageText.includes('globalThis') && 
        (messageText.includes('VNode') || messageText.includes('ComponentCustomProperties'))) {
      return true
    }

    // 跳过常见的第三方库类型错误
    if (messageText.includes('node_modules') || 
        messageText.includes('declaration file for module')) {
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

      // 计算分数
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
          duplicates: Object.fromEntries(this.duplicates), // 转换为对象格式
          errors: this.errors,
          warnings: this.warnings,
          configErrors: this.configErrors, // 添加配置错误
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

      // 未使用类型扣分 (最多扣50分)
      const unusedRatio = this.unusedTypes.size / totalTypes
      const unusedPenalty = Math.min(50, unusedRatio * 60)
      score -= unusedPenalty

      // 重复定义扣分 (最多扣40分)
      const duplicateRatio = this.duplicates.size / totalTypes
      const duplicatePenalty = Math.min(40, duplicateRatio * 50)
      score -= duplicatePenalty

      return Math.max(0, Math.round(score))
    } catch (error) {
      console.warn('⚠️  健康分数计算失败:', error.message)
      return 0
    }
  }

  calculateValidationScore() {
    try {
      let score = 100

      // 关键错误严重扣分
      const criticalErrors = this.errors.filter(e => 
        this.isCriticalError(e.code)
      ).length
      score -= criticalErrors * 15

      // 普通错误扣分
      const regularErrors = this.errors.length - criticalErrors
      score -= regularErrors * 8

      // 警告轻微扣分
      score -= Math.min(20, this.warnings.length * 1)

      return Math.max(0, Math.round(score))
    } catch (error) {
      console.warn('⚠️  验证分数计算失败:', error.message)
      return 0
    }
  }

  isCriticalError(code) {
    // 只有这些才是真正的关键类型错误
    const criticalCodes = [
      'TS2322', // Type 'X' is not assignable to type 'Y'
      'TS2339', // Property 'X' does not exist on type 'Y' (但排除ImportMeta相关)
      'TS2345', // Argument of type 'X' is not assignable to parameter of type 'Y'
      'TS2349', // This expression is not callable
      'TS2571', // Object is of type 'unknown'
      'TS2531', // Object is possibly 'null'
      'TS2532', // Object is possibly 'undefined'
    ]
    
    // 排除配置相关的TS2339错误
    if (code === 'TS2339') {
      return false // 这些通常是ImportMeta相关的，已经被过滤
    }
    
    return criticalCodes.includes(code)
  }

  generateSuggestions() {
    try {
      const suggestions = []

      // 只统计真正的类型错误
      const realErrors = this.errors.length
      const criticalErrors = this.errors.filter(e => 
        this.isCriticalError(e.code)
      ).length

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

      // 针对项目特点的建议
      if (this.duplicates.has('ApiResponse')) {
        suggestions.push(`📝  建议将 ApiResponse 等通用接口移到 src/types/api.ts 统一管理`)
      }

      if (this.duplicates.has('EChartsOption')) {
        suggestions.push(`📊  建议将 EChartsOption 等图表类型移到 src/types/echarts.ts 统一管理`)
      }

      if (this.duplicates.has('ElType')) {
        suggestions.push(`🔧  建议将 ElType 等指令类型移到 src/types/directives.ts 统一管理`)
      }

      // 如果没有真正的问题
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