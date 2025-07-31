import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, relative, extname, resolve } from 'path'
import ts from 'typescript'

export class TypeAnalyzer {
  constructor(options = {}) {
    this.options = {
      rootDir: options.rootDir || process.cwd(),
      include: options.include || ['src/**/*.{ts,tsx,vue}'],
      exclude: options.exclude || [
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
      ],
      verbose: options.verbose || false,
      ignorePatterns: options.ignorePatterns || [
        /^Props$/, /^Emits$/, /^Slots$/, /^Expose$/,
        /Props$/, /Emits$/, /Events?$/, /State$/
      ],
      ...options,
    }

    this.resetData()
  }

  resetData() {
    this.typeMap = new Map()
    this.usageMap = new Map()
    this.duplicates = new Set()
    this.unusedTypes = new Set()
    this.errors = []
    this.warnings = []
    this.sourceFiles = []
    this.program = null
  }

  async analyze() {
    if (this.options.verbose) {
      console.log('🔍  开始 TypeScript 类型分析...')
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
    this.sourceFiles = this.scanDirectory(this.options.rootDir)
      .filter(file => {
        const ext = extname(file)
        return ['.ts', '.tsx', '.vue'].includes(ext)
      })
      .filter(file => {
        const absolutePath = resolve(file)
        const relativePath = relative(this.options.rootDir, file).replace(/\\/g, '/')
        
        // 检查是否应该排除
        return !this.options.exclude.some(pattern => {
          // 处理glob模式
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
          
          // 检查路径是否包含排除模式
          return relativePath.includes(pattern) || 
                 absolutePath.includes(pattern) ||
                 file.endsWith(pattern)
        })
      })

    if (this.options.verbose) {
      console.log(`📄  扫描到 ${this.sourceFiles.length} 个源文件`)
    }
  }

  scanDirectory(dir) {
    let files = []
    try {
      const items = readdirSync(dir)
      for (const item of items) {
        const fullPath = join(dir, item)
        
        // 跳过常见的非源码目录
        if (this.options.exclude.some(pattern => 
          item === pattern || item.startsWith('.')
        )) {
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
      // 忽略权限错误
    }
    return files
  }

  async initTypeScript() {
    try {
      const configPath = ts.findConfigFile(
        this.options.rootDir,
        ts.sys.fileExists,
        'tsconfig.json'
      )

      let compilerOptions = {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        esModuleInterop: true,
        skipLibCheck: true,
        skipDefaultLibCheck: true,
        noEmit: true,
        allowJs: true,
        types: [],
        typeRoots: [],
      }

      // 只包含项目源文件
      let fileNames = this.sourceFiles.filter(f => {
        const normalizedPath = f.replace(/\\/g, '/')
        return (f.endsWith('.ts') || f.endsWith('.tsx')) &&
               !normalizedPath.includes('node_modules') &&
               !normalizedPath.includes('.d.ts') &&
               !normalizedPath.includes('.test.') &&
               !normalizedPath.includes('.spec.')
      })

      if (configPath) {
        const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
        if (!configFile.error) {
          const parsedConfig = ts.parseJsonConfigFileContent(
            configFile.config,
            ts.sys,
            this.options.rootDir
          )
          
          // 合并选项但保持我们的覆盖
          compilerOptions = { 
            ...parsedConfig.options,
            skipLibCheck: true,
            skipDefaultLibCheck: true,
            noEmit: true,
            types: [],
            typeRoots: [],
          }
        }
      }

      // 创建自定义的CompilerHost以更好地控制文件读取
      const host = ts.createCompilerHost(compilerOptions)
      const originalGetSourceFile = host.getSourceFile
      
      host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
        // 跳过非项目文件
        if (!this.shouldIncludeFile(fileName)) {
          return undefined
        }
        return originalGetSourceFile.call(host, fileName, languageVersion, onError, shouldCreateNewSourceFile)
      }

      this.program = ts.createProgram(fileNames, compilerOptions, host)
      
      if (this.options.verbose) {
        console.log(`🔧  TypeScript 程序初始化完成，包含 ${fileNames.length} 个文件`)
      }
    } catch (error) {
      console.warn('⚠️  TypeScript 程序初始化失败:', error.message)
    }
  }

  shouldIncludeFile(fileName) {
    const normalizedPath = fileName.replace(/\\/g, '/')
    
    // 排除系统文件和node_modules
    if (normalizedPath.includes('node_modules') ||
        normalizedPath.includes('/lib.') ||
        normalizedPath.includes('typescript/lib') ||
        normalizedPath.includes('@types/')) {
      return false
    }
    
    // 检查是否是项目文件
    return this.sourceFiles.some(file => {
      const normalizedFile = file.replace(/\\/g, '/')
      return normalizedFile === normalizedPath
    })
  }

  async analyzeTypes() {
    // 分析TypeScript文件
    if (this.program) {
      for (const sourceFile of this.program.getSourceFiles()) {
        if (this.shouldIncludeFile(sourceFile.fileName)) {
          this.visitNode(sourceFile, sourceFile)
        }
      }
    }

    // 分析Vue文件
    const vueFiles = this.sourceFiles.filter(f => f.endsWith('.vue'))
    for (const vueFile of vueFiles) {
      await this.analyzeVueFile(vueFile)
    }

    if (this.options.verbose) {
      console.log(`🔍  分析完成，发现 ${this.typeMap.size} 个类型定义`)
    }
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
      this.addTypeUsage(typeName, {
        file: sourceFile.fileName,
        line: ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1,
      })
    }
  }

  async analyzeVueFile(filePath) {
    try {
      if (!existsSync(filePath)) {
        console.warn(`⚠️  Vue文件不存在: ${filePath}`)
        return
      }

      const content = readFileSync(filePath, 'utf8')
      const scriptMatch = content.match(
        /<script[^>]*(?:lang=["']ts["']|setup)[^>]*>([\s\S]*?)<\/script>/i
      )

      if (scriptMatch) {
        const scriptContent = scriptMatch[1]
        const sourceFile = ts.createSourceFile(
          filePath,
          scriptContent,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS
        )
        this.visitNode(sourceFile, sourceFile)
      }
    } catch (error) {
      console.warn(`⚠️  Vue文件分析失败 ${filePath}: ${error.message}`)
    }
  }

  shouldIgnoreType(typeName) {
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
        this.duplicates.add(name)
      }
    }
    this.typeMap.set(name, info)
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
      const realUsages = usages.filter(usage => 
        usage.file !== typeInfo.file || usage.line !== typeInfo.line
      )

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
      console.warn('⚠️  TypeScript 程序未初始化，跳过诊断分析')
      return
    }

    try {
      // 只获取项目源文件的诊断
      for (const sourceFile of this.program.getSourceFiles()) {
        // 确保只检查项目文件
        if (!this.shouldIncludeFile(sourceFile.fileName)) {
          continue
        }

        const diagnostics = [
          ...this.program.getSemanticDiagnostics(sourceFile),
          ...this.program.getSyntacticDiagnostics(sourceFile),
        ]

        for (const diagnostic of diagnostics) {
          // 跳过特定的诊断代码
          if (this.shouldSkipDiagnostic(diagnostic)) {
            continue
          }

          const messageText = ts.flattenDiagnosticMessageText(
            diagnostic.messageText,
            '\n'
          )

          let file = sourceFile.fileName
          let line = 0

          if (diagnostic.start !== undefined) {
            const position = ts.getLineAndCharacterOfPosition(
              sourceFile,
              diagnostic.start
            )
            line = position.line + 1
          }

          const issue = {
            file,
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
        }
      }

      if (this.options.verbose) {
        console.log(`🔍  发现 ${this.errors.length} 个错误，${this.warnings.length} 个警告`)
      }
    } catch (error) {
      console.warn('⚠️  诊断分析失败:', error.message)
    }
  }

  shouldSkipDiagnostic(diagnostic) {
    // 跳过找不到模块的错误（通常是node_modules相关）
    const skipCodes = [
      2307, // Cannot find module
      2792, // Cannot find module. Did you mean to set the 'moduleResolution'
      7016, // Could not find a declaration file for module
    ]
    
    return skipCodes.includes(diagnostic.code)
  }

  isExported(node) {
    return node.modifiers?.some(
      modifier => modifier.kind === ts.SyntaxKind.ExportKeyword
    )
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
          duplicates: Array.from(this.duplicates),
          errors: this.errors,
          warnings: this.warnings,
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
    return ['TS2322', 'TS2339', 'TS2304', 'TS2307'].includes(code)
  }

  generateSuggestions() {
    try {
      const suggestions = []

      const criticalErrors = this.errors.filter(e => 
        this.isCriticalError(e.code)
      ).length
      if (criticalErrors > 0) {
        suggestions.push(`🔴  立即修复 ${criticalErrors} 个关键类型错误`)
      }

      if (this.unusedTypes.size > 0) {
        suggestions.push(`💡  清理 ${this.unusedTypes.size} 个未使用的类型定义`)
      }

      if (this.duplicates.size > 0) {
        suggestions.push(`⚠️  合并 ${this.duplicates.size} 个重复的类型定义`)
      }

      const unusedImports = this.warnings.filter(w => 
        w.type === 'unused-import'
      ).length
      if (unusedImports > 0) {
        suggestions.push(`🧹  清理 ${unusedImports} 个未使用的导入`)
      }

      if (suggestions.length === 0) {
        suggestions.push('🎉  类型系统状态良好，代码质量优秀！')
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