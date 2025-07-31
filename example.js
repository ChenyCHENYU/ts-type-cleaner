/*
 * @Author: ChenYu ycyplus@gmail.com
 * @Date: 2025-07-31 17:39:16
 * @LastEditors: ChenYu ycyplus@gmail.com
 * @LastEditTime: 2025-07-31 17:39:23
 * @FilePath: \ts-type-cleaner\example.js
 * @Description:
 * Copyright (c) 2025 by CHENY, All Rights Reserved 😎.
 */
import { TypeAnalyzer } from "./lib/index.js";
import chalk from "chalk";

async function example() {
  console.log(chalk.cyan("🛠️ TypeScript Type Cleaner 使用示例\n"));

  try {
    // 创建分析器实例
    const analyzer = new TypeAnalyzer({
      rootDir: process.cwd(),
      verbose: true,
      include: ["src/**/*.{ts,tsx,vue}"],
      exclude: ["node_modules", "dist", ".git", "**/*.d.ts"],
    });

    console.log(chalk.blue("🔍 开始分析..."));
    const result = await analyzer.analyze();

    // 显示分析结果
    console.log("\n" + chalk.green("📊 分析结果:"));
    console.log(`├─ 源文件: ${result.statistics.sourceFiles} 个`);
    console.log(`├─ 类型定义: ${result.statistics.typeDefinitions} 个`);
    console.log(`├─ 使用引用: ${result.statistics.usageReferences} 个`);
    console.log(
      `├─ 未使用类型: ${chalk.yellow(result.statistics.unusedTypes)} 个`
    );
    console.log(
      `├─ 重复定义: ${chalk.red(result.statistics.duplicateDefinitions)} 个`
    );
    console.log(`├─ 类型错误: ${chalk.red(result.statistics.totalErrors)} 个`);
    console.log(
      `└─ 健康评分: ${getScoreColor(result.scores.overallScore)}${
        result.scores.overallScore
      }/100${chalk.reset()}`
    );

    // 显示改进建议
    if (result.suggestions.length > 0) {
      console.log("\n" + chalk.green("💡 改进建议:"));
      result.suggestions.forEach((suggestion, index) => {
        console.log(`${index + 1}. ${suggestion}`);
      });
    }

    // 生成简单的Markdown报告
    await generateSimpleReport(result);
  } catch (error) {
    console.error(chalk.red("❌ 分析失败:"), error.message);
  }
}

function getScoreColor(score) {
  if (score >= 80) return chalk.green("");
  if (score >= 60) return chalk.yellow("");
  return chalk.red("");
}

async function generateSimpleReport(result) {
  const { writeFileSync } = await import("fs");

  const content = [
    "# TypeScript 类型分析报告",
    "",
    `**生成时间**: ${new Date().toLocaleString("zh-CN")}`,
    `**综合评分**: ${result.scores.overallScore}/100`,
    "",
    "## 统计数据",
    "",
    `- 源文件: ${result.statistics.sourceFiles} 个`,
    `- 类型定义: ${result.statistics.typeDefinitions} 个`,
    `- 未使用类型: ${result.statistics.unusedTypes} 个`,
    `- 类型错误: ${result.statistics.totalErrors} 个`,
    "",
    "## 改进建议",
    "",
    ...result.suggestions.map((s) => `- ${s}`),
    "",
  ].join("\n");

  const fileName = `type-report-${new Date().toISOString().slice(0, 10)}.md`;
  writeFileSync(fileName, content);
  console.log(chalk.cyan(`\n📋 报告已生成: ${fileName}`));
}

// 运行示例
example().catch(console.error);
