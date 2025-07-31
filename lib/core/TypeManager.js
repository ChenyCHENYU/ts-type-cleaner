import { readFileSync, existsSync } from "fs";
import { join, relative } from "path";
import ts from "typescript";
import { scanFiles } from "../utils/fileScanner.js";

export class TypeManager {
  constructor(options = {}) {
    this.options = {
      rootDir: options.rootDir || process.cwd(),
      outputDir: options.outputDir || "./type-reports",
      exclude: options.exclude || ["node_modules", "dist", ".git"],
      verbose: options.verbose || false,
      ...options,
    };

    this.typeMap = new Map(); // 存储类型定义信息
    this.usageMap = new Map(); // 存储类型使用信息
    this.exportMap = new Map(); // 存储导出信息
    this.importMap = new Map(); // 存储导入信息
    this.duplicates = new Set();
    this.sourceFiles = [];
    this.program = null;
  }

  async analyze() {
    try {
      await this.initializeTypeScriptProgram();
      await this.scanSourceFiles();
      await this.analyzeWithAST();
      await this.analyzeVueFiles();
      this.crossReferenceAnalysis();
      this.detectIssues();
      return this.generateReport();
    } catch (error) {
      console.error("分析过程中出现错误:", error.message);
      throw error;
    }
  }

  /**
   * 初始化 TypeScript 程序用于 AST 分析
   */
  async initializeTypeScriptProgram() {
    const configPath = ts.findConfigFile(
      this.options.rootDir,
      ts.sys.fileExists,
      "tsconfig.json"
    );

    if (configPath) {
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        this.options.rootDir
      );

      this.program = ts.createProgram(
        parsedConfig.fileNames,
        parsedConfig.options
      );
    } else {
      // 如果没有 tsconfig.json，使用默认配置
      const compilerOptions = {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
      };

      const fileNames = scanFiles(
        this.options.rootDir,
        [".ts"],
        this.options.exclude
      );
      this.program = ts.createProgram(fileNames, compilerOptions);
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
   * 使用 AST 分析 TypeScript 文件
   */
  async analyzeWithAST() {
    if (!this.program) return;

    for (const sourceFile of this.program.getSourceFiles()) {
      // 跳过 lib 文件和 node_modules
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

    // 递归访问子节点
    ts.forEachChild(node, (child) => this.visitNode(child, sourceFile));
  }

  /**
   * 处理接口声明
   */
  processInterfaceDeclaration(node, sourceFile) {
    const name = node.name.text;
    const lineNumber =
      ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1;

    this.addTypeDefinition(name, {
      type: "interface",
      file: sourceFile.fileName,
      line: lineNumber,
      exported: this.isExported(node),
      node: node,
    });
  }

  /**
   * 处理类型别名声明
   */
  processTypeAliasDeclaration(node, sourceFile) {
    const name = node.name.text;
    const lineNumber =
      ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1;

    this.addTypeDefinition(name, {
      type: "type",
      file: sourceFile.fileName,
      line: lineNumber,
      exported: this.isExported(node),
      node: node,
    });
  }

  /**
   * 处理枚举声明
   */
  processEnumDeclaration(node, sourceFile) {
    const name = node.name.text;
    const lineNumber =
      ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1;

    this.addTypeDefinition(name, {
      type: "enum",
      file: sourceFile.fileName,
      line: lineNumber,
      exported: this.isExported(node),
      node: node,
    });
  }

  /**
   * 处理类声明
   */
  processClassDeclaration(node, sourceFile) {
    if (!node.name) return;

    const name = node.name.text;
    const lineNumber =
      ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1;

    this.addTypeDefinition(name, {
      type: "class",
      file: sourceFile.fileName,
      line: lineNumber,
      exported: this.isExported(node),
      node: node,
    });
  }

  /**
   * 处理导入声明
   */
  processImportDeclaration(node, sourceFile) {
    if (!node.importClause) return;

    const moduleSpecifier = node.moduleSpecifier.text;
    const imports = [];

    // 命名导入
    if (node.importClause.namedBindings) {
      if (ts.isNamedImports(node.importClause.namedBindings)) {
        node.importClause.namedBindings.elements.forEach((element) => {
          imports.push(element.name.text);
        });
      }
    }

    // 默认导入
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

        // 提取 <script> 标签内容
        const scriptMatch =
          content.match(
            /<script[^>]*lang=["']ts["'][^>]*>([\s\S]*?)<\/script>/i
          ) || content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);

        if (scriptMatch) {
          const scriptContent = scriptMatch[1];

          // 使用 TypeScript 解析 Vue 文件中的 script 内容
          const sourceFile = ts.createSourceFile(
            filePath,
            scriptContent,
            ts.ScriptTarget.Latest,
            true
          );

          this.visitNode(sourceFile, sourceFile);
        }

        // 分析模板中的类型使用
        this.analyzeVueTemplate(content, filePath);
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`无法分析 Vue 文件 ${filePath}: ${error.message}`);
        }
      }
    }
  }

  /**
   * 分析 Vue 模板中的类型使用
   */
  analyzeVueTemplate(content, filePath) {
    // 提取模板内容
    const templateMatch = content.match(
      /<template[^>]*>([\s\S]*?)<\/template>/i
    );
    if (!templateMatch) return;

    const templateContent = templateMatch[1];

    // 分析 v-for 中的类型使用
    const vForMatches = templateContent.matchAll(/v-for=["'].*?\bin\s+(\w+)/g);
    for (const match of vForMatches) {
      const typeName = match[1];
      this.addTypeUsage(typeName, {
        file: filePath,
        line: this.getLineNumber(content, match.index),
        context: "vue-template",
      });
    }

    // 分析其他可能的类型引用
    const typeRefMatches = templateContent.matchAll(/\b([A-Z][A-Za-z0-9]*)\b/g);
    for (const match of typeRefMatches) {
      const typeName = match[1];
      if (this.typeMap.has(typeName)) {
        this.addTypeUsage(typeName, {
          file: filePath,
          line: this.getLineNumber(content, match.index),
          context: "vue-template",
        });
      }
    }
  }

  /**
   * 添加类型定义
   */
  addTypeDefinition(name, info) {
    if (this.typeMap.has(name)) {
      this.duplicates.add(name);
    }

    this.typeMap.set(name, info);
  }

  /**
   * 添加类型使用
   */
  addTypeUsage(typeName, usage) {
    if (!this.usageMap.has(typeName)) {
      this.usageMap.set(typeName, []);
    }
    this.usageMap.get(typeName).push(usage);
  }

  /**
   * 交叉引用分析
   */
  crossReferenceAnalysis() {
    // 分析导入的类型是否被使用
    for (const [fileName, imports] of this.importMap) {
      for (const importInfo of imports) {
        for (const importedType of importInfo.imports) {
          if (this.usageMap.has(importedType)) {
            // 标记为被使用的导入类型
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

  /**
   * 检测问题
   */
  detectIssues() {
    const unusedTypes = new Set();

    for (const [typeName, typeInfo] of this.typeMap) {
      const usages = this.usageMap.get(typeName) || [];

      // 过滤掉自身定义
      const realUsages = usages.filter(
        (usage) => usage.file !== typeInfo.file || usage.line !== typeInfo.line
      );

      // 如果类型被导出，即使内部没有使用也不算未使用
      if (realUsages.length === 0 && !typeInfo.exported) {
        // 检查是否在其他文件中被导入使用
        const isImportedElsewhere = this.isTypeImportedElsewhere(
          typeName,
          typeInfo.file
        );

        if (!isImportedElsewhere) {
          unusedTypes.add(typeName);
        }
      }
    }

    this.unusedTypes = unusedTypes;
  }

  /**
   * 检查类型是否在其他文件中被导入使用
   */
  isTypeImportedElsewhere(typeName, definitionFile) {
    for (const [fileName, imports] of this.importMap) {
      if (fileName === definitionFile) continue;

      for (const importInfo of imports) {
        if (importInfo.imports.includes(typeName)) {
          // 检查导入的模块是否指向定义文件
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

  /**
   * 检查节点是否被导出
   */
  isExported(node) {
    return (
      node.modifiers &&
      node.modifiers.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
      )
    );
  }

  /**
   * 生成报告
   */
  generateReport() {
    const totalFiles = this.sourceFiles.length;
    const totalTypes = this.typeMap.size;
    const totalUsages = Array.from(this.usageMap.values()).reduce(
      (sum, usages) => sum + usages.length,
      0
    );

    const healthScore = this.calculateHealthScore(
      totalTypes,
      this.unusedTypes.size,
      this.duplicates.size
    );

    const typeDefinitions = {};
    for (const [name, info] of this.typeMap) {
      typeDefinitions[name] = {
        ...info,
        node: undefined, // 移除 AST 节点避免序列化问题
      };
    }

    return {
      timestamp: new Date().toISOString(),
      sourceFiles: totalFiles,
      typeDefinitions: totalTypes,
      usageReferences: totalUsages,
      unusedTypes: this.unusedTypes.size,
      duplicateDefinitions: this.duplicates.size,
      healthScore,
      details: {
        unusedTypes: Array.from(this.unusedTypes),
        duplicates: Array.from(this.duplicates),
        typeDefinitions,
        typeUsages: Object.fromEntries(this.usageMap),
      },
      suggestions: this.generateSuggestions(),
    };
  }

  /**
   * 计算健康分数
   */
  calculateHealthScore(totalTypes, unusedCount, duplicateCount) {
    if (totalTypes === 0) return 100;

    const unusedPenalty = (unusedCount / totalTypes) * 40;
    const duplicatePenalty = (duplicateCount / totalTypes) * 30;
    const complexityBonus = Math.min(10, totalTypes / 10); // 复杂项目给予一定容错

    return Math.max(
      0,
      Math.round(100 - unusedPenalty - duplicatePenalty + complexityBonus)
    );
  }

  /**
   * 生成建议
   */
  generateSuggestions() {
    const suggestions = [];

    if (this.unusedTypes.size > 0) {
      suggestions.push(
        `💡 发现 ${this.unusedTypes.size} 个真正未使用的类型定义，建议审核后清理`
      );
    }

    if (this.duplicates.size > 0) {
      suggestions.push(
        `⚠️ 发现 ${this.duplicates.size} 个重复的类型定义，建议合并或重命名`
      );
    }

    const exportedButUnused = Array.from(this.typeMap.entries()).filter(
      ([name, info]) => info.exported && this.unusedTypes.has(name)
    );

    if (exportedButUnused.length > 0) {
      suggestions.push(
        `🔍 ${exportedButUnused.length} 个导出的类型可能未被外部使用，建议检查API设计`
      );
    }

    if (suggestions.length === 0) {
      suggestions.push("🎉 类型系统状态良好，代码质量优秀！");
    }

    return suggestions;
  }

  /**
   * 获取行号
   */
  getLineNumber(content, index) {
    return content.substring(0, index).split("\n").length;
  }
}
