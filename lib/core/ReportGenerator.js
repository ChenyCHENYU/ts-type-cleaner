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

  generateMarkdownReport(result) {
    const content = [];
    const stats = result.statistics;

    content.push("# 🛠️ TypeScript 类型分析报告");
    content.push("");
    content.push(`> 生成时间: ${new Date().toLocaleString("zh-CN")}`);
    content.push("");

    // 概览
    content.push("## 📊 概览");
    content.push("");
    content.push("| 指标 | 数值 | 状态 |");
    content.push("|------|------|------|");
    content.push(
      `| 健康评分 | ${result.scores.healthScore}/100 | ${this.getScoreStatus(
        result.scores.healthScore
      )} |`
    );
    content.push(
      `| 验证评分 | ${
        result.scores.validationScore
      }/100 | ${this.getScoreStatus(result.scores.validationScore)} |`
    );
    content.push(
      `| 未使用类型 | ${stats.unusedTypes} | ${
        stats.unusedTypes > 0 ? "⚠️ 需清理" : "✅ 良好"
      } |`
    );
    content.push(
      `| 类型错误 | ${stats.totalErrors} | ${
        stats.totalErrors > 0 ? "❌ 需修复" : "✅ 良好"
      } |`
    );
    content.push("");

    // 问题列表
    if (result.details.unusedTypes.length > 0) {
      content.push("## 🗑️ 未使用类型");
      content.push("");
      result.details.unusedTypes.slice(0, 20).forEach((typeName, index) => {
        const typeInfo = result.details.typeDefinitions[typeName];
        if (typeInfo) {
          content.push(
            `${index + 1}. \`${typeName}\` - ${relative(
              process.cwd(),
              typeInfo.file
            )}:${typeInfo.line}`
          );
        }
      });
      content.push("");
    }

    if (result.details.errors.length > 0) {
      content.push("## 🚨 类型错误");
      content.push("");
      result.details.errors.slice(0, 10).forEach((error, index) => {
        content.push(`${index + 1}. **${error.message}**`);
        content.push(
          `   - 文件: ${relative(process.cwd(), error.file)}:${error.line}`
        );
        content.push("");
      });
    }

    // 建议
    if (result.suggestions.length > 0) {
      content.push("## 💡 建议");
      content.push("");
      result.suggestions.forEach((suggestion, index) => {
        content.push(`${index + 1}. ${suggestion}`);
      });
      content.push("");
    }

    const fileName = `type-report-${this.getDateString()}.md`;
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