import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, unlinkSync } from 'fs'
import { join, resolve, relative } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import ts from "typescript";

// 解析 tsc/vue-tsc 的诊断输出（两种历史格式）：
//   新版: src/a.ts:12:5 - error TS2322: Type 'x' is not assignable...
//   旧版: src/a.ts(12,5): error TS2322: Type 'x' is not assignable...
export function parseCompilerDiagnostics(text) {
  const errors = [];
  const patterns = [
    /^(.+?):(\d+):(\d+)\s*-\s*(error|warning)\s+(TS\d+):\s*(.*)$/,
    /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.*)$/,
  ];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    for (const re of patterns) {
      const m = line.match(re);
      if (m) {
        errors.push({
          file: m[1],
          line: parseInt(m[2], 10),
          column: parseInt(m[3], 10),
          severity: m[4],
          code: m[5],
          message: m[6],
        });
        break;
      }
    }
  }
  return errors;
}

export class TypeAnalyzer {
  constructor(options = {}) {
    // resolve：允许相对路径传入（否则临时配置里的 files 也是相对路径，
    // 在 os.tmpdir() 下解析失败导致 ts-unused-exports 静默降级）
    this.rootDir = resolve(options.rootDir || process.cwd());
    this.srcDirName = options.srcDir || "src";
    this.srcDir = join(this.rootDir, this.srcDirName);
    this.extraExcludes = (options.exclude || []).map((p) =>
      p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "")
    );
    // 公共 API 白名单：库类项目面向消费者的导出不计为"未使用"
    this.allowSet = new Set(options.allow || []);
    this.verbose = options.verbose || false;

    // 命名豁免：默认只豁免 Vue SFC 惯用名（defineProps/defineEmits 配套），
    // 收窄旧版的 Props/Emits/Config/Options/State/Window 宽匹配（漏报大户）；
    // 用户可用 ignorePattern 追加
    this.defaultNameExemptions = ["Props", "Emits"];
    this.extraNameExemptions = options.ignorePattern || [];
    this.namingExempted = []; // 被命名豁免跳过的类型名（报告用）

    // 检测过程指标（报告用）
    this.detectionEngine = "unknown"; // ts-unused-exports | basic-detection
    this.crossValidatedOut = 0; // 被本工具 usages 交叉验证否决的数量
    this.degraded = false; // 专业库是否降级

    // 错误检测口径：auto（默认，装了 vue-tsc 就用它）| tsc | vue-tsc
    this.errorEngineOption = options.errorEngine || "auto";
    this.errorEngine = null; // 实际使用的错误引擎（报告用）
    this.errorsSkipped = false; // --no-errors 时为真
    this.skipErrors = options.skipErrors || false;

    // 数据结构
    this.sourceFiles = [];
    this.sourceFileSet = new Set();
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
      await this.collectTypeErrors(program);

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

      // 创建临时配置：files 用绝对路径（.vue 走本工具自己的解析器，不进 TS 编译）
      const tsFiles = this.sourceFiles.filter((file) => /\.(ts|tsx)$/.test(file));
      // 透传项目 tsconfig 的 baseUrl/paths：alias 导入（如 @/types）解析不了时
      // ts-unused-exports 会把"被人 import"误判为"无人使用"
      const projectOptions = this.loadProjectCompilerOptions();
      const tempConfig = {
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "node",
          skipLibCheck: true,
          noEmit: true,
          allowJs: true,
          jsx: "preserve",
          ...(projectOptions.baseUrl ? { baseUrl: projectOptions.baseUrl } : {}),
          ...(projectOptions.paths ? { paths: projectOptions.paths } : {}),
        },
        files: tsFiles,
      };

      const tempConfigPath = join(tmpdir(), `.ts-type-cleaner-${Date.now()}.json`);
      writeFileSync(tempConfigPath, JSON.stringify(tempConfig, null, 2));

      // ts-unused-exports v11 的入口是 analyzeTsConfig（analyzeFiles 已不存在）
      const tue = await import("ts-unused-exports");
      const analyzeTsConfig = tue.analyzeTsConfig ?? tue.default?.analyzeTsConfig;
      let result;
      try {
        result = analyzeTsConfig(tempConfigPath);
      } finally {
        // 清理临时文件（引擎抛错也不能残留）
        try {
          unlinkSync(tempConfigPath);
        } catch (e) {}
      }

      this.detectionEngine = "ts-unused-exports";

      // 处理结果：v11 形状为 { unusedExports: { [file]: [{ exportName, location }] } }
      // ts-unused-exports 的文件清单不含 .vue，看不到 .vue 的 import——
      // 必须用本工具收集的 usages（含 .vue 类型引用）交叉否决，否则会
      // 把"仅被 .vue 使用"的类型误报为可删除
      const unusedTypes = [];
      const unusedMap = result?.unusedExports ?? {};
      for (const [filePath, exports] of Object.entries(unusedMap)) {
        for (const item of exports) {
          const exportName = typeof item === "string" ? item : item?.exportName;
          if (!exportName) continue;
          if (!this.types.definitions.has(exportName)) continue;
          if (this.allowSet.has(exportName)) continue;
          if (this.isExemptByName(exportName)) {
            this.trackNamingExemption(exportName);
            continue;
          }
          if (this.hasExternalUsage(exportName)) {
            this.crossValidatedOut++;
            continue;
          }
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

      // ts-unused-exports 只分析导出；未导出且无引用的局部类型由基础检测补充
      const localUnused = this.detectUnusedLocalTypes();
      const seen = new Set(unusedTypes.map((u) => u.name));
      for (const item of localUnused) {
        if (!seen.has(item.name)) unusedTypes.push(item);
      }

      this.log(
        `🎯 检测到 ${unusedTypes.length} 个未使用类型（交叉否决 ${this.crossValidatedOut} 个，命名豁免 ${this.namingExempted.length} 个）`
      );
      return unusedTypes;
    } catch (error) {
      // 降级必须可见：静默降级到 basic 会让"导出未使用"整体漏报且用户无感知
      this.degraded = true;
      this.detectionEngine = "basic-detection";
      console.warn(
        `⚠️ ts-unused-exports 检测失败（${error.message}），已降级为基础检测——导出类型的未使用判定可能不完整`
      );
      if (this.verbose) {
        console.warn(error.stack);
      }
      return this.basicUnusedDetection();
    }
  }

  // 该类型是否存在"定义自身以外"的引用（自引用如 type Tree = { children: Tree[] } 不算）
  hasExternalUsage(typeName) {
    const definitions = this.types.definitions.get(typeName) || [];
    const defKeys = new Set(definitions.map((d) => `${d.file}:${d.line}`));
    const usages = this.types.usages.get(typeName) || [];
    return usages.some((u) => !defKeys.has(`${u.file}:${u.line}`));
  }

  // 未导出且无任何引用的局部类型（ts-unused-exports 只分析导出，这是它的盲区）；
  // .vue 中导出的类型同样不在 ts-unused-exports 的 ts 文件清单里，一并覆盖
  detectUnusedLocalTypes() {
    const unused = [];
    for (const [typeName, definitions] of this.types.definitions) {
      const definition = definitions[0];
      if (definition.isExported && !definition.file.endsWith(".vue")) continue;
      if (this.allowSet.has(typeName)) continue;
      if (this.isExemptByName(typeName)) {
        this.trackNamingExemption(typeName);
        continue;
      }
      if (this.hasExternalUsage(typeName)) continue;
      unused.push({
        name: typeName,
        type: definition.kind,
        file: this.relativePath(definition.file),
        line: definition.line,
        detectedBy: "local-detection",
      });
    }
    return unused;
  }

  // 基础未使用检测（备用）
  basicUnusedDetection() {
    const unused = [];
    for (const [typeName, definitions] of this.types.definitions) {
      const definition = definitions[0];
      if (this.allowSet.has(typeName)) continue;
      if (this.isExemptByName(typeName)) {
        this.trackNamingExemption(typeName);
        continue;
      }
      if (this.hasExternalUsage(typeName)) continue;
      unused.push({
        name: typeName,
        type: definition.kind,
        file: this.relativePath(definition.file),
        line: definition.line,
        detectedBy: "basic-detection",
      });
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
    this.sourceFileSet = new Set(this.sourceFiles.map((f) => resolve(f)));

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

  extractDefinitionsFromFile(sourceFile, lineOffset = 0) {
    const visit = (node) => {
      const typeInfo = this.getTypeInfo(node, sourceFile, lineOffset);
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
    for (const { script, lineOffset } of this.extractVueScriptBlocks(filePath)) {
      const tempSourceFile = ts.createSourceFile(
        filePath,
        script,
        ts.ScriptTarget.Latest,
        true
      );
      this.extractDefinitionsFromFile(tempSourceFile, lineOffset);
    }
  }

  // 提取 .vue 的 <script lang="ts"> 块；lineOffset 为该块在原文件中的起始行号-1，
  // 用于把 script 内的相对行号换算回 .vue 文件的真实行号
  extractVueScriptBlocks(filePath) {
    const blocks = [];
    try {
      const content = readFileSync(filePath, "utf8");
      // 一个 SFC 可能同时有 <script> 与 <script setup> 两个块，全部提取
      const re = /<script[^>]*\slang=["']ts["'][^>]*>([\s\S]*?)<\/script>/gi;
      let match;
      while ((match = re.exec(content)) !== null) {
        const lineOffset = content.slice(0, match.index).split("\n").length - 1;
        blocks.push({ script: match[1], lineOffset });
      }
    } catch (error) {
      this.log(`⚠️ 解析 Vue 文件失败: ${filePath}`);
    }
    return blocks;
  }

  getTypeInfo(node, sourceFile, lineOffset = 0) {
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
      line: this.getLineNumber(sourceFile, node) + lineOffset,
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

  extractUsagesFromFile(sourceFile, lineOffset = 0) {
    // 声明栈：TypeReference 出现在 interface/type/enum 自身声明内部时（如
    // type Tree = { children: Tree[] }）属于自引用，不能算外部使用
    const declStack = [];
    const recordUsage = (name, node) => {
      if (this.isBuiltinType(name)) return;
      if (declStack.includes(name)) return;
      this.addTypeUsage(name, {
        file: resolve(sourceFile.fileName),
        line: this.getLineNumber(sourceFile, node) + lineOffset,
      });
    };
    const visit = (node) => {
      const isDecl =
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node);
      if (isDecl) declStack.push(node.name?.text);

      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        recordUsage(node.typeName.text, node);
      }
      // extends/implements 子句的基类型是 ExpressionWithTypeArguments
      // 而非 TypeReferenceNode，不单独识别会漏记（只被继承的本地类型将误报）
      else if (
        ts.isExpressionWithTypeArguments(node) &&
        ts.isIdentifier(node.expression)
      ) {
        recordUsage(node.expression.text, node);
      }
      // enum 常以值形式使用（LocalMode.On）；限定名字在类型表内，普通对象不受影响
      else if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        this.types.definitions.has(node.expression.text)
      ) {
        recordUsage(node.expression.text, node.expression);
      }

      ts.forEachChild(node, visit);
      if (isDecl) declStack.pop();
    };
    visit(sourceFile);
  }

  extractUsagesFromVue(filePath) {
    for (const { script, lineOffset } of this.extractVueScriptBlocks(filePath)) {
      const tempSourceFile = ts.createSourceFile(
        filePath,
        script,
        ts.ScriptTarget.Latest,
        true
      );
      this.extractUsagesFromFile(tempSourceFile, lineOffset);
    }
  }

  // 收集类型错误
  // 纯 tsc 看不见 .vue 模块的真实类型（import 一律 any），.vue 项目的错误数
  // 会因 any 级联偏高；装了 vue-tsc 时默认改用 vue-tsc 口径
  async collectTypeErrors(program) {
    if (this.skipErrors) {
      this.errorsSkipped = true;
      this.log("⏭️ 跳过类型错误检测（--no-errors）");
      return;
    }

    const wantVueTsc =
      this.errorEngineOption === "vue-tsc" ||
      (this.errorEngineOption === "auto" && this.hasVueTsc());
    if (wantVueTsc && (await this.collectVueTscErrors())) return;

    this.errorEngine = "tsc";
    this.collectTscErrors(program);
  }

  hasVueTsc() {
    return existsSync(join(this.rootDir, "node_modules", "vue-tsc"));
  }

  // 用项目的 vue-tsc 跑错误检测；失败（未装/超时/配置错）返回 false 以便回退
  async collectVueTscErrors() {
    const bin = join(this.rootDir, "node_modules", "vue-tsc", "bin", "vue-tsc.js");
    if (!existsSync(bin)) return false;

    const res = spawnSync(process.execPath, [bin, "--noEmit"], {
      cwd: this.rootDir,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (res.error) {
      this.log(`⚠️ vue-tsc 执行失败（${res.error.message}），回退纯 tsc`);
      return false;
    }

    const parsed = parseCompilerDiagnostics(res.stdout || "");
    // exit 2 = 配置级失败（非诊断），且无可解析输出 → 回退
    if (res.status === 2 && parsed.length === 0) {
      this.log(`⚠️ vue-tsc 配置级失败，回退纯 tsc: ${(res.stderr || "").slice(0, 200)}`);
      return false;
    }

    this.errorEngine = "vue-tsc";
    for (const item of parsed) {
      const abs = resolve(this.rootDir, item.file);
      // 只保留分析范围内文件（src 下的 ts/tsx/vue）
      if (!this.sourceFileSet.has(abs)) continue;
      if (this.shouldIgnoreError(parseInt(item.code.slice(2), 10), item.message)) continue;
      this.types.errors.push({
        file: abs,
        line: item.line,
        column: item.column,
        code: item.code,
        message: item.message.trim(),
        severity: item.severity === "warning" ? "warning" : "error",
      });
    }

    this.log(`🚨 [vue-tsc] 发现 ${this.types.errors.length} 个类型诊断`);
    return true;
  }

  collectTscErrors(program) {
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

    this.log(`🚨 [tsc] 发现 ${this.types.errors.length} 个类型诊断`);
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
      namingExempted: this.namingExempted.length,
      crossValidated: this.crossValidatedOut,
    };

    return {
      timestamp: new Date().toISOString(),
      projectPath: this.rootDir,
      statistics: stats,
      healthScore: this.calculateHealthScore(stats),
      issues: { errors, warnings, duplicates, unused },
      recommendations: this.generateRecommendations(stats),
      namingExemptedNames: [...this.namingExempted],
      // 如实记录本次实际使用的检测引擎；unused 为空不代表没跑专业库
      analysisMethod: this.detectionEngine,
      degraded: this.degraded,
      errorEngine: this.skipErrors ? "skipped" : this.errorEngine,
      errorsSkipped: this.errorsSkipped,
    };
  }

  // 工具方法
  // 同名提示口径：同名且都导出才提示（模块隔离下未导出的局部同名完全合法）；
  // Vue 惯用名（Props/Emits 等）不提示——各组件同名是常态
  findDuplicateTypes() {
    const duplicates = {};
    for (const [typeName, definitions] of this.types.definitions) {
      if (definitions.length < 2) continue;
      if (this.isExemptByName(typeName)) continue;
      const exported = definitions.filter((d) => d.isExported);
      const fileSet = new Set(exported.map((d) => d.file));
      if (exported.length > 1 && fileSet.size > 1) {
        duplicates[typeName] = exported;
      }
    }
    return duplicates;
  }

  calculateHealthScore(stats) {
    if (stats.totalTypes === 0) return 100;

    // 评分口径（README 有完整说明）：
    // - 类型错误：每个 -15，最多 -60（4 个即扣满）
    // - 未使用类型：按占比扣分，最多 -15（同名提示不是错误，不扣分）
    let score = 100;
    score -= Math.min(60, stats.totalErrors * 15);
    score -= Math.min(15, (stats.unusedTypes / stats.totalTypes) * 60);

    return Math.max(0, Math.round(score));
  }

  generateRecommendations(stats) {
    const recommendations = [];

    if (stats.totalErrors > 0) {
      recommendations.push(`🔴 修复 ${stats.totalErrors} 个类型错误`);
    }
    if (stats.duplicateTypes > 0) {
      recommendations.push(`🔵 确认 ${stats.duplicateTypes} 个跨文件同名类型是否应合并（非错误）`);
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

    // 工具不用 vue-tsc，纯 tsc 程序解析不了 .vue 模块——TS2307 含 .vue
    // 属于工具能力边界而非项目错误，豁免
    if (code === 2307 && /\.vue['"]/.test(message)) return true;

    // vite 项目的 import.meta.env/glob 需要 vite/client 类型，纯 tsc 环境常缺
    return message.includes("import.meta");
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

  // 命名豁免：默认仅 Vue SFC 惯用名；用户可通过 ignorePattern 追加（如 Cli,Dto）
  isExemptByName(typeName) {
    const patterns = [...this.defaultNameExemptions, ...this.extraNameExemptions];
    return patterns.some(
      (p) => typeName === p || typeName.endsWith(p)
    );
  }

  trackNamingExemption(typeName) {
    if (!this.namingExempted.includes(typeName)) {
      this.namingExempted.push(typeName);
    }
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
    return this.sourceFileSet.has(resolve(fileName));
  }

  addTypeUsage(typeName, usage) {
    if (!this.types.usages.has(typeName)) {
      this.types.usages.set(typeName, []);
    }
    this.types.usages.get(typeName).push(usage);
  }

  getLineNumber(sourceFile, node) {
    try {
      // 必须显式传入 sourceFile：ts 5.x 的 program 语法树默认未 bind
      // （node.parent 缺失），无参 getStart() 会抛错
      const start = node.getStart ? node.getStart(sourceFile) : node.pos;
      const position = ts.getLineAndCharacterOfPosition(sourceFile, start);
      return position.line + 1;
    } catch (error) {
      // 兜底用 pos（声明前的空白/注释起点，行号可能偏早但不会错到第 1 行）
      try {
        return ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1;
      } catch {
        return 1;
      }
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