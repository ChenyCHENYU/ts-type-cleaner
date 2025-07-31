import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, relative, extname, resolve } from 'path'
import ts from 'typescript'

export class TypeAnalyzer {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
    this.verbose = Boolean(options.verbose);
    this.ignorePatterns = options.ignorePatterns || [
      /^Props$/,
      /^Emits$/,
      /^Slots$/,
      /^Expose$/,
    ];

    // 核心数据结构 - 简化设计
    this.typeDefinitions = new Map(); // typeName -> 第一个定义
    this.allTypeLocations = new Map(); // typeName -> [所有定义位置]
    this.typeUsages = new Map();
    this.errors = [];
    this.warnings = [];
    this.sourceFiles = [];
  }

  async analyze() {
    console.log("🔍 开始分析 TypeScript 类型...");

    // 1. 扫描文件
    this.scanSourceFiles();

    // 2. 创建 TypeScript 程序
    const program = this.createTypeScriptProgram();

    // 3. 收集类型定义
    this.collectTypeDefinitions(program);

    // 4. 分析类型使用
    this.analyzeTypeUsages(program);

    // 5. 类型检查
    this.runTypeChecking(program);

    return this.generateReport();
  }

  scanSourceFiles() {
    const srcDir = join(this.rootDir, "src");
    const scanRoot = existsSync(srcDir) ? srcDir : this.rootDir;

    this.sourceFiles = this.scanDirectory(scanRoot)
      .filter((file) => [".ts", ".tsx", ".vue"].includes(extname(file)))
      .filter(
        (file) => !file.includes("node_modules") && !file.endsWith(".d.ts")
      );

    if (this.verbose) {
      console.log(`📄 扫描到 ${this.sourceFiles.length} 个源文件`);
    }
  }

  scanDirectory(dir) {
    if (!existsSync(dir)) return [];

    const files = [];
    const items = readdirSync(dir);

    for (const item of items) {
      if (item.startsWith(".") || ["node_modules", "dist"].includes(item))
        continue;

      const fullPath = join(dir, item);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          files.push(...this.scanDirectory(fullPath));
        } else {
          files.push(fullPath);
        }
      } catch (e) {
        continue;
      }
    }
    return files;
  }

  createTypeScriptProgram() {
    const tsFiles = this.sourceFiles.filter(
      (f) => f.endsWith(".ts") || f.endsWith(".tsx")
    );

    if (tsFiles.length === 0) return null;

    const compilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      skipLibCheck: true,
      noEmit: true,
      strict: false,
      baseUrl: this.rootDir,
      paths: { "@/*": ["src/*"] },
    };

    return ts.createProgram(tsFiles, compilerOptions);
  }

  collectTypeDefinitions(program) {
    // 处理 TypeScript 文件
    if (program) {
      for (const sourceFile of program.getSourceFiles()) {
        if (this.isProjectFile(sourceFile.fileName)) {
          this.extractTypesFromFile(sourceFile.fileName, sourceFile.text);
        }
      }
    }

    // 处理 Vue 文件
    for (const file of this.sourceFiles) {
      if (file.endsWith(".vue")) {
        this.extractTypesFromVueFile(file);
      }
    }

    if (this.verbose) {
      console.log(`📊 发现 ${this.typeDefinitions.size} 个类型定义`);
      console.log(`🔍 重复类型: ${this.getDuplicateCount()} 个`);
    }
  }

  isProjectFile(fileName) {
    const normalized = resolve(fileName).replace(/\\/g, "/");
    return (
      !normalized.includes("node_modules") &&
      !normalized.includes("typescript/lib") &&
      this.sourceFiles.some(
        (f) => resolve(f).replace(/\\/g, "/") === normalized
      )
    );
  }

  // 核心方法：从文件中提取类型定义
  extractTypesFromFile(filePath, content) {
    try {
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      );

      this.visitTypeNodes(sourceFile, filePath);
    } catch (error) {
      if (this.verbose) {
        console.warn(`解析文件失败: ${filePath}`, error.message);
      }
    }
  }

  extractTypesFromVueFile(filePath) {
    try {
      const content = readFileSync(filePath, "utf8");
      const scriptMatch = content.match(
        /<script[^>]*(?:\s+lang=["'](?:ts|typescript)["']|\s+setup)[^>]*>([\s\S]*?)<\/script>/i
      );

      if (scriptMatch) {
        this.extractTypesFromFile(filePath, scriptMatch[1]);
      }
    } catch (error) {
      if (this.verbose) {
        console.warn(`Vue 文件解析失败: ${filePath}`, error.message);
      }
    }
  }

  // 简化的 AST 访问
  visitTypeNodes(sourceFile, filePath) {
    const visit = (node) => {
      if (!node) return;

      // 识别类型定义
      const typeInfo = this.getTypeInfo(node, sourceFile, filePath);
      if (typeInfo) {
        this.addTypeDefinition(typeInfo);
      }

      // 递归访问子节点
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  getTypeInfo(node, sourceFile, filePath) {
    let name = null;
    let kind = null;

    switch (node.kind) {
      case ts.SyntaxKind.InterfaceDeclaration:
        name = node.name?.text;
        kind = "interface";
        break;
      case ts.SyntaxKind.TypeAliasDeclaration:
        name = node.name?.text;
        kind = "type";
        break;
      case ts.SyntaxKind.EnumDeclaration:
        name = node.name?.text;
        kind = "enum";
        break;
      case ts.SyntaxKind.ClassDeclaration:
        name = node.name?.text;
        kind = "class";
        break;
      default:
        return null;
    }

    if (!name || this.shouldIgnoreType(name)) {
      return null;
    }

    const line = this.getLineNumber(sourceFile, node);
    const exported =
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ||
      false;

    return {
      name,
      kind,
      file: resolve(filePath).replace(/\\/g, "/"),
      line,
      exported,
    };
  }

  getLineNumber(sourceFile, node) {
    try {
      const start = node.getStart ? node.getStart(sourceFile) : node.pos;
      const pos = ts.getLineAndCharacterOfPosition(sourceFile, start);
      return pos.line + 1;
    } catch (error) {
      return 1;
    }
  }

  // 核心：添加类型定义（处理重复）
  addTypeDefinition(typeInfo) {
    const { name, file, line } = typeInfo;

    // 记录第一个定义
    if (!this.typeDefinitions.has(name)) {
      this.typeDefinitions.set(name, typeInfo);
    }

    // 记录所有位置
    if (!this.allTypeLocations.has(name)) {
      this.allTypeLocations.set(name, []);
    }

    const locations = this.allTypeLocations.get(name);
    const locationKey = `${file}:${line}`;

    // 防止同一位置重复添加
    if (!locations.some((loc) => `${loc.file}:${loc.line}` === locationKey)) {
      locations.push(typeInfo);
    }
  }

  shouldIgnoreType(typeName) {
    const builtins = [
      "string",
      "number",
      "boolean",
      "Array",
      "Promise",
      "Record",
      "Partial",
    ];
    if (builtins.includes(typeName)) return true;

    return this.ignorePatterns.some((pattern) => {
      if (pattern instanceof RegExp) return pattern.test(typeName);
      return typeName.includes(pattern);
    });
  }

  analyzeTypeUsages(program) {
    if (!program) return;

    for (const sourceFile of program.getSourceFiles()) {
      if (this.isProjectFile(sourceFile.fileName)) {
        this.findTypeReferences(sourceFile);
      }
    }
  }

  findTypeReferences(sourceFile) {
    const visit = (node) => {
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        const typeName = node.typeName.text;
        if (!this.shouldIgnoreType(typeName)) {
          this.addTypeUsage(typeName, {
            file: resolve(sourceFile.fileName).replace(/\\/g, "/"),
            line: this.getLineNumber(sourceFile, node),
          });
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  addTypeUsage(typeName, usage) {
    if (!this.typeUsages.has(typeName)) {
      this.typeUsages.set(typeName, []);
    }
    this.typeUsages.get(typeName).push(usage);
  }

  runTypeChecking(program) {
    if (!program) return;

    const diagnostics = ts.getPreEmitDiagnostics(program);

    for (const diagnostic of diagnostics) {
      if (!diagnostic.file || !this.isProjectFile(diagnostic.file.fileName))
        continue;

      if (this.isImportantError(diagnostic)) {
        const issue = {
          file: resolve(diagnostic.file.fileName).replace(/\\/g, "/"),
          line: diagnostic.start
            ? ts.getLineAndCharacterOfPosition(
                diagnostic.file,
                diagnostic.start
              ).line + 1
            : 0,
          code: `TS${diagnostic.code}`,
          message: ts.flattenDiagnosticMessageText(
            diagnostic.messageText,
            "\n"
          ),
          severity:
            diagnostic.category === ts.DiagnosticCategory.Error
              ? "error"
              : "warning",
        };

        if (issue.severity === "error") {
          this.errors.push(issue);
        } else {
          this.warnings.push(issue);
        }
      }
    }
  }

  isImportantError(diagnostic) {
    const skipCodes = [2304, 2307, 1343, 2732]; // 模块解析、环境相关错误
    if (skipCodes.includes(diagnostic.code)) return false;

    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      "\n"
    );
    if (message.includes("import.meta") || message.includes("vite"))
      return false;

    return [2322, 2345, 2531, 2532].includes(diagnostic.code); // 真实的类型错误
  }

  // 生成报告
  generateReport() {
    const duplicates = this.getDuplicates();
    const unused = this.getUnusedTypes();

    const stats = {
      sourceFiles: this.sourceFiles.length,
      typeDefinitions: this.typeDefinitions.size,
      usageReferences: Array.from(this.typeUsages.values()).reduce(
        (sum, uses) => sum + uses.length,
        0
      ),
      unusedTypes: unused.length,
      duplicateDefinitions: Object.keys(duplicates).length,
      totalErrors: this.errors.length,
      totalWarnings: this.warnings.length,
    };

    const healthScore = this.calculateHealthScore(stats);
    const validationScore =
      this.errors.length === 0
        ? 100
        : Math.max(0, 100 - this.errors.length * 10);

    return {
      timestamp: new Date().toISOString(),
      statistics: stats,
      scores: {
        healthScore,
        validationScore,
        overallScore: Math.round((healthScore + validationScore) / 2),
      },
      details: {
        unusedTypes: unused,
        duplicates: this.formatDuplicatesForReport(duplicates),
        errors: this.errors.map((e) => ({
          ...e,
          file: this.getRelativePath(e.file),
        })),
        warnings: this.warnings.map((w) => ({
          ...w,
          file: this.getRelativePath(w.file),
        })),
      },
      suggestions: this.generateSuggestions(stats),
    };
  }

  // 获取真正的重复类型
  getDuplicates() {
    const duplicates = {};

    for (const [typeName, locations] of this.allTypeLocations) {
      // 只有在不同文件中有定义才算重复
      const uniqueFiles = new Set(locations.map((loc) => loc.file));

      if (uniqueFiles.size > 1) {
        duplicates[typeName] = locations;
      }
    }

    return duplicates;
  }

  getDuplicateCount() {
    return Object.keys(this.getDuplicates()).length;
  }

  getUnusedTypes() {
    const unused = [];

    for (const [typeName, definition] of this.typeDefinitions) {
      // 跳过导出的类型
      if (definition.exported) continue;

      // 跳过 Vue 文件中的类型
      if (definition.file.endsWith(".vue")) continue;

      const usages = this.typeUsages.get(typeName) || [];

      // 过滤掉定义处的"使用"
      const realUsages = usages.filter(
        (usage) =>
          !(
            usage.file === definition.file &&
            Math.abs(usage.line - definition.line) <= 2
          )
      );

      if (realUsages.length === 0) {
        unused.push(typeName);
      }
    }

    return unused;
  }

  formatDuplicatesForReport(duplicates) {
    const formatted = {};

    for (const [typeName, locations] of Object.entries(duplicates)) {
      formatted[typeName] = locations.map((loc) => ({
        file: this.getRelativePath(loc.file),
        line: loc.line,
        type: loc.kind,
      }));
    }

    return formatted;
  }

  calculateHealthScore(stats) {
    if (stats.typeDefinitions === 0) return 100;

    let score = 100;
    score -= Math.min(40, (stats.unusedTypes / stats.typeDefinitions) * 50);
    score -= Math.min(
      30,
      (stats.duplicateDefinitions / stats.typeDefinitions) * 40
    );

    return Math.max(0, Math.round(score));
  }

  generateSuggestions(stats) {
    const suggestions = [];

    if (stats.totalErrors > 0) {
      suggestions.push(`🔴 修复 ${stats.totalErrors} 个类型错误`);
    }
    if (stats.unusedTypes > 0) {
      suggestions.push(`🗑️ 清理 ${stats.unusedTypes} 个未使用的类型定义`);
    }
    if (stats.duplicateDefinitions > 0) {
      suggestions.push(
        `⚠️ 处理 ${stats.duplicateDefinitions} 个重复的类型定义`
      );
    }

    return suggestions.length > 0 ? suggestions : ["🎉 类型系统状态良好！"];
  }

  getRelativePath(filePath) {
    return relative(this.rootDir, filePath).replace(/\\/g, "/");
  }
}

// 导出函数
export async function analyzeProject(options = {}) {
  const analyzer = new TypeAnalyzer(options);
  return await analyzer.analyze();
}

export async function quickCheck(options = {}) {
  const result = await analyzeProject({ ...options, verbose: false });
  const threshold = options.threshold || 70;

  return {
    passed:
      result.details.errors.length === 0 &&
      result.scores.overallScore >= threshold,
    score: result.scores.overallScore,
    errors: result.details.errors.length,
    warnings: result.details.warnings.length,
    summary:
      result.details.errors.length === 0
        ? `✅ 类型检查通过 (评分: ${result.scores.overallScore}/100)`
        : `❌ 发现 ${result.details.errors.length} 个类型错误`,
  };
}