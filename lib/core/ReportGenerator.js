import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, relative } from 'path'

export class ReportGenerator {
  constructor(options = {}) {
    this.options = {
      outputDir: options.outputDir || "./type-reports",
      format: options.format || "markdown",
      ...options,
    };
  }

  async generateDetailedGuide(result) {
    if (!existsSync(this.options.outputDir)) {
      mkdirSync(this.options.outputDir, { recursive: true });
    }

    switch (this.options.format) {
      case "html":
        return this.generateHtmlReport(result);
      case "json":
        return this.generateJsonReport(result);
      default:
        return this.generateMarkdownReport(result);
    }
  }

  // 在 ReportGenerator.js 中替换 generateMarkdownReport 方法

  generateMarkdownReport(result) {
    const content = [];
    const stats = result.statistics;

    // 标题和元信息
    content.push("# 🛠️ TypeScript 类型分析报告");
    content.push("");
    content.push(`> 📅 **生成时间**: ${new Date().toLocaleString("zh-CN")}`);
    content.push(`> 📁 **项目路径**: \`${process.cwd()}\``);
    content.push("");

    // 执行摘要
    content.push("## 📋 执行摘要");
    content.push("");
    const scoreEmoji =
      result.scores.overallScore >= 80
        ? "🟢"
        : result.scores.overallScore >= 60
        ? "🟡"
        : "🔴";
    content.push(
      `### ${scoreEmoji} 综合评分: ${result.scores.overallScore}/100`
    );
    content.push("");

    if (result.scores.overallScore >= 90) {
      content.push("🎉 **优秀**: 代码类型系统非常健康，继续保持！");
    } else if (result.scores.overallScore >= 75) {
      content.push("✅ **良好**: 类型系统基本健康，有小幅改进空间。");
    } else if (result.scores.overallScore >= 60) {
      content.push("⚠️ **一般**: 发现一些问题，建议进行优化。");
    } else {
      content.push("🚨 **需要改进**: 类型系统存在较多问题，需要重点关注。");
    }
    content.push("");

    // 核心指标
    content.push("## 📊 核心指标");
    content.push("");
    content.push("| 指标 | 数值 | 状态 | 描述 |");
    content.push("|------|------|------|------|");

    const metrics = [
      ["📁 源文件", stats.sourceFiles, "ℹ️ 信息", "项目中扫描到的源文件数量"],
      [
        "🎯 类型定义",
        stats.typeDefinitions,
        stats.typeDefinitions > 0 ? "✅ 正常" : "⚠️ 无定义",
        "interface、type、enum、class 的总数",
      ],
      [
        "🔗 类型引用",
        stats.usageReferences,
        stats.usageReferences > 0 ? "✅ 正常" : "⚠️ 无引用",
        "类型被使用的总次数",
      ],
      [
        "🗑️ 未使用类型",
        stats.unusedTypes,
        stats.unusedTypes === 0
          ? "🟢 优秀"
          : stats.unusedTypes <= 5
          ? "🟡 注意"
          : "🔴 需清理",
        "定义但未被使用的类型",
      ],
      [
        "⚠️ 重复定义",
        stats.duplicateDefinitions,
        stats.duplicateDefinitions === 0 ? "🟢 优秀" : "🔴 需修复",
        "存在重复命名的类型",
      ],
      [
        "🚨 类型错误",
        stats.totalErrors,
        stats.totalErrors === 0 ? "🟢 优秀" : "🔴 需修复",
        "TypeScript 编译错误",
      ],
      [
        "💛 类型警告",
        stats.totalWarnings,
        stats.totalWarnings === 0
          ? "🟢 优秀"
          : stats.totalWarnings <= 10
          ? "🟡 注意"
          : "🔴 较多",
        "TypeScript 编译警告",
      ],
    ];

    metrics.forEach(([metric, value, status, desc]) => {
      content.push(`| ${metric} | **${value}** | ${status} | ${desc} |`);
    });
    content.push("");

    // 分数详情
    content.push("## 📈 评分详情");
    content.push("");
    content.push("```");
    content.push(
      `类型健康度: ${result.scores.healthScore}/100  ${"█".repeat(
        Math.round(result.scores.healthScore / 5)
      )}${"░".repeat(20 - Math.round(result.scores.healthScore / 5))}`
    );
    content.push(
      `验证准确性: ${result.scores.validationScore}/100  ${"█".repeat(
        Math.round(result.scores.validationScore / 5)
      )}${"░".repeat(20 - Math.round(result.scores.validationScore / 5))}`
    );
    content.push(
      `综合评分:   ${result.scores.overallScore}/100  ${"█".repeat(
        Math.round(result.scores.overallScore / 5)
      )}${"░".repeat(20 - Math.round(result.scores.overallScore / 5))}`
    );
    content.push("```");
    content.push("");

    // 问题详情
    if (result.details.errors.length > 0) {
      content.push("## 🚨 类型错误详情");
      content.push("");
      content.push(
        `> 发现 **${result.details.errors.length}** 个类型错误，建议优先修复。`
      );
      content.push("");

      const errorsToShow = Math.min(10, result.details.errors.length);
      for (let i = 0; i < errorsToShow; i++) {
        const error = result.details.errors[i];
        content.push(`### ${i + 1}. ${error.code || "TypeScript Error"}`);
        content.push("");
        content.push(
          `**文件**: \`${relative(process.cwd(), error.file)}:${error.line}\``
        );
        content.push("");
        content.push(`**错误信息**: ${error.message}`);
        content.push("");
        content.push("---");
        content.push("");
      }

      if (result.details.errors.length > errorsToShow) {
        content.push(
          `> 还有 ${
            result.details.errors.length - errorsToShow
          } 个错误未显示，请查看完整日志。`
        );
        content.push("");
      }
    }

    // 未使用类型
    if (result.details.unusedTypes.length > 0) {
      content.push("## 🗑️ 未使用类型");
      content.push("");
      content.push(
        `> 发现 **${result.details.unusedTypes.length}** 个未使用的类型定义，建议清理以优化代码。`
      );
      content.push("");

      const typesToShow = Math.min(20, result.details.unusedTypes.length);
      result.details.unusedTypes
        .slice(0, typesToShow)
        .forEach((typeName, index) => {
          const typeInfo = result.details.typeDefinitions[typeName];
          if (typeInfo) {
            content.push(
              `${index + 1}. \`${typeName}\` (${typeInfo.type}) - \`${relative(
                process.cwd(),
                typeInfo.file
              )}:${typeInfo.line}\``
            );
          }
        });

      if (result.details.unusedTypes.length > typesToShow) {
        content.push("");
        content.push(
          `> 还有 ${
            result.details.unusedTypes.length - typesToShow
          } 个未使用类型未显示。`
        );
      }
      content.push("");
    }

    // 改进建议
    if (result.suggestions.length > 0) {
      content.push("## 💡 改进建议");
      content.push("");
      result.suggestions.forEach((suggestion, index) => {
        content.push(`${index + 1}. ${suggestion}`);
      });
      content.push("");
    }

    // 使用指南
    content.push("## 📖 使用指南");
    content.push("");
    content.push("### 如何修复类型错误");
    content.push("1. 优先修复标记为 🔴 的关键错误");
    content.push("2. 检查类型定义是否正确导入");
    content.push("3. 确保接口和类型别名的属性完整");
    content.push("");
    content.push("### 如何清理未使用类型");
    content.push("```bash");
    content.push("# 使用工具清理未使用类型");
    content.push("ts-type-cleaner clean --dry-run  # 预览清理结果");
    content.push("ts-type-cleaner clean --apply    # 应用清理");
    content.push("```");
    content.push("");

    // 生成报告文件
    const fileName = `type-analysis-${this.getDateString()}.md`;
    const outputPath = join(this.options.outputDir, fileName);
    writeFileSync(outputPath, content.join("\n"));
    return outputPath;
  }

  generateHtmlReport(result) {
    const stats = result.statistics;
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TypeScript 类型分析报告</title>
    <style>${this.getCSS()}</style>
</head>
<body>
    <div class="container">
        <h1>🛠️ TypeScript 类型分析报告</h1>
        <div class="meta">生成时间: ${new Date().toLocaleString("zh-CN")}</div>
        
        <div class="stats">
            <div class="stat-card ${this.getScoreClass(
              result.scores.healthScore
            )}">
                <div class="stat-number">${result.scores.healthScore}</div>
                <div class="stat-label">健康评分</div>
            </div>
            <div class="stat-card ${
              stats.unusedTypes === 0 ? "good" : "warning"
            }">
                <div class="stat-number">${stats.unusedTypes}</div>
                <div class="stat-label">未使用类型</div>
            </div>
            <div class="stat-card ${
              stats.totalErrors === 0 ? "good" : "error"
            }">
                <div class="stat-number">${stats.totalErrors}</div>
                <div class="stat-label">类型错误</div>
            </div>
        </div>

        ${this.buildHtmlSections(result)}
    </div>
</body>
</html>`;

    const fileName = `type-report-${this.getDateString()}.html`;
    const outputPath = join(this.options.outputDir, fileName);
    writeFileSync(outputPath, html);
    return outputPath;
  }

  generateJsonReport(result) {
    const fileName = `type-report-${this.getDateString()}.json`;
    const outputPath = join(this.options.outputDir, fileName);
    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    return outputPath;
  }

  buildHtmlSections(result) {
    let sections = "";

    if (result.details.unusedTypes.length > 0) {
      sections += `<section>
        <h2>🗑️ 未使用类型 (${result.details.unusedTypes.length})</h2>
        <ul>`;
      result.details.unusedTypes.slice(0, 20).forEach((typeName) => {
        const typeInfo = result.details.typeDefinitions[typeName];
        if (typeInfo) {
          sections += `<li><code>${typeName}</code> - ${relative(
            process.cwd(),
            typeInfo.file
          )}:${typeInfo.line}</li>`;
        }
      });
      sections += "</ul></section>";
    }

    if (result.details.errors.length > 0) {
      sections += `<section>
        <h2>🚨 类型错误 (${result.details.errors.length})</h2>
        <div class="error-list">`;
      result.details.errors.slice(0, 10).forEach((error) => {
        sections += `<div class="error-item">
          <strong>${error.message}</strong><br>
          <small>${relative(process.cwd(), error.file)}:${error.line}</small>
        </div>`;
      });
      sections += "</div></section>";
    }

    return sections;
  }

  getCSS() {
    return `
      body { font-family: -apple-system, sans-serif; margin: 0; background: #f5f5f5; }
      .container { max-width: 1000px; margin: 0 auto; padding: 20px; }
      h1 { color: #333; text-align: center; }
      .meta { text-align: center; color: #666; margin-bottom: 30px; }
      
      .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin: 30px 0; }
      .stat-card { background: white; padding: 20px; border-radius: 8px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
      .stat-card.good { border-left: 4px solid #4caf50; }
      .stat-card.warning { border-left: 4px solid #ff9800; }
      .stat-card.error { border-left: 4px solid #f44336; }
      .stat-number { font-size: 2rem; font-weight: bold; margin-bottom: 5px; }
      .stat-label { font-size: 0.9rem; color: #666; }
      
      section { background: white; margin: 20px 0; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
      h2 { color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px; }
      
      .error-list { display: grid; gap: 10px; }
      .error-item { padding: 10px; background: #fff5f5; border-left: 4px solid #f44336; border-radius: 4px; }
      
      ul { list-style: none; padding: 0; }
      li { padding: 8px 0; border-bottom: 1px solid #eee; }
      code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
    `;
  }

  getScoreStatus(score) {
    if (score >= 80) return "✅ 优秀";
    if (score >= 60) return "⚠️ 良好";
    return "❌ 需改进";
  }

  getScoreClass(score) {
    if (score >= 80) return "good";
    if (score >= 60) return "warning";
    return "error";
  }

  getDateString() {
    return new Date().toISOString().slice(0, 10);
  }
}