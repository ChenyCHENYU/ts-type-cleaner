import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, unlinkSync } from 'fs'
import { join, resolve, relative } from "path";
import { tmpdir } from "os";
import ts from "typescript";

export class TypeAnalyzer {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
    this.srcDirName = options.srcDir || "src";
    this.srcDir = join(this.rootDir, this.srcDirName);
    this.extraExcludes = (options.exclude || []).map((p) =>
      p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "")
    );
    // 公共 API 白名单：库类项目面向消费者的导出不计为"未使用"
    this.allowSet = new Set(options.allow || []);
    this.verbose = options.verbose || false;

    // 数据结构
    this.sourceFiles = [];
    this.types = {
      definitions: new Map(),
      usages: new Map(),
      errors: [],
    };

    // Vue3 + TS 项目全局变量
    this.excludePatterns = new Set([
      // Vue 3 API
      "ref",
      "reactive",
      "computed",
      "watch",
      "watchEffect",
      "readonly",
      "unref",
      "nextTick",
      "onMounted",
      "onUnmounted",
      "provide",
      "inject",
      "defineComponent",
      "h",
      "Fragment",
      "createApp",
      "createPinia",
      "useRouter",
      "useRoute",
      "defineStore",
      "useMessage",
      "useDebounceFn",
      "useThrottleFn",
      // UI 组件
      "NButton",
      "NInput",
      "NSelect",
      "NModal",
      "NTable",
      "NForm",
    ]);
  }

  async analyze() {
    this.log("🔍 开始分析...");

    try {
      this.scanSourceFiles();
      const program = this.createTSProgram();
      this.collectTypeDefinitions(program);
      this.collectTypeUsages(program);
      this.collectTypeErrors(program);

      // 使用专业库检测
      const unused = await this.detectUnusedTypes();

      return this.generateReport(unused);
    } catch (error) {
      console.error("❌ 分析失败:", error.message);
      throw error;
    }
  }

  // 使用专业库检测未使用类型
  async detectUnusedTypes() {
    try {
      this.log("🔍 使用专业库检测未使用类型...");

      // 创建临时配置：直接用 files 绝对路径（.vue 走本工具自己的解析器，不进 TS 编译）
      // 旧实现把 include 相对路径写进 os.tmpdir() 的配置，TS 按配置所在目录解析导致
      // 永远匹配不到文件、引擎静默空转——这里一并修复
      const tsFiles = this.sourceFiles.filter((file) => /\.(ts|tsx)$/.test(file));
      const tempConfig = {
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "node",
          skipLibCheck: true,
          noEmit: true,
          allowJs: true,
          jsx: "preserve",
        },
        files: tsFiles,
      };

      const tempConfigPath = join(tmpdir(), `.ts-type-cleaner-${Date.now()}.json`);
      writeFileSync(tempConfigPath, JSON.stringify(tempConfig, null, 2));

      // ts-unused-exports v11 的入口是 analyzeTsConfig（analyzeFiles 已不存在）
      const tue = await import("ts-unused-exports");
      const analyzeTsConfig = tue.analyzeTsConfig ?? tue.default?.analyzeTsConfig;
      const result = analyzeTsConfig(tempConfigPath);

      // 清理临时文件
      try {
        unlinkSync(tempConfigPath);
      } catch (e) {}

      // 处理结果：v11 形状为 { unusedExports: { [file]: [{ exportName, location }] } }
      const unusedTypes = [];
      const unusedMap = result?.unusedExports ?? {};
      for (const [filePath, exports] of Object.entries(unusedMap)) {
        for (const item of exports) {
          const exportName = typeof item === "string" ? item : item?.exportName;
          if (!exportName) continue;
          if (
            this.types.definitions.has(exportName) &&
            !this.isCommonType(exportName) &&
            !this.allowSet.has(exportName)
          ) {
            const definition = this.types.definitions.get(exportName)[0];
            unusedTypes.push({
              name: exportName,
              type: definition.kind,
              file: this.relativePath(definition.file),
              line: definition.line,
              detectedBy: "ts-unused-exports",
            });
          }
        }
      }

      this.log(`🎯 检测到 ${unusedTypes.length} 个未使用类型`);
      return unusedTypes;
    } catch (error) {
      this.log(`⚠️ 专业库检测失败，使用基础检测`);
      return this.basicUnusedDetection();
    }
  }

  // 基础未使用检测（备用）
  basicUnusedDetection() {
    const unused = [];
    for (const [typeName, definitions] of this.types.definitions) {
      const definition = definitions[0];
      if (
        !definition.isExported &&
        !this.isCommonType(typeName) &&
        !this.allowSet.has(typeName) &&
        (this.types.usages.get(typeName) || []).length === 0
      ) {
        unused.push({
          name: typeName,
          type: definition.kind,
          file: this.relativePath(definition.file),
          line: definition.line,
          detectedBy: "basic-detection",
        });
      }
    }
    return unused;
  }

  // 扫描源文件
  scanSourceFiles() {
    if (!existsSync(this.srcDir)) {
      throw new Error(`源码目录不存在: ${this.srcDir}（可用 --src 指定）`);
    }

    this.sourceFiles = this.walkDirectory(this.srcDir)
      .filter((file) => /\.(ts|tsx|vue)$/.test(file))
      .filter(
        (file) =>
          !file.includes(".d.ts") &&
          !file.includes("node_modules") &&
          !this.isStoreFile(file) &&
          !this.isExtraExcluded(file)
      );

    this.log(`📁 找到 ${this.sourceFiles.length} 个源文件`);
  }

  walkDirectory(dir) {
    const files = [];
    try {
      const items = readdirSync(dir);
      for (const item of items) {
        if (item.startsWith(".")) continue;

        const fullPath = join(dir, item);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          files.push(...this.walkDirectory(fullPath));
        } else {
          files.push(fullPath);
        }
      }
    } catch (error) {}
    return files;
  }

  // 创建 TypeScript 程序
  // 优先采用项目自身 tsconfig 的编译选项，保证类型错误判定与项目 tsc 口径一致
  // （旧实现硬编码选项，缺少 esModuleInterop 等配置时会产生 TS1259 类假阳性）
  loadProjectCompilerOptions() {
    try {
      const tsconfigPath = join(this.rootDir, "tsconfig.json");
      if (!existsSync(tsconfigPath)) return {};
      const raw = readFileSync(tsconfigPath, "utf8");
      const json = ts.parseConfigFileTextToJson(tsconfigPath, raw);
      const parsed = ts.parseJsonConfigFileContent(json.config, ts.sys, this.rootDir);
      return parsed.options ?? {};
    } catch {
      return {};
    }
  }

  createTSProgram() {
    const tsFiles = this.sourceFiles.filter((f) => /\.(ts|tsx)$/.test(f));
    const compilerOptions = {
      ...this.loadProjectCompilerOptions(),
      noEmit: true,
    };
    compilerOptions.target ??= ts.ScriptTarget.ES2020;
    compilerOptions.module ??= ts.ModuleKind.ESNext;
    compilerOptions.moduleResolution ??= ts.ModuleResolutionKind.NodeJs;
    compilerOptions.skipLibCheck ??= true;
    compilerOptions.allowJs ??= true;
    compilerOptions.jsx ??= ts.JsxEmit.Preserve;

    return ts.createProgram(tsFiles, compilerOptions);
  }

  // 收集类型定义
  collectTypeDefinitions(program) {
    // 处理 TS/TSX 文件
    if (program) {
      for (const sourceFile of program.getSourceFiles()) {
        if (this.isProjectFile(sourceFile.fileName)) {
          this.extractDefinitionsFromFile(sourceFile);
        }
      }
    }

    // 处理 Vue 文件
    this.sourceFiles
      .filter((file) => file.endsWith(".vue"))
      .forEach((file) => this.extractDefinitionsFromVue(file));

    this.log(`🎯 收集到 ${this.types.definitions.size} 个类型定义`);
  }

  extractDefinitionsFromFile(sourceFile) {
    const visit = (node) => {
      const typeInfo = this.getTypeInfo(node, sourceFile);
      if (typeInfo) {
        if (!this.types.definitions.has(typeInfo.name)) {
          this.types.definitions.set(typeInfo.name, []);
        }
        this.types.definitions.get(typeInfo.name).push(typeInfo);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  extractDefinitionsFromVue(filePath) {
    try {
      const content = readFileSync(filePath, "utf8");
      const scriptMatch = content.match(
        /<script[^>]*lang=["']ts["'][^>]*>([\s\S]*?)<\/script>/i
      );

      if (scriptMatch) {
        const tempSourceFile = ts.createSourceFile(
          filePath,
          scriptMatch[1],
          ts.ScriptTarget.Latest,
          true
        );
        this.extractDefinitionsFromFile(tempSourceFile);
      }
    } catch (error) {
      this.log(`⚠️ 解析 Vue 文件失败: ${filePath}`);
    }
  }

  getTypeInfo(node, sourceFile) {
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
    }

    if (!name || this.isBuiltinType(name)) return null;

    return {
      name,
      kind,
      file: resolve(sourceFile.fileName),
      line: this.getLineNumber(sourceFile, node),
      isExported: this.hasExportModifier(node),
    };
  }

  // 收集类型使用
  collectTypeUsages(program) {
    if (program) {
      for (const sourceFile of program.getSourceFiles()) {
        if (this.isProjectFile(sourceFile.fileName)) {
          this.extractUsagesFromFile(sourceFile);
        }
      }
    }

    // 处理 Vue 文件
    this.sourceFiles
      .filter((file) => file.endsWith(".vue"))
      .forEach((file) => this.extractUsagesFromVue(file));

    this.log(
      `🔗 收集到 ${
        Array.from(this.types.usages.values()).flat().length
      } 个类型引用`
    );
  }

  extractUsagesFromFile(sourceFile) {
    const visit = (node) => {
      // 简化的类型使用检测
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        const typeName = node.typeName.text;
        if (!this.isBuiltinType(typeName)) {
          this.addTypeUsage(typeName, {
            file: resolve(sourceFile.fileName),
            line: this.getLineNumber(sourceFile, node),
          });
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  extractUsagesFromVue(filePath) {
    try {
      const content = readFileSync(filePath, "utf8");
      const scriptMatch = content.match(
        /<script[^>]*lang=["']ts["'][^>]*>([\s\S]*?)<\/script>/i
      );

      if (scriptMatch) {
        const tempSourceFile = ts.createSourceFile(
          filePath,
          scriptMatch[1],
          ts.ScriptTarget.Latest,
          true
        );
        this.extractUsagesFromFile(tempSourceFile);
      }
    } catch (error) {}
  }

  // 收集类型错误
  collectTypeErrors(program) {
    if (!program) return;

    const diagnostics = ts.getPreEmitDiagnostics(program);

    for (const diagnostic of diagnostics) {
      if (!diagnostic.file || !this.isProjectFile(diagnostic.file.fileName))
        continue;

      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n"
      );

      if (this.shouldIgnoreError(diagnostic.code, message)) continue;

      const position = diagnostic.start
        ? ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start)
        : { line: 0, character: 0 };

      this.types.errors.push({
        file: resolve(diagnostic.file.fileName),
        line: position.line + 1,
        column: position.character + 1,
        code: `TS${diagnostic.code}`,
        message: message.trim(),
        severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" :
                  diagnostic.category === ts.DiagnosticCategory.Warning ? "warning" : "info",
      });
    }

    this.log(`🚨 发现 ${this.types.errors.length} 个类型错误`);
  }

  // 生成报告
  generateReport(unused = []) {
    const duplicates = this.findDuplicateTypes();
    const errors = this.types.errors.filter((e) => e.severity === "error");
    const warnings = this.types.errors.filter((e) => e.severity === "warning");

    const stats = {
      totalFiles: this.sourceFiles.length,
      totalTypes: this.types.definitions.size,
      totalUsages: Array.from(this.types.usages.values()).flat().length,
      totalErrors: errors.length,
      totalWarnings: warnings.length,
      duplicateTypes: Object.keys(duplicates).length,
      unusedTypes: unused.length,
    };

    return {
      timestamp: new Date().toISOString(),
      projectPath: this.rootDir,
      statistics: stats,
      healthScore: this.calculateHealthScore(stats),
      issues: { errors, warnings, duplicates, unused },
      recommendations: this.generateRecommendations(stats),
      analysisMethod:
        unused.length > 0 ? unused[0]?.detectedBy || "hybrid" : "none",
    };
  }

  // 工具方法
  findDuplicateTypes() {
    const duplicates = {};
    for (const [typeName, definitions] of this.types.definitions) {
      if (definitions.length > 1) {
        const fileSet = new Set(definitions.map((d) => d.file));
        if (fileSet.size > 1) {
          duplicates[typeName] = definitions;
        }
      }
    }
    return duplicates;
  }

  calculateHealthScore(stats) {
    if (stats.totalTypes === 0) return 100;

    let score = 100;
    score -= Math.min(60, stats.totalErrors * 15);
    score -= Math.min(20, (stats.duplicateTypes / stats.totalTypes) * 100);
    score -= Math.min(10, (stats.unusedTypes / stats.totalTypes) * 50);

    return Math.max(0, Math.round(score));
  }

  generateRecommendations(stats) {
    const recommendations = [];

    if (stats.totalErrors > 0) {
      recommendations.push(`🔴 修复 ${stats.totalErrors} 个类型错误`);
    }
    if (stats.duplicateTypes > 0) {
      recommendations.push(`⚠️ 合并 ${stats.duplicateTypes} 个重复类型`);
    }
    if (stats.unusedTypes > 5) {
      recommendations.push(`🗑️ 清理 ${stats.unusedTypes} 个未使用类型`);
    }

    return recommendations.length > 0
      ? recommendations
      : ["🎉 类型系统状态良好！"];
  }

  // 辅助方法
  shouldIgnoreError(code, message) {
    if (code === 2304) {
      const typeName = message.match(/Cannot find name '(.+)'/)?.[1];
      return this.excludePatterns.has(typeName);
    }

    return (
      message.includes("import.meta") ||
      message.includes("vite") ||
      message.includes(".d.ts") ||
      ((code === 2322 || code === 2345) &&
        message.includes("unknown") &&
        message.includes("Promise"))
    );
  }

  isBuiltinType(name) {
    const builtins = [
      "string",
      "number",
      "boolean",
      "object",
      "undefined",
      "null",
      "Array",
      "Promise",
      "Date",
      "RegExp",
      "Error",
      "Function",
      "Record",
      "Partial",
      "Required",
      "Pick",
      "Omit",
    ];
    return builtins.includes(name) || this.excludePatterns.has(name);
  }

  isCommonType(typeName) {
    const patterns = ["Props", "Emits", "Config", "Options", "State", "Window"];
    return patterns.some((p) => typeName.includes(p) || typeName.endsWith(p));
  }

  isStoreFile(filePath) {
    return filePath.replace(/\\/g, "/").includes("/stores/");
  }

  isExtraExcluded(filePath) {
    const normalized = filePath.replace(/\\/g, "/");
    return this.extraExcludes.some(
      (p) => normalized.includes(`/${p}/`) || normalized.endsWith(`/${p}`)
    );
  }

  isProjectFile(fileName) {
    const normalizedPath = resolve(fileName);
    return this.sourceFiles.some((f) => resolve(f) === normalizedPath);
  }

  addTypeUsage(typeName, usage) {
    if (!this.types.usages.has(typeName)) {
      this.types.usages.set(typeName, []);
    }
    this.types.usages.get(typeName).push(usage);
  }

  getLineNumber(sourceFile, node) {
    try {
      const start = node.getStart ? node.getStart() : node.pos;
      const position = ts.getLineAndCharacterOfPosition(sourceFile, start);
      return position.line + 1;
    } catch (error) {
      return 1;
    }
  }

  hasExportModifier(node) {
    return (
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
      ) || false
    );
  }

  relativePath(filePath) {
    return relative(this.rootDir, filePath).replace(/\\/g, "/");
  }

  log(message) {
    if (this.verbose) {
      console.log(message);
    }
  }
}