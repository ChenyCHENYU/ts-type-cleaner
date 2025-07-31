import { readFileSync, existsSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { execSync } from 'child_process'
import ts from "typescript";
import { scanFiles } from "../utils/fileScanner.js";

export class TypeValidator {
  constructor(options = {}) {
    this.options = {
      rootDir: options.rootDir || process.cwd(),
      strict: options.strict || false,
      verbose: options.verbose || false,
      skipLibCheck: true,
      ...options,
    };

    this.errors = [];
    this.warnings = [];
    this.program = null;
    this.typeChecker = null;
  }

  async validate() {
    try {
      await this.initializeTypeScriptProgram();
      await this.runSemanticAnalysis();
      await this.runCodeQualityCheck();
      await this.runTypeScriptCompilerCheck();
      return this.generateValidationReport();
    } catch (error) {
      console.error("验证过程中出现错误:", error.message);
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
      if (configFile.error) {
        this.warnings.push({
          type: "config",
          file: configPath,
          message: `tsconfig.json 解析警告: ${configFile.error.messageText}`,
          severity: "warning",
        });
      }

      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        this.options.rootDir
      );

      compilerOptions = { ...compilerOptions, ...parsedConfig.options };
      fileNames = parsedConfig.fileNames;
    } else {
      // 没有 tsconfig.json 时，扫描所有 TS 文件
      fileNames = scanFiles(
        this.options.rootDir,
        [".ts", ".tsx"],
        ["node_modules", "dist"]
      );

      if (this.options.verbose) {
        console.log("未找到 tsconfig.json，使用默认配置");
      }
    }

    // 创建程序
    this.program = ts.createProgram(fileNames, compilerOptions);
    this.typeChecker = this.program.getTypeChecker();

    if (this.options.verbose) {
      console.log(`TypeScript 程序初始化完成，包含 ${fileNames.length} 个文件`);
    }
  }

  /**
   * 运行语义分析
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

    if (this.options.verbose) {
      console.log(`语义分析完成，发现 ${diagnostics.length} 个问题`);
    }
  }

  /**
   * 处理 TypeScript 诊断信息
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
   * 对诊断进行分类
   */
  categorizeDiagnostic(code) {
    const categories = {
      // 类型错误
      2322: "type-mismatch",
      2339: "property-missing",
      2304: "name-not-found",
      2344: "type-argument",

      // 语法错误
      1005: "syntax",
      1009: "syntax",
      1128: "syntax",

      // 导入导出错误
      2307: "module-resolution",
      2305: "module-resolution",
      2306: "module-resolution",

      // 配置错误
      5023: "config",
      5024: "config",

      // 严格模式错误
      2367: "strict-mode",
      2531: "strict-mode",
      2532: "strict-mode",
    };

    return categories[code] || "other";
  }

  /**
   * 运行代码质量检查
   */
  async runCodeQualityCheck() {
    if (!this.program) return;

    for (const sourceFile of this.program.getSourceFiles()) {
      // 跳过库文件和 node_modules
      if (
        sourceFile.fileName.includes("node_modules") ||
        sourceFile.fileName.includes("lib.d.ts")
      ) {
        continue;
      }

      await this.checkSourceFile(sourceFile);
    }
  }

  /**
   * 检查单个源文件的代码质量
   */
  async checkSourceFile(sourceFile) {
    this.checkAnyTypeUsage(sourceFile);
    this.checkUnusedImports(sourceFile);
    this.checkConsistentTypeImports(sourceFile);
    this.checkTypeAssertions(sourceFile);
    this.checkMissingReturnTypes(sourceFile);
  }

  /**
   * 检查 any 类型使用
   */
  checkAnyTypeUsage(sourceFile) {
    const visitNode = (node) => {
      // 检查类型注解中的 any
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
          suggestion: "考虑使用 unknown、具体的接口类型或联合类型",
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

    // 收集所有导入
    const collectImports = (node) => {
      if (ts.isImportDeclaration(node)) {
        importDeclarations.push(node);
      }
      ts.forEachChild(node, collectImports);
    };

    // 收集所有使用的标识符
    const collectUsages = (node) => {
      if (ts.isIdentifier(node) && node.parent) {
        // 避免计算导入声明本身
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

    // 检查未使用的导入
    for (const importDecl of importDeclarations) {
      if (importDecl.importClause) {
        // 检查默认导入
        if (importDecl.importClause.name) {
          const importName = importDecl.importClause.name.text;
          if (!usedIdentifiers.has(importName)) {
            const position = ts.getLineAndCharacterOfPosition(
              sourceFile,
              importDecl.pos
            );
            this.warnings.push({
              type: "unused-import",
              file: sourceFile.fileName,
              line: position.line + 1,
              message: `未使用的默认导入: ${importName}`,
              severity: "warning",
              category: "code-cleanup",
            });
          }
        }

        // 检查命名导入
        if (
          importDecl.importClause.namedBindings &&
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
                message: `未使用的命名导入: ${importName}`,
                severity: "warning",
                category: "code-cleanup",
              });
            }
          }
        }
      }
    }
  }

  /**
   * 检查一致的类型导入
   */
  checkConsistentTypeImports(sourceFile) {
    const visitNode = (node) => {
      if (ts.isImportDeclaration(node) && node.importClause?.namedBindings) {
        const moduleSpecifier = node.moduleSpecifier.text;

        // 检查是否混合了类型导入和值导入
        if (ts.isNamedImports(node.importClause.namedBindings)) {
          const elements = node.importClause.namedBindings.elements;
          const hasTypeImports = elements.some((el) => el.isTypeOnly);
          const hasValueImports = elements.some((el) => !el.isTypeOnly);

          if (hasTypeImports && hasValueImports) {
            const position = ts.getLineAndCharacterOfPosition(
              sourceFile,
              node.pos
            );
            this.warnings.push({
              type: "code-style",
              file: sourceFile.fileName,
              line: position.line + 1,
              message: "混合了类型导入和值导入，建议分离",
              severity: "info",
              category: "code-style",
              suggestion: "将类型导入和值导入分为两个单独的 import 语句",
            });
          }
        }
      }

      ts.forEachChild(node, visitNode);
    };

    visitNode(sourceFile);
  }

  /**
   * 检查类型断言
   */
  checkTypeAssertions(sourceFile) {
    const visitNode = (node) => {
      if (ts.isTypeAssertionExpression(node) || ts.isAsExpression(node)) {
        const position = ts.getLineAndCharacterOfPosition(sourceFile, node.pos);

        // 检查是否是危险的类型断言
        const targetType = this.typeChecker.getTypeAtLocation(node.type);
        const sourceType = this.typeChecker.getTypeAtLocation(node.expression);

        if (targetType && sourceType) {
          const isUnsafe =
            !this.typeChecker.isTypeAssignableTo(sourceType, targetType) &&
            !this.typeChecker.isTypeAssignableTo(targetType, sourceType);

          if (isUnsafe) {
            this.warnings.push({
              type: "type-safety",
              file: sourceFile.fileName,
              line: position.line + 1,
              message: "可能不安全的类型断言",
              severity: "warning",
              category: "type-safety",
              suggestion: "考虑使用类型守卫或重新设计类型结构",
            });
          }
        }
      }

      ts.forEachChild(node, visitNode);
    };

    visitNode(sourceFile);
  }

  /**
   * 检查缺失的返回类型
   */
  checkMissingReturnTypes(sourceFile) {
    const visitNode = (node) => {
      if (
        (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
        !node.type &&
        node.body
      ) {
        // 跳过构造函数和简单的 getter/setter
        if (ts.isConstructorDeclaration(node) || this.isSimpleAccessor(node)) {
          return;
        }

        const position = ts.getLineAndCharacterOfPosition(sourceFile, node.pos);
        const functionName = node.name ? node.name.getText() : "匿名函数";

        this.warnings.push({
          type: "code-style",
          file: sourceFile.fileName,
          line: position.line + 1,
          message: `函数 ${functionName} 缺少显式返回类型注解`,
          severity: "info",
          category: "code-style",
          suggestion: "添加返回类型注解以提高代码可读性和类型安全性",
        });
      }

      ts.forEachChild(node, visitNode);
    };

    visitNode(sourceFile);
  }

  /**
   * 检查是否是简单的访问器方法
   */
  isSimpleAccessor(node) {
    return (
      node.body &&
      node.body.statements.length === 1 &&
      (ts.isReturnStatement(node.body.statements[0]) ||
        ts.isExpressionStatement(node.body.statements[0]))
    );
  }

  /**
   * 运行 TypeScript 编译器检查（备用方案）
   */
  async runTypeScriptCompilerCheck() {
    if (this.errors.length > 0) {
      // 如果已经通过程序分析找到了错误，就不需要再运行编译器
      return;
    }

    try {
      const configPath = resolve(this.options.rootDir, "tsconfig.json");

      if (existsSync(configPath)) {
        const result = execSync(`npx tsc --noEmit --project "${configPath}"`, {
          cwd: this.options.rootDir,
          stdio: "pipe",
          encoding: "utf8",
          timeout: 30000, // 30秒超时
        });

        if (this.options.verbose) {
          console.log("TypeScript 编译检查通过");
        }
      }
    } catch (error) {
      const output = error.stdout ? error.stdout.toString() : error.message;
      this.parseCompilerOutput(output);
    }
  }

  /**
   * 解析编译器输出
   */
  parseCompilerOutput(output) {
    const errorRegex =
      /([^:]+):(\d+):(\d+)\s+-\s+(error|warning)\s+TS(\d+):\s+(.+)/g;
    let match;

    while ((match = errorRegex.exec(output)) !== null) {
      const issue = {
        type: "typescript-cli",
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        code: `TS${match[5]}`,
        message: match[6],
        severity: match[4],
        category: this.categorizeDiagnostic(parseInt(match[5])),
      };

      if (match[4] === "error") {
        // 避免重复添加已有的错误
        const exists = this.errors.some(
          (e) =>
            e.file === issue.file &&
            e.line === issue.line &&
            e.code === issue.code
        );

        if (!exists) {
          this.errors.push(issue);
        }
      } else {
        this.warnings.push(issue);
      }
    }
  }

  /**
   * 生成验证报告
   */
  generateValidationReport() {
    const totalErrors = this.errors.length;
    const totalWarnings = this.warnings.length;
    const validationScore = this.calculateValidationScore(
      totalErrors,
      totalWarnings
    );

    // 按类别分组
    const errorsByCategory = this.groupByCategory(this.errors);
    const warningsByCategory = this.groupByCategory(this.warnings);

    return {
      timestamp: new Date().toISOString(),
      errors: this.errors,
      warnings: this.warnings,
      validationScore,
      statistics: {
        totalErrors,
        totalWarnings,
        errorsByCategory,
        warningsByCategory,
        criticalIssues: this.errors.filter((e) => this.isCriticalError(e.code))
          .length,
      },
      suggestions: this.generateValidationSuggestions(),
    };
  }

  /**
   * 按类别分组问题
   */
  groupByCategory(issues) {
    const groups = {};
    for (const issue of issues) {
      const category = issue.category || "other";
      if (!groups[category]) {
        groups[category] = 0;
      }
      groups[category]++;
    }
    return groups;
  }

  /**
   * 判断是否是关键错误
   */
  isCriticalError(code) {
    const criticalCodes = ["TS2322", "TS2339", "TS2304", "TS2307", "TS2344"];
    return criticalCodes.includes(code);
  }

  /**
   * 计算验证分数
   */
  calculateValidationScore(errors, warnings) {
    const criticalErrors = this.errors.filter((e) =>
      this.isCriticalError(e.code)
    ).length;
    const regularErrors = errors - criticalErrors;

    const criticalPenalty = criticalErrors * 20; // 关键错误惩罚更重
    const errorPenalty = regularErrors * 10;
    const warningPenalty = warnings * 2;

    return Math.max(
      0,
      Math.round(100 - criticalPenalty - errorPenalty - warningPenalty)
    );
  }

  /**
   * 生成验证建议
   */
  generateValidationSuggestions() {
    const suggestions = [];

    const criticalErrors = this.errors.filter((e) =>
      this.isCriticalError(e.code)
    ).length;
    if (criticalErrors > 0) {
      suggestions.push(
        `🔴 立即修复 ${criticalErrors} 个关键类型错误，这些会影响代码正常运行`
      );
    }

    const typeErrors = this.errors.filter(
      (e) => e.category === "type-mismatch"
    ).length;
    if (typeErrors > 0) {
      suggestions.push(`🔧 修复 ${typeErrors} 个类型匹配错误，提升类型安全性`);
    }

    const codeQualityWarnings = this.warnings.filter(
      (w) => w.category === "code-quality"
    ).length;
    if (codeQualityWarnings > 0) {
      suggestions.push(
        `🟡 改进 ${codeQualityWarnings} 个代码质量问题，减少潜在风险`
      );
    }

    const unusedImports = this.warnings.filter(
      (w) => w.type === "unused-import"
    ).length;
    if (unusedImports > 0) {
      suggestions.push(`🧹 清理 ${unusedImports} 个未使用的导入，保持代码整洁`);
    }

    if (suggestions.length === 0) {
      suggestions.push("🎉 所有类型检查都通过了，代码质量优秀！");
    } else {
      suggestions.push("💡 建议使用 IDE 的自动修复功能来快速解决部分问题");
    }

    return suggestions;
  }
}