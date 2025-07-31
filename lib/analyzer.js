import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, resolve, relative, extname } from 'path'
import ts from 'typescript'

export class TypeAnalyzer {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
    this.srcDir = join(this.rootDir, "src");
    this.verbose = options.verbose || false;

    // 清晰的数据结构
    this.sourceFiles = [];
    this.types = {
      definitions: new Map(), // 类型名 -> 定义信息
      usages: new Map(), // 类型名 -> 使用位置数组
      errors: [], // 真正的类型错误
    };

    // Vue3 + TS 项目特有的全局变量和API
    this.vueGlobals = new Set([
      // Vue 3 Composition API
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
      "onBeforeMount",
      "onBeforeUnmount",
      "onUpdated",
      "onBeforeUpdate",
      "onActivated",
      "onDeactivated",
      "provide",
      "inject",
      "defineComponent",
      "defineAsyncComponent",
      // Vue 3 渲染函数
      "h",
      "Fragment",
      "Text",
      "Comment",
      "Static",
      "Suspense",
      "Teleport",
      // Vue 3 内置类型
      "Ref",
      "ComputedRef",
      "UnwrapRef",
      "ToRef",
      "ToRefs",
      // Vue Router
      "useRouter",
      "useRoute",
      // Pinia
      "defineStore",
      "storeToRefs",
      // VueUse
      "useMessage",
      "useDebounceFn",
      "useThrottleFn",
      // Vue 3 应用实例
      "createApp",
      "createPinia",
    ]);

    // 三方UI库组件（根据项目常用的）
    this.uiComponents = new Set([
      // Naive UI
      "NButton",
      "NInput",
      "NInputNumber",
      "NSelect",
      "NSwitch",
      "NDatePicker",
      "NModal",
      "NTooltip",
      "NSpace",
      "NButtonGroup",
      "NTag",
      "NForm",
      "NFormItem",
      "NTable",
      "NDataTable",
    ]);
  }

  async analyze() {
    console.log("🔍 开始分析 Vue3 + TypeScript 项目类型...");

    try {
      // 1. 扫描源文件
      this.scanSourceFiles();

      // 2. 创建 TypeScript 程序（配置适合Vue项目）
      const program = this.createTSProgram();

      // 3. 收集类型信息
      this.collectTypeDefinitions(program);
      this.collectTypeUsages(program);
      this.collectRealTypeErrors(program);

      // 4. 分析结果
      const report = this.generateReport();

      return report;
    } catch (error) {
      console.error("❌ 分析失败:", error.message);
      throw error;
    }
  }

  // 扫描 src 目录下的 TS/TSX/Vue 文件
  scanSourceFiles() {
    if (!existsSync(this.srcDir)) {
      throw new Error(`src 目录不存在: ${this.srcDir}`);
    }

    this.sourceFiles = this.walkDirectory(this.srcDir)
      .filter((file) => /\.(ts|tsx|vue)$/.test(file))
      .filter((file) => !file.includes(".d.ts")) // 排除声明文件
      .filter((file) => !file.includes("node_modules")); // 排除依赖

    this.log(`📁 找到 ${this.sourceFiles.length} 个源文件`);
  }

  walkDirectory(dir) {
    const files = [];

    try {
      const items = readdirSync(dir);

      for (const item of items) {
        if (item.startsWith(".")) continue; // 跳过隐藏文件

        const fullPath = join(dir, item);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          files.push(...this.walkDirectory(fullPath));
        } else {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // 忽略权限错误等
    }

    return files;
  }

  // 创建适合Vue项目的TypeScript程序
  createTSProgram() {
    const tsFiles = this.sourceFiles.filter((f) => /\.(ts|tsx)$/.test(f));

    // Vue项目优化的编译选项
    const compilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      skipLibCheck: true,
      noEmit: true,
      strict: false,
      allowJs: true,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      isolatedModules: true,
      useDefineForClassFields: true,
      // Vue 特定配置
      jsx: ts.JsxEmit.Preserve,
      jsxFactory: "h",
      jsxFragmentFactory: "Fragment",
    };

    return ts.createProgram(tsFiles, compilerOptions);
  }

  // 收集真正的类型定义（排除Vue相关）
  collectTypeDefinitions(program) {
    // 处理 TS/TSX 文件
    if (program) {
      for (const sourceFile of program.getSourceFiles()) {
        if (this.isProjectFile(sourceFile.fileName)) {
          this.extractDefinitionsFromTS(sourceFile);
        }
      }
    }

    // 处理 Vue 文件
    for (const file of this.sourceFiles) {
      if (file.endsWith(".vue")) {
        this.extractDefinitionsFromVue(file);
      }
    }

    this.log(`🎯 收集到 ${this.types.definitions.size} 个自定义类型定义`);
  }

  isProjectFile(fileName) {
    const normalizedPath = resolve(fileName);
    return this.sourceFiles.some((f) => resolve(f) === normalizedPath);
  }

  extractDefinitionsFromTS(sourceFile) {
    const visit = (node) => {
      const typeInfo = this.getTypeDefinition(node, sourceFile);
      if (typeInfo) {
        this.types.definitions.set(typeInfo.name, typeInfo);
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  extractDefinitionsFromVue(filePath) {
    try {
      const content = readFileSync(filePath, "utf8");

      // 提取 <script setup lang="ts"> 或 <script lang="ts"> 内容
      const scriptRegex =
        /<script[^>]*lang=["']ts["'][^>]*>([\s\S]*?)<\/script>/i;
      const match = content.match(scriptRegex);

      if (match) {
        const scriptContent = match[1];
        const tempSourceFile = ts.createSourceFile(
          filePath,
          scriptContent,
          ts.ScriptTarget.Latest,
          true
        );
        this.extractDefinitionsFromTS(tempSourceFile);
      }
    } catch (error) {
      this.log(`⚠️ 解析 Vue 文件失败: ${filePath}`);
    }
  }

  getTypeDefinition(node, sourceFile) {
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
      // 只收集真正的类型定义，不包括类和函数
    }

    if (!name || this.isBuiltinOrFrameworkType(name)) return null;

    const line = this.getLineNumber(sourceFile, node);
    const isExported = this.hasExportModifier(node);

    return {
      name,
      kind,
      file: resolve(sourceFile.fileName),
      line,
      isExported,
    };
  }

  // 判断是否是内置类型或框架类型
  isBuiltinOrFrameworkType(name) {
    const builtinTypes = [
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
      "Exclude",
      "Extract",
    ];

    const vueTypes = [
      "ComponentPublicInstance",
      "DefineComponent",
      "App",
      "VNode",
      "ComponentOptions",
      "ComputedOptions",
      "MethodOptions",
      "Props",
      "Emits",
      "Slots", // 这些通常是组件相关，不是用户定义的类型
    ];

    return (
      builtinTypes.includes(name) ||
      vueTypes.includes(name) ||
      this.vueGlobals.has(name) ||
      this.uiComponents.has(name)
    );
  }

  // 收集类型使用（只关注自定义类型）
  collectTypeUsages(program) {
    if (program) {
      for (const sourceFile of program.getSourceFiles()) {
        if (this.isProjectFile(sourceFile.fileName)) {
          this.extractUsagesFromTS(sourceFile);
        }
      }
    }

    // 处理 Vue 文件中的类型使用
    for (const file of this.sourceFiles) {
      if (file.endsWith(".vue")) {
        this.extractUsagesFromVue(file);
      }
    }

    this.log(
      `🔗 收集到 ${
        Array.from(this.types.usages.values()).flat().length
      } 个类型引用`
    );
  }

  // 从 Vue 文件中提取类型使用
  extractUsagesFromVue(filePath) {
    try {
      const content = readFileSync(filePath, "utf8");

      // 提取 <script setup lang="ts"> 或 <script lang="ts"> 内容
      const scriptRegex =
        /<script[^>]*lang=["']ts["'][^>]*>([\s\S]*?)<\/script>/i;
      const match = content.match(scriptRegex);

      if (match) {
        const scriptContent = match[1];
        const tempSourceFile = ts.createSourceFile(
          filePath,
          scriptContent,
          ts.ScriptTarget.Latest,
          true
        );
        this.extractUsagesFromTS(tempSourceFile);
      }
    } catch (error) {
      this.log(`⚠️ 解析 Vue 文件类型使用失败: ${filePath}`);
    }
  }

  extractUsagesFromTS(sourceFile) {
    const visit = (node) => {
      // 检查类型引用节点
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        const typeName = node.typeName.text;

        // 只记录自定义类型的使用
        if (!this.isBuiltinOrFrameworkType(typeName)) {
          this.addTypeUsage(typeName, {
            file: resolve(sourceFile.fileName),
            line: this.getLineNumber(sourceFile, node),
          });
        }
      }

      // 检查类型断言 (as Type)
      if (ts.isAsExpression(node) && ts.isTypeReferenceNode(node.type)) {
        if (ts.isIdentifier(node.type.typeName)) {
          const typeName = node.type.typeName.text;

          if (!this.isBuiltinOrFrameworkType(typeName)) {
            this.addTypeUsage(typeName, {
              file: resolve(sourceFile.fileName),
              line: this.getLineNumber(sourceFile, node),
            });
          }
        }
      }

      // 检查尖括号类型断言 (<Type>expression)
      if (ts.isTypeAssertionExpression && ts.isTypeAssertionExpression(node)) {
        if (
          ts.isTypeReferenceNode(node.type) &&
          ts.isIdentifier(node.type.typeName)
        ) {
          const typeName = node.type.typeName.text;

          if (!this.isBuiltinOrFrameworkType(typeName)) {
            this.addTypeUsage(typeName, {
              file: resolve(sourceFile.fileName),
              line: this.getLineNumber(sourceFile, node),
            });
          }
        }
      }

      // 检查变量声明中的类型注解
      if (ts.isVariableDeclaration(node) && node.type) {
        if (
          ts.isTypeReferenceNode(node.type) &&
          ts.isIdentifier(node.type.typeName)
        ) {
          const typeName = node.type.typeName.text;

          if (!this.isBuiltinOrFrameworkType(typeName)) {
            this.addTypeUsage(typeName, {
              file: resolve(sourceFile.fileName),
              line: this.getLineNumber(sourceFile, node),
            });
          }
        }
      }

      // 检查函数参数中的类型注解
      if (ts.isParameter(node) && node.type) {
        if (
          ts.isTypeReferenceNode(node.type) &&
          ts.isIdentifier(node.type.typeName)
        ) {
          const typeName = node.type.typeName.text;

          if (!this.isBuiltinOrFrameworkType(typeName)) {
            this.addTypeUsage(typeName, {
              file: resolve(sourceFile.fileName),
              line: this.getLineNumber(sourceFile, node),
            });
          }
        }
      }

      // 检查函数返回类型注解
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isArrowFunction(node)) &&
        node.type
      ) {
        if (
          ts.isTypeReferenceNode(node.type) &&
          ts.isIdentifier(node.type.typeName)
        ) {
          const typeName = node.type.typeName.text;

          if (!this.isBuiltinOrFrameworkType(typeName)) {
            this.addTypeUsage(typeName, {
              file: resolve(sourceFile.fileName),
              line: this.getLineNumber(sourceFile, node),
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  addTypeUsage(typeName, usage) {
    if (!this.types.usages.has(typeName)) {
      this.types.usages.set(typeName, []);
    }
    this.types.usages.get(typeName).push(usage);
  }

  // 收集真正的类型错误（排除导入和框架相关错误）
  collectRealTypeErrors(program) {
    if (!program) return;

    const diagnostics = ts.getPreEmitDiagnostics(program);

    for (const diagnostic of diagnostics) {
      if (!diagnostic.file || !this.isProjectFile(diagnostic.file.fileName))
        continue;

      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n"
      );

      // 排除常见的非类型错误
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
        severity: this.getErrorSeverity(diagnostic.code),
      });
    }

    this.log(`🚨 发现 ${this.types.errors.length} 个真正的类型错误`);
  }

  // 判断是否应该忽略某些错误
  shouldIgnoreError(code, message) {
    // 忽略导入相关错误
    if (code === 2304) {
      // Cannot find name
      return (
        this.vueGlobals.has(message.match(/Cannot find name '(.+)'/)?.[1]) ||
        this.uiComponents.has(message.match(/Cannot find name '(.+)'/)?.[1])
      );
    }

    // 忽略 Vite 相关错误
    if (
      message.includes("import.meta") ||
      message.includes("ImportMeta") ||
      message.includes("vite") ||
      message.includes("env") ||
      message.includes("glob")
    ) {
      return true;
    }

    // 忽略 import.meta.glob 的类型断言相关错误
    if (
      ((code === 2322 || code === 2345) &&
        message.includes("unknown") &&
        message.includes("Promise<unknown>")) ||
      message.includes("import.meta.glob")
    ) {
      return true;
    }

    // 忽略声明文件相关错误
    if (message.includes(".d.ts") || message.includes("node_modules")) {
      return true;
    }

    return false;
  }

  getErrorSeverity(code) {
    const criticalErrors = [2322, 2345, 2349, 2353]; // 类型不匹配等严重错误
    const warningErrors = [2531, 2532, 2571]; // null/undefined 相关警告

    if (criticalErrors.includes(code)) return "error";
    if (warningErrors.includes(code)) return "warning";
    return "info";
  }

  // 生成分析报告
  generateReport() {
    const duplicates = this.findDuplicateTypes();
    const unused = this.findUnusedTypes();

    // 按严重程度分类错误
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

    const healthScore = this.calculateHealthScore(stats);

    return {
      timestamp: new Date().toISOString(),
      projectPath: this.rootDir,
      statistics: stats,
      healthScore,
      issues: {
        errors,
        warnings,
        duplicates,
        unused,
      },
      recommendations: this.generateRecommendations(stats),
    };
  }

  // 找出真正重复定义的类型
  findDuplicateTypes() {
    const duplicates = {};
    const typesByName = new Map();

    // 按类型名分组
    for (const [typeName, definition] of this.types.definitions) {
      if (!typesByName.has(typeName)) {
        typesByName.set(typeName, []);
      }
      typesByName.get(typeName).push(definition);
    }

    // 找出真正的重复（同名且在不同文件中）
    for (const [typeName, definitions] of typesByName) {
      if (definitions.length > 1) {
        const fileSet = new Set(definitions.map((d) => d.file));
        if (fileSet.size > 1) {
          // 确实在不同文件中定义
          duplicates[typeName] = definitions;
        }
      }
    }

    return duplicates;
  }

  // 找出未使用的自定义类型
  findUnusedTypes() {
    const unused = [];

    for (const [typeName, definition] of this.types.definitions) {
      // 跳过导出的类型（可能被外部使用）
      if (definition.isExported) continue;

      const usages = this.types.usages.get(typeName) || [];

      // 过滤掉定义位置附近的"使用"（定义本身不算使用）
      const actualUsages = usages.filter((usage) => {
        // 不同文件的使用肯定是真实使用
        if (usage.file !== definition.file) return true;

        // 同文件但行号差距较大的也是真实使用
        const lineDiff = Math.abs(usage.line - definition.line);
        return lineDiff > 3; // 放宽到3行以上才算真实使用
      });

      // 如果没有真实使用且不是常见的工具类型名，才标记为未使用
      if (actualUsages.length === 0 && !this.isCommonUtilityType(typeName)) {
        unused.push({
          name: typeName,
          type: definition.kind,
          file: this.relativePath(definition.file),
          line: definition.line,
        });
      }
    }

    return unused;
  }

  // 判断是否是常见的工具类型（通常会在模板或其他地方隐式使用）
  isCommonUtilityType(typeName) {
    const commonNames = [
      "Props",
      "Emits",
      "Slots",
      "Instance",
      "Ref",
      "Data",
      "Methods",
      "Config",
      "Options",
      "State",
      "Store",
      "Route",
      "Router",
    ];

    return commonNames.some(
      (common) =>
        typeName.includes(common) ||
        typeName.endsWith(common) ||
        typeName.startsWith(common)
    );
  }

  // 计算健康度分数
  calculateHealthScore(stats) {
    if (stats.totalTypes === 0) return 100;

    let score = 100;

    // 类型错误严重扣分
    score -= Math.min(60, stats.totalErrors * 15);

    // 重复类型扣分
    const duplicateRatio = stats.duplicateTypes / Math.max(1, stats.totalTypes);
    score -= Math.min(20, duplicateRatio * 100);

    // 未使用类型轻微扣分
    const unusedRatio = stats.unusedTypes / Math.max(1, stats.totalTypes);
    score -= Math.min(10, unusedRatio * 50);

    return Math.max(0, Math.round(score));
  }

  // 生成针对性改进建议
  generateRecommendations(stats) {
    const recommendations = [];

    if (stats.totalErrors > 0) {
      recommendations.push(`🔴 修复 ${stats.totalErrors} 个类型错误`);
    }

    if (stats.duplicateTypes > 0) {
      recommendations.push(`⚠️ 合并 ${stats.duplicateTypes} 个重复类型定义`);
    }

    if (stats.unusedTypes > 5) {
      recommendations.push(`🗑️ 清理 ${stats.unusedTypes} 个未使用的类型定义`);
    }

    if (stats.totalWarnings > 0) {
      recommendations.push(`⚠️ 处理 ${stats.totalWarnings} 个类型警告`);
    }

    if (recommendations.length === 0) {
      recommendations.push("🎉 类型系统状态良好！");
    }

    return recommendations;
  }

  // 工具方法
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