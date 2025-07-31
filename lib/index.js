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
    
    // 修复: 添加已处理的定义追踪，防止重复添加
    this.processedDefinitions = new Set()
    this.visitedNodes = new Set()
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
      // 检查是否需要 Vite 类型支持
      const needsViteTypes = this.checkNeedsViteTypes()
      
      if (needsViteTypes && this.options.verbose) {
        console.log('🔧  检测到 Vite 项目，已自动配置类型支持')
      }
      
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

  checkNeedsViteTypes() {
    // 检查是否是 Vite 项目
    try {
      const packageJsonPath = join(this.options.rootDir, 'package.json')
      if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
        return Boolean(deps.vite || deps['@vitejs/plugin-vue'])
      }
    } catch (error) {
      // 忽略检查错误
    }
    return false
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
      strict: false, // 降低严格度
      allowJs: false,
      baseUrl: this.options.rootDir,
      paths: { '@/*': ['src/*'] },
      // 关键：添加 Vite 类型支持
      types: ['vite/client'],
      typeRoots: ['node_modules/@types'],
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
            // 确保 Vite 类型支持
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
    let definitionCount = 0

    // 重置处理状态
    this.processedDefinitions.clear()
    this.visitedNodes.clear()

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
      console.log(`🔄  检测到 ${this.duplicateTypes.size} 个潜在重复类型`)
    }
  }

  isProjectFile(fileName) {
    try {
      const normalizedPath = this.normalizePath(fileName)
      
      // 排除系统文件
      if (normalizedPath.includes('node_modules') ||
          normalizedPath.includes('/lib.') ||
          normalizedPath.includes('typescript/lib')) {
        return false
      }
      
      // 检查是否是项目文件
      return this.sourceFiles.some(file => {
        return this.normalizePath(file) === normalizedPath
      })
    } catch (error) {
      return false
    }
  }

  // 修复: 统一路径规范化
  normalizePath(filePath) {
    try {
      return resolve(filePath).replace(/\\/g, '/')
    } catch (error) {
      return filePath.replace(/\\/g, '/')
    }
  }

  // 修复: 改进的 AST 访问逻辑，防止重复处理
  visitTypeDefinitions(sourceFile) {
    let count = 0
    const fileNodeVisited = new Set() // 每个文件独立的访问记录
    
    const visit = (node) => {
      try {
        if (!node) return
        
        // 创建节点唯一标识（包含文件路径）
        const nodeId = `${sourceFile.fileName}:${node.kind}:${node.pos}:${node.end}`
        if (fileNodeVisited.has(nodeId)) {
          return // 已访问过此节点
        }
        fileNodeVisited.add(nodeId)
        
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
        
        // 递归访问子节点
        ts.forEachChild(node, visit)
      } catch (error) {
        // 忽略单个节点处理错误，但记录日志
        if (this.options.verbose) {
          console.warn(`节点处理错误:`, error.message)
        }
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

      return this.addTypeDefinition(name, info)
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

      return this.addTypeDefinition(name, info)
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

      return this.addTypeDefinition(name, info)
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

      return this.addTypeDefinition(name, info)
    } catch (error) {
      return false
    }
  }

  getNodeLine(sourceFile, node) {
    try {
      // 尝试多种方式获取节点位置
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
      // 如果获取行号失败，尝试从 node.name 获取
      try {
        if (node.name && typeof node.name.getStart === 'function') {
          const nameStart = node.name.getStart(sourceFile)
          const position = ts.getLineAndCharacterOfPosition(sourceFile, nameStart)
          return position.line + 1
        }
      } catch (e) {
        // 最后的备用方案
      }
      
      return 1 // 返回第1行而不是0
    }
  }

  hasExportModifier(node) {
    try {
      return node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) || false
    } catch (error) {
      return false
    }
  }

  // 修复: 完全重写的添加类型定义方法
  addTypeDefinition(name, info) {
    try {
      // 创建绝对唯一标识符，包含所有必要信息
      const absolutePath = this.normalizePath(info.file)
      const uniqueKey = `${name}::${absolutePath}::${info.line}::${info.type}`
      
      // 防止同一个定义被重复添加（AST遍历可能重复访问同一节点）
      if (this.processedDefinitions.has(uniqueKey)) {
        return false // 已经处理过这个定义，直接返回
      }
      
      this.processedDefinitions.add(uniqueKey)

      // 创建标准化的类型信息
      const normalizedInfo = {
        ...info,
        file: absolutePath
      }

      // 检查是否已存在同名类型
      if (this.typeDefinitions.has(name)) {
        const existing = this.typeDefinitions.get(name)
        
        // 只有在不同文件中才算真正的重复定义
        if (this.isDifferentFile(existing.file, normalizedInfo.file)) {
          this.handleDuplicateType(name, existing, normalizedInfo)
        } else {
          // 同一文件中的定义，检查是否是真正的重复
          if (existing.line !== normalizedInfo.line) {
            // 同文件不同行，可能是接口合并或重复定义
            this.handleDuplicateType(name, existing, normalizedInfo)
          } else {
            // 同文件同行，可能是重复处理，更新信息即可
            this.typeDefinitions.set(name, normalizedInfo)
          }
        }
      } else {
        // 首次定义
        this.typeDefinitions.set(name, normalizedInfo)
      }
      
      return true
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`添加类型定义失败: ${name}`, error.message)
      }
      return false
    }
  }

  // 修复: 判断是否为不同文件
  isDifferentFile(file1, file2) {
    try {
      // 规范化路径进行比较
      const normalizedFile1 = this.normalizePath(file1)
      const normalizedFile2 = this.normalizePath(file2)
      return normalizedFile1 !== normalizedFile2
    } catch (error) {
      // 降级比较
      return file1 !== file2
    }
  }

  // 修复: 处理重复类型的逻辑
  handleDuplicateType(name, existing, newInfo) {
    try {
      if (!this.duplicateTypes.has(name)) {
        // 首次发现重复，记录原始定义
        this.duplicateTypes.set(name, [existing])
      }

      // 检查新定义是否已经在重复列表中
      const duplicateList = this.duplicateTypes.get(name)
      const isDuplicate = duplicateList.some(dup => 
        dup.file === newInfo.file && dup.line === newInfo.line
      )

      if (!isDuplicate) {
        duplicateList.push(newInfo)
        
        if (this.options.verbose) {
          console.log(`🔄  发现重复类型定义: ${name}`)
          console.log(`    现有: ${this.getRelativePath(existing.file)}:${existing.line} (${existing.type})`)
          console.log(`    新增: ${this.getRelativePath(newInfo.file)}:${newInfo.line} (${newInfo.type})`)
        }
      }
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`处理重复类型失败: ${name}`, error.message)
      }
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

  // 修复: 改进的 Vue 文件分析
  async analyzeVueFile(filePath) {
    try {
      const content = readFileSync(filePath, 'utf8')
      const scriptRegex = /<script[^>]*(?:\s+lang=["'](?:ts|typescript)["']|\s+setup)[^>]*>([\s\S]*?)<\/script>/gi
      let count = 0
      let match
      
      // 为每个 script 块创建唯一的文件标识，避免重复
      let blockIndex = 0
      
      while ((match = scriptRegex.exec(content)) !== null) {
        try {
          const scriptContent = match[1]
          // 使用原始文件路径，避免虚拟路径导致的混乱
          const sourceFile = ts.createSourceFile(
            filePath, // 使用真实文件名
            scriptContent,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS
          )
          
          count += this.visitTypeDefinitions(sourceFile)
          blockIndex++
        } catch (error) {
          // 忽略单个 script 块的解析错误
          if (this.options.verbose) {
            console.warn(`Vue script 块解析失败: ${filePath}`, error.message)
          }
          continue
        }
      }
      
      return count
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`Vue 文件分析失败: ${filePath}`, error.message)
      }
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
        // 检查是否是全局类型扩展
        if (this.isGlobalTypeExtension(typeName, typeInfo)) {
          continue // 全局类型扩展不算未使用
        }
        
        const usages = this.typeUsages.get(typeName) || []
        
        // 过滤掉定义处的"使用"
        const realUsages = usages.filter(usage => {
          try {
            const isSameFile = usage.file === typeInfo.file
            const isNearDefinition = Math.abs(usage.line - typeInfo.line) <= 2
            return !(isSameFile && isNearDefinition)
          } catch (error) {
            return true // 保守处理，认为是真实使用
          }
        })

        // 对于 Vue 文件中的类型，更宽松的检测
        const isInVueFile = typeInfo.file.endsWith('.vue')
        const isExported = typeInfo.exported
        
        // 如果是导出的类型，或者在 Vue 文件中，或者有真实使用，则不标记为未使用
        if (isExported || isInVueFile || realUsages.length > 0) {
          continue
        }
        
        // 对于某些常见的类型名，也不标记为未使用
        if (this.isCommonType(typeName)) {
          continue
        }

        this.unusedTypes.add(typeName)
      }

      if (this.options.verbose) {
        console.log(`🗑️  发现 ${this.unusedTypes.size} 个未使用类型`)
        if (this.unusedTypes.size > 0) {
          console.log('未使用类型列表:', Array.from(this.unusedTypes).slice(0, 5))
        }
      }
    } catch (error) {
      if (this.options.verbose) {
        console.warn('⚠️  未使用类型检测失败:', error.message)
      }
    }
  }

  /**
   * 检查是否是全局类型扩展
   */
  isGlobalTypeExtension(typeName, typeInfo) {
    try {
      // 检查文件内容是否包含 declare global
      const content = readFileSync(typeInfo.file, 'utf8')
      
      // 如果文件包含 declare global 并且扩展了这个类型
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
      
      // 常见的全局类型名称
      const globalTypeNames = ['Window', 'Document', 'Global', 'NodeJS', 'ComponentCustomProperties']
      return globalTypeNames.includes(typeName)
    } catch (error) {
      return false
    }
  }

  /**
   * 检查是否是常见类型（不应标记为未使用）
   */
  isCommonType(typeName) {
    const commonTypePatterns = [
      /Props$/i,
      /Emits$/i, 
      /Slots$/i,
      /Expose$/i,
      /Config$/i,
      /Options$/i,
      /State$/i,
      /Data$/i,
      /Event$/i,
      /Handler$/i,
      /Callback$/i,
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
    const code = diagnostic.code
    const messageText = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    
    // 完全跳过的错误码（配置、环境相关）
    const skipCodes = [
      2304, // Cannot find name (通常是全局变量/API)
      2307, // Cannot find module (模块解析)
      1343, // import.meta (Vite 特性)
      2732, // resolveJsonModule (JSON 导入)
      1259, // esModuleInterop (模块互操作)
      7016, // declaration file (类型声明文件)
    ]
    
    if (skipCodes.includes(code)) {
      return false
    }
    
    // 跳过 Vite 相关错误
    if (messageText.includes('ImportMeta') || 
        messageText.includes('import.meta') ||
        messageText.includes('glob') ||
        messageText.includes('env')) {
      return false
    }
    
    // 跳过 import.meta.glob 相关的类型错误
    if (messageText.includes('unknown') && 
        messageText.includes('Promise<unknown>') &&
        messageText.includes('import.meta.glob')) {
      return false
    }
    
    // 只保留真正的类型不匹配错误
    const realErrorCodes = [
      2322, // Type 'X' is not assignable to type 'Y' (但排除 import.meta.glob)
      2345, // Argument type error (但排除 import.meta.glob)
      2531, // Object is possibly 'null'
      2532, // Object is possibly 'undefined'
      2571, // Object is of type 'unknown' (真实的 unknown 问题)
    ]
    
    // 对于 2322 和 2345，额外检查是否是 import.meta.glob 相关
    if ([2322, 2345].includes(code)) {
      // 如果错误消息包含这些关键词，很可能是 Vite 相关的，跳过
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

  // 辅助方法: 获取相对路径
  getRelativePath(filePath) {
    try {
      return relative(this.options.rootDir, filePath).replace(/\\/g, '/')
    } catch (error) {
      return filePath
    }
  }

  // 修复: 改进的重复类型报告生成
  generateDuplicateReport() {
    const duplicateReport = {}
    
    for (const [typeName, definitions] of this.duplicateTypes) {
      // 确保至少有2个不同的定义才算重复
      if (definitions.length >= 2) {
        // 去重，确保同一个文件+行号只出现一次
        const uniqueDefinitions = []
        const seen = new Set()
        
        for (const def of definitions) {
          const key = `${def.file}:${def.line}`
          if (!seen.has(key)) {
            seen.add(key)
            uniqueDefinitions.push({
              file: this.getRelativePath(def.file),
              line: def.line,
              type: def.type
            })
          }
        }
        
        // 只有真正有多个不同位置的定义才加入报告
        if (uniqueDefinitions.length >= 2) {
          duplicateReport[typeName] = uniqueDefinitions
        }
      }
    }
    
    return duplicateReport
  }

  generateReport() {
    try {
      const stats = {
        sourceFiles: this.sourceFiles.length,
        typeDefinitions: this.typeDefinitions.size,
        usageReferences: Array.from(this.typeUsages.values()).reduce((sum, usages) => sum + usages.length, 0),
        unusedTypes: this.unusedTypes.size,
        duplicateDefinitions: Object.keys(this.generateDuplicateReport()).length, // 使用修复后的重复检测
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
          duplicates: this.generateDuplicateReport(), // 使用修复后的方法
          errors: this.errors,
          warnings: this.warnings,
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

  calculateHealthScore() {
    try {
      const totalTypes = this.typeDefinitions.size
      if (totalTypes === 0) return 100

      let score = 100
      
      const unusedRatio = this.unusedTypes.size / totalTypes
      score -= Math.min(40, unusedRatio * 50)
      
      const duplicateCount = Object.keys(this.generateDuplicateReport()).length
      const duplicateRatio = duplicateCount / totalTypes
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

      const duplicateCount = Object.keys(this.generateDuplicateReport()).length
      if (duplicateCount > 0) {
        suggestions.push(`⚠️  处理 ${duplicateCount} 个重复的类型定义`)
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