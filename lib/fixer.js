import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import ts from "typescript";

// 未使用类型删除器。
// 安全约定：
// - 只删整块声明（interface/type/enum，含 export 修饰）；
//   .vue 内的声明只在项目装有 vue-tsc（可做删除后验证）时才删
// - 默认 dry-run：planFixes 只生成计划，apply 才写盘
// - 写盘后必须通过错误验证（不新增任何类型诊断，引擎与本次分析口径一致），
//   否则整体回滚
export class TypeFixer {
  constructor(rootDir, options = {}) {
    this.rootDir = rootDir;
    this.canVerifyVue = options.canVerifyVue || false;
  }

  // 生成删除计划（不写盘）
  planFixes(unused) {
    const byFile = new Map();
    const skipped = [];

    for (const item of unused) {
      const abs = resolve(this.rootDir, item.file);
      if (!/\.(ts|tsx|vue)$/.test(abs)) {
        skipped.push({ ...item, reason: "不支持的文件类型，仅报告" });
        continue;
      }
      if (abs.endsWith(".vue") && !this.canVerifyVue) {
        skipped.push({ ...item, reason: "项目未装 vue-tsc，.vue 删除无验证覆盖，仅报告" });
        continue;
      }
      if (!byFile.has(abs)) byFile.set(abs, []);
      byFile.get(abs).push(item);
    }

    const plans = [];
    for (const [abs, items] of byFile) {
      const content = readFileSync(abs, "utf8");
      const lines = content.split("\n");

      // 行号倒序删除，避免前面的删除使后面的行号失效
      const sorted = [...items].sort((a, b) => b.line - a.line);
      const removals = [];
      let cursor = lines.length;

      for (const item of sorted) {
        const extent = this.findDeclExtent(content, abs, item.name, item.line);
        if (!extent) {
          skipped.push({ ...item, reason: "声明边界定位失败，已跳过" });
          continue;
        }
        const [startLine, endLine] = extent; // 1-based 闭区间
        if (startLine > cursor) {
          skipped.push({ ...item, reason: "声明区间重叠，已跳过" });
          continue;
        }
        removals.push({ name: item.name, startLine, endLine });
        // 删除声明行；若删除区间两侧都是空行，额外吃掉一个避免连续空行
        const beforeBlank = lines[startLine - 2]?.trim() === "";
        const afterBlank = lines[endLine]?.trim() === "";
        lines.splice(startLine - 1, endLine - startLine + 1 + (beforeBlank && afterBlank ? 1 : 0));
        cursor = startLine - 1;
      }

      if (removals.length > 0) {
        plans.push({
          file: abs,
          original: content,
          modified: lines.join("\n"),
          removals: removals.reverse(), // 汇报按源码顺序
        });
      }
    }

    return { plans, skipped };
  }

  // 在 content 中定位 name@line 声明的起止行（1-based 闭区间，相对传入内容）。
  // 重新解析而不是信报告行号，确保与文件当前内容一致。
  findDeclExtent(content, fileName, name, expectedLine) {
    if (fileName.endsWith(".vue")) {
      return this.findVueDeclExtent(content, fileName, name, expectedLine);
    }
    const sf = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
    return this.findDeclInSource(sf, name, expectedLine);
  }

  // .vue：逐个 <script lang="ts"> 块内查找，行号换算回文件全局行号
  findVueDeclExtent(content, fileName, name, expectedLine) {
    const re = /<script[^>]*\slang=["']ts["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = re.exec(content)) !== null) {
      const offset = content.slice(0, match.index).split("\n").length - 1;
      const sf = ts.createSourceFile(fileName, match[1], ts.ScriptTarget.Latest, true);
      const extent = this.findDeclInSource(sf, name, expectedLine - offset);
      if (extent) return [extent[0] + offset, extent[1] + offset];
    }
    return null;
  }

  findDeclInSource(sf, name, expectedLine) {
    let extent = null;

    const visit = (node) => {
      if (extent) return;
      const isTarget =
        (ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node)) &&
        node.name?.text === name;
      if (isTarget) {
        const start = node.getStart(sf); // 含 export 修饰符
        const startLine = ts.getLineAndCharacterOfPosition(sf, start).line + 1;
        if (startLine === expectedLine) {
          const endLine = ts.getLineAndCharacterOfPosition(sf, node.getEnd()).line + 1;
          extent = [startLine, endLine];
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return extent;
  }

  apply(plans) {
    for (const plan of plans) {
      writeFileSync(plan.file, plan.modified, "utf8");
    }
  }

  revert(plans) {
    for (const plan of plans) {
      writeFileSync(plan.file, plan.original, "utf8");
    }
  }

  // 写盘后的安全验证：按本次分析的口径重建诊断，返回相对 beforeErrors 新增的错误。
  // 匹配键不含行号——删除声明会使同文件后续诊断行号平移，带行号会把旧错误误判为新增。
  // 删了 .vue 时必须用 vue-tsc 口径验证（.ts-only 删除也跟随原口径保持一致）
  async verify(analyzer, beforeErrors) {
    const key = (e) => `${e.file}:${e.code}:${e.message}`;
    const before = new Set(beforeErrors.map(key));

    analyzer.types.errors = [];
    if (analyzer.errorEngine === "vue-tsc") {
      const ok = await analyzer.collectVueTscErrors();
      if (!ok) analyzer.collectTscErrors(analyzer.createTSProgram());
    } else {
      analyzer.collectTscErrors(analyzer.createTSProgram());
    }
    const after = analyzer.types.errors.filter((e) => e.severity === "error");

    const newErrors = after.filter((e) => !before.has(key(e)));
    return { afterCount: after.length, newErrors };
  }
}
