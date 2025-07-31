import { readFileSync, existsSync } from "fs";
import { join, relative } from "path";
import ts from "typescript";
import { scanFiles } from "../utils/fileScanner.js";

export class TypeAnalyzer {
  constructor(options = {}) {
    this.options = {
      rootDir: options.rootDir || process.cwd(),
      outputDir: options.outputDir || "./type-reports",
      exclude: options.exclude || ["node_modules", "dist", ".git"],
      verbose: options.verbose || false,
      strict: options.strict || false,
      skipLibCheck: options.skipLibCheck !== false,
      // 类型管理配置
      ignorePatterns: options.ignorePatterns || [
        /^Props$/,
        /^Emits$/,
        /^Slots$/,
        /^Expose$/,
        /Props$/,
        /Emits$/,
        /Events?$/,
        /State$/,
        /^I[A-Z]/,
      ],
      ignoreVueComponentTypes: options.ignoreVueComponentTypes !== false,
      ...options,
    };

    // 类型管理相关
    this.typeMap = new Map();
    this.usageMap = new Map();
    this.exportMap = new Map();
    this.importMap = new Map();
    this.duplicates = new Set();
    this.vueComponentTypes = new Set();
    this.unusedTypes = new Set();

    // 类型验证相关
    this.errors = [];
    this.warnings = [];

    // 共享资源
    this.sourceFiles = [];
    this.program = null;
    this.typeChecker = null;
  }

  /**
   * 运行完整分析
   */
  async analyze() {
    try {
      await this.initializeTypeScriptProgram();
      await this.scanSourceFiles();
      await this.analyzeWithAST();
      await this.analyzeVueFiles();

      // 类型管理分析
      this.crossReferenceAnalysis();
      this.detectUnusedTypes();

      // 类型验证分析
      await this.runSemanticAnalysis();
      await this.runCodeQualityCheck();

      return this.generateReport();
    } catch (error) {
      console.error("分析过程中出现错误:", error.message);
      throw error;
    }
  }

  /**
   * 初始化 TypeScript 程序
   */
  async initializeTypeScriptProgram() {
    const configPath = ts.findConfigFile(
      this.options.rootDir,
      ts.sys.fileExists,
      "tsconfig.json"
    );

    let compilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      strict: this.options.strict,
      esModuleInterop: true,
      skipLibCheck: this.options.skipLibCheck,
      forceConsistentCasingInFileNames: true,
      noEmit: true,
    };

    let fileNames = [];

    if (configPath) {
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        this.options.rootDir
      );

      compilerOptions = { ...compilerOptions, ...parsedConfig.options };
      fileNames = parsedConfig.fileNames;
    } else {
      fileNames = scanFiles(
        this.options.rootDir,
        [".ts", ".tsx"],
        this.options.exclude
      );
    }

    this.program = ts.createProgram(fileNames, compilerOptions);
    this.typeChecker = this.program.getTypeChecker();

    if (this.options.verbose) {
      console.log(`TypeScript 程序初始化完成，包含 ${fileNames.length} 个文件`);
    }
  }

  /**
   * 扫描源文件
   */
  async scanSourceFiles() {
    const srcDir = join(this.options.rootDir, "src");
    this.sourceFiles = scanFiles(
      srcDir,
      [".ts", ".vue", ".js", ".tsx", ".jsx"],
      this.options.exclude
    );

    if (this.options.verbose) {
      console.log(`扫描到 ${this.sourceFiles.length} 个文件`);
    }
  }

  /**
   * 使用 AST 分析文件
   */
  async analyzeWithAST() {
    if (!this.program) return;

    for (const sourceFile of this.program.getSourceFiles()) {
      if (
        sourceFile.fileName.includes("node_modules") ||
        sourceFile.fileName.includes("lib.") ||
        !this.sourceFiles.includes(sourceFile.fileName)
      ) {
        continue;
      }

      this.visitNode(sourceFile, sourceFile);
    }
  }

  /**
   * 递归访问 AST 节点
   */
  visitNode(node, sourceFile) {
    // 类型管理相关的处理
    switch (node.kind) {
      case ts.SyntaxKind.InterfaceDeclaration:
        this.processInterfaceDeclaration(node, sourceFile);
        break;
      case ts.SyntaxKind.TypeAliasDeclaration:
        this.processTypeAliasDeclaration(node, sourceFile);
        break;
      case ts.SyntaxKind.EnumDeclaration:
        this.processEnumDeclaration(node, sourceFile);
        break;
      case ts.SyntaxKind.ClassDeclaration:
        this.processClassDeclaration(node, sourceFile);
        break;
      case ts.SyntaxKind.ImportDeclaration:
        this.processImportDeclaration(node, sourceFile);
        break;
      case ts.SyntaxKind.ExportDeclaration:
        this.processExportDeclaration(node, sourceFile);
        break;
      case ts.SyntaxKind.TypeReference:
        this.processTypeReference(node, sourceFile);
        break;
    }

    ts.forEachChild(node, (child) => this.visitNode(child, sourceFile));
  }

  /**
   * 检查类型名称是否应该被忽略
   */
  shouldIgnoreType(typeName, filePath = "") {
    for (const pattern of this.options.ignorePatterns) {
      if (pattern instanceof RegExp) {
        if (pattern.test(typeName)) return true;
      } else if (typeof pattern === "string") {
        if (typeName === pattern || typeName.includes(pattern)) return true;
      }
    }

    if (this.options.ignoreVueComponentTypes && filePath.endsWith(".vue")) {
      const vueCommonTypes = [
        "Props",
        "Emits",
        "Slots",
        "Expose",
        "Data",
        "Methods",
        "Computed",
      ];
      if (vueCommonTypes.includes(typeName)) {
        this.vueComponentTypes.add(`${filePath}:${typeName}`);
        return true;
      }
    }

    return false;
  }

  /**
   * 处理接口声明
   */
  processInterfaceDeclaration(node, sourceFile) {
    const name = node.name.text;
    if (this.shouldIgnoreType(name, sourceFile.fileName)) return;

    const lineNumber =
      ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1;
    this.addTypeDefinition(name, {
      type: "interface",
      file: sourceFile.fileName,
      line: lineNumber,
      exported: this.isExported(node),
    });
  }

  /**
   * 处理类型别名声明
   */
  processTypeAliasDeclaration(node, sourceFile) {
    const name = node.name.text;
    if (this.shouldIgnoreType(name, sourceFile.fileName)) return;

    const lineNumber =
      ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1;
    this.addTypeDefinition(name, {
      type: "type",
      file: sourceFile.fileName,
      line: lineNumber,
      exported: this.isExported(node),
    });
  }

  /**
   * 处理枚举声明
   */
  processEnumDeclaration(node, sourceFile) {
    const name = node.name.text;
    if (this.shouldIgnoreType(name, sourceFile.fileName)) return;

    const lineNumber =
      ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1;
    this.addTypeDefinition(name, {
      type: "enum",
      file: sourceFile.fileName,
      line: lineNumber,
      exported: this.isExported(node),
    });
  }

  /**
   * 处理类声明
   */
  processClassDeclaration(node, sourceFile) {
    if (!node.name) return;

    const name = node.name.text;
    if (this.shouldIgnoreType(name, sourceFile.fileName)) return;

    const lineNumber =
      ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1;
    this.addTypeDefinition(name, {
      type: "class",
      file: sourceFile.fileName,
      line: lineNumber,
      exported: this.isExported(node),
    });
  }

  /**
   * 处理导入声明
   */
  processImportDeclaration(node, sourceFile) {
    if (!node.importClause) return;

    const moduleSpecifier = node.moduleSpecifier.text;
    const imports = [];

    if (node.importClause.namedBindings) {
      if (ts.isNamedImports(node.importClause.namedBindings)) {
        node.importClause.namedBindings.elements.forEach((element) => {
          imports.push(element.name.text);
        });
      }
    }

    if (node.importClause.name) {
      imports.push(node.importClause.name.text);
    }

    if (!this.importMap.has(sourceFile.fileName)) {
      this.importMap.set(sourceFile.fileName, []);
    }

    this.importMap.get(sourceFile.fileName).push({
      module: moduleSpecifier,
      imports: imports,
      line: ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1,
    });
  }

  /**
   * 处理导出声明
   */
  processExportDeclaration(node, sourceFile) {
    if (!node.exportClause) return;

    if (ts.isNamedExports(node.exportClause)) {
      node.exportClause.elements.forEach((element) => {
        const exportName = element.name.text;

        if (!this.exportMap.has(sourceFile.fileName)) {
          this.exportMap.set(sourceFile.fileName, new Set());
        }
        this.exportMap.get(sourceFile.fileName).add(exportName);
      });
    }
  }

  /**
   * 处理类型引用
   */
  processTypeReference(node, sourceFile) {
    if (ts.isIdentifier(node.typeName)) {
      const typeName = node.typeName.text;
      this.addTypeUsage(typeName, {
        file: sourceFile.fileName,
        line: ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1,
      });
    }
  }

  /**
   * 分析 Vue 文件
   */
  async analyzeVueFiles() {
    const vueFiles = this.sourceFiles.filter((file) => file.endsWith(".vue"));

    for (const filePath of vueFiles) {
      try {
        const content = readFileSync(filePath, "utf8");
        const scriptMatch =
          content.match(
            /<script[^>]*lang=["']ts["'][^>]*>([\s\S]*?)<\/script>/i
          ) || content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);

        if (scriptMatch) {
          const scriptContent = scriptMatch[1];
          const sourceFile = ts.createSourceFile(
            filePath,
            scriptContent,
            ts.ScriptTarget.Latest,
            true
          );

          this.visitNode(sourceFile, sourceFile);
        }
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`无法分析 Vue 文件 ${filePath}: ${error.message}`);
        }
      }
    }
  }

  /**
   * 运行语义分析（类型验证）
   */
  async runSemanticAnalysis() {
    if (!this.program) return;

    const diagnostics = [
      ...this.program.getSemanticDiagnostics(),
      ...this.program.getSyntacticDiagnostics(),
      ...this.program.getGlobalDiagnostics(),
    ];

    for (const diagnostic of diagnostics) {
      this.processDiagnostic(diagnostic);
    }
  }

  /**
   * 处理诊断信息
   */
  processDiagnostic(diagnostic) {
    const category = diagnostic.category;
    const code = `TS${diagnostic.code}`;
    const messageText = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      "\n"
    );

    let file = "未知文件";
    let line = 0;
    let column = 0;

    if (diagnostic.file) {
      file = diagnostic.file.fileName;
      const position = ts.getLineAndCharacterOfPosition(
        diagnostic.file,
        diagnostic.start
      );
      line = position.line + 1;
      column = position.character + 1;
    }

    const issue = {
      type: "typescript",
      file,
      line,
      column,
      code,
      message: messageText,
      severity: category === ts.DiagnosticCategory.Error ? "error" : "warning",
      category: this.categorizeDiagnostic(diagnostic.code),
    };

    if (category === ts.DiagnosticCategory.Error) {
      this.errors.push(issue);
    } else {
      this.warnings.push(issue);
    }
  }

  /**
   * 运行代码质量检查
   */
  async runCodeQualityCheck() {
    if (!this.program) return;

    for (const sourceFile of this.program.getSourceFiles()) {
      if (
        sourceFile.fileName.includes("node_modules") ||
        sourceFile.fileName.includes("lib.d.ts")
      ) {
        continue;
      }

      this.checkAnyTypeUsage(sourceFile);
      this.checkUnusedImports(sourceFile);
    }
  }

  /**
   * 检查 any 类型使用
   */
  checkAnyTypeUsage(sourceFile) {
    const visitNode = (node) => {
      if (
        ts.isTypeReferenceNode(node) &&
        ts.isIdentifier(node.typeName) &&
        node.typeName.text === "any"
      ) {
        const position = ts.getLineAndCharacterOfPosition(sourceFile, node.pos);
        this.warnings.push({
          type: "code-quality",
          file: sourceFile.fileName,
          line: position.line + 1,
          column: position.character + 1,
          message: "使用了 any 类型，建议使用更具体的类型",
          severity: "warning",
          category: "type-safety",
        });
      }

      ts.forEachChild(node, visitNode);
    };

    visitNode(sourceFile);
  }

  /**
   * 检查未使用的导入
   */
  checkUnusedImports(sourceFile) {
    const importDeclarations = [];
    const usedIdentifiers = new Set();

    const collectImports = (node) => {
      if (ts.isImportDeclaration(node)) {
        importDeclarations.push(node);
      }
      ts.forEachChild(node, collectImports);
    };

    const collectUsages = (node) => {
      if (ts.isIdentifier(node) && node.parent) {
        if (
          !ts.isImportDeclaration(node.parent) &&
          !ts.isImportSpecifier(node.parent) &&
          !ts.isImportClause(node.parent)
        ) {
          usedIdentifiers.add(node.text);
        }
      }
      ts.forEachChild(node, collectUsages);
    };

    collectImports(sourceFile);
    collectUsages(sourceFile);

    for (const importDecl of importDeclarations) {
      if (
        importDecl.importClause?.namedBindings &&
        ts.isNamedImports(importDecl.importClause.namedBindings)
      ) {
        const namedImports = importDecl.importClause.namedBindings;
        for (const element of namedImports.elements) {
          const importName = element.name.text;
          if (!usedIdentifiers.has(importName)) {
            const position = ts.getLineAndCharacterOfPosition(
              sourceFile,
              element.pos
            );
            this.warnings.push({
              type: "unused-import",
              file: sourceFile.fileName,
              line: position.line + 1,
              message: `未使用的导入: ${importName}`,
              severity: "warning",
              category: "code-cleanup",
            });
          }
        }
      }
    }
  }

  // === 类型管理方法 ===

  addTypeDefinition(name, info) {
    const key = `${name}`;

    if (this.typeMap.has(key)) {
      const existingType = this.typeMap.get(key);

      if (existingType.file !== info.file) {
        const existingIsVueComponent = existingType.file.endsWith(".vue");
        const currentIsVueComponent = info.file.endsWith(".vue");

        if (existingIsVueComponent && currentIsVueComponent) {
          const commonVueTypes = ["Props", "Emits", "Slots", "Expose"];
          if (commonVueTypes.includes(name)) {
            this.typeMap.set(`${info.file}:${key}`, info);
            return;
          }
        }

        this.duplicates.add(name);
      }
    }

    this.typeMap.set(key, info);
  }

  addTypeUsage(typeName, usage) {
    if (!this.usageMap.has(typeName)) {
      this.usageMap.set(typeName, []);
    }
    this.usageMap.get(typeName).push(usage);
  }

  crossReferenceAnalysis() {
    for (const [fileName, imports] of this.importMap) {
      for (const importInfo of imports) {
        for (const importedType of importInfo.imports) {
          if (this.usageMap.has(importedType)) {
            const usages = this.usageMap.get(importedType);
            usages.forEach((usage) => {
              if (usage.file === fileName) {
                usage.imported = true;
                usage.importFrom = importInfo.module;
              }
            });
          }
        }
      }
    }
  }

  detectUnusedTypes() {
    const unusedTypes = new Set();

    for (const [typeName, typeInfo] of this.typeMap) {
      if (this.shouldIgnoreType(typeName, typeInfo.file)) continue;

      const usages = this.usageMap.get(typeName) || [];
      const realUsages = usages.filter(
        (usage) => usage.file !== typeInfo.file || usage.line !== typeInfo.line
      );

      if (realUsages.length === 0 && !typeInfo.exported) {
        if (!this.isTypeImportedElsewhere(typeName, typeInfo.file)) {
          unusedTypes.add(typeName);
        }
      }
    }

    this.unusedTypes = unusedTypes;
  }

  isTypeImportedElsewhere(typeName, definitionFile) {
    for (const [fileName, imports] of this.importMap) {
      if (fileName === definitionFile) continue;

      for (const importInfo of imports) {
        if (importInfo.imports.includes(typeName)) {
          const relativePath = relative(fileName, definitionFile);
          if (
            importInfo.module.includes(relativePath) ||
            importInfo.module.includes(typeName)
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // === 工具方法 ===

  isExported(node) {
    return node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    );
  }

  categorizeDiagnostic(code) {
    const categories = {
      2322: "type-mismatch",
      2339: "property-missing",
      2304: "name-not-found",
      2307: "module-resolution",
      2531: "strict-mode",
    };
    return categories[code] || "other";
  }

  // === 报告生成 ===

  generateReport() {
    const totalFiles = this.sourceFiles.length;
    const totalTypes = this.typeMap.size;
    const totalUsages = Array.from(this.usageMap.values()).reduce(
      (sum, usages) => sum + usages.length,
      0
    );

    const healthScore = this.calculateHealthScore();
    const validationScore = this.calculateValidationScore();
    const overallScore = Math.round((healthScore + validationScore) / 2);

    return {
      timestamp: new Date().toISOString(),

      // 统计信息
      statistics: {
        sourceFiles: totalFiles,
        typeDefinitions: totalTypes,
        usageReferences: totalUsages,
        unusedTypes: this.unusedTypes.size,
        duplicateDefinitions: this.duplicates.size,
        ignoredTypes: this.vueComponentTypes.size,
        totalErrors: this.errors.length,
        totalWarnings: this.warnings.length,
      },

      // 分数
      scores: {
        healthScore,
        validationScore,
        overallScore,
      },

      // 详细信息
      details: {
        unusedTypes: Array.from(this.unusedTypes),
        duplicates: Array.from(this.duplicates),
        errors: this.errors,
        warnings: this.warnings,
        typeDefinitions: Object.fromEntries(this.typeMap),
        typeUsages: Object.fromEntries(this.usageMap),
      },

      suggestions: this.generateSuggestions(),
    };
  }

  calculateHealthScore() {
    const totalTypes = this.typeMap.size;
    if (totalTypes === 0) return 100;

    const unusedPenalty = (this.unusedTypes.size / totalTypes) * 40;
    const duplicatePenalty = (this.duplicates.size / totalTypes) * 30;
    const complexityBonus = Math.min(10, totalTypes / 10);

    return Math.max(
      0,
      Math.round(100 - unusedPenalty - duplicatePenalty + complexityBonus)
    );
  }

  calculateValidationScore() {
    const criticalErrors = this.errors.filter((e) =>
      this.isCriticalError(e.code)
    ).length;
    const regularErrors = this.errors.length - criticalErrors;

    const criticalPenalty = criticalErrors * 20;
    const errorPenalty = regularErrors * 10;
    const warningPenalty = this.warnings.length * 2;

    return Math.max(
      0,
      Math.round(100 - criticalPenalty - errorPenalty - warningPenalty)
    );
  }

  isCriticalError(code) {
    return ["TS2322", "TS2339", "TS2304", "TS2307"].includes(code);
  }

  generateSuggestions() {
    const suggestions = [];

    const criticalErrors = this.errors.filter((e) =>
      this.isCriticalError(e.code)
    ).length;
    if (criticalErrors > 0) {
      suggestions.push(`🔴 立即修复 ${criticalErrors} 个关键类型错误`);
    }

    if (this.unusedTypes.size > 0) {
      suggestions.push(
        `💡 发现 ${this.unusedTypes.size} 个未使用的类型定义，建议清理`
      );
    }

    if (this.duplicates.size > 0) {
      suggestions.push(
        `⚠️ 发现 ${this.duplicates.size} 个重复的类型定义，建议合并`
      );
    }

    const unusedImports = this.warnings.filter(
      (w) => w.type === "unused-import"
    ).length;
    if (unusedImports > 0) {
      suggestions.push(`🧹 清理 ${unusedImports} 个未使用的导入`);
    }

    if (suggestions.length === 0) {
      suggestions.push("🎉 类型系统状态良好，代码质量优秀！");
    }

    return suggestions;
  }
}