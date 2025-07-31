import { TypeAnalyzer } from './core/TypeAnalyzer.js'
import { ReportGenerator } from './core/ReportGenerator.js'
import { Formatter } from './utils/formatter.js'

export { TypeAnalyzer, ReportGenerator, Formatter }

// 主要分析函数
export async function analyzeProject(options = {}) {
  const analyzer = new TypeAnalyzer(options)
  return await analyzer.analyze()
}

// 快速检查 (CI/CD 用)
export async function quickCheck(options = {}) {
  const result = await analyzeProject({
    ...options,
    verbose: false,
  })

  const hasErrors = result.details.errors.length > 0
  const score = result.scores.validationScore
  const threshold = options.threshold || 70

  return {
    passed: !hasErrors && score >= threshold,
    score,
    errors: result.details.errors.length,
    warnings: result.details.warnings.length,
    summary: hasErrors 
      ? `❌ 发现 ${result.details.errors.length} 个类型错误`
      : `✅ 类型检查通过 (评分: ${score}/100)`,
  }
}

// 格式化输出
export function formatOutput(result, options = {}) {
  const formatter = new Formatter(options)
  return formatter.formatAnalysisResult(result)
}

// 配置相关
export { mergeConfig, validateConfig, createConfig } from './utils/cli.js'

export const defaultConfig = {
  rootDir: process.cwd(),
  outputDir: './type-reports',
  verbose: false,
  strict: false,
  include: ['src/**/*.{ts,tsx,vue}'],
  exclude: ['node_modules', 'dist', '.git', '**/*.d.ts'],
  threshold: 70,
}