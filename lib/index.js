export { TypeAnalyzer } from './analyzer.js'
export { ReportGenerator } from './reporter.js'

// 便捷函数
export async function analyzeProject(options = {}) {
  const analyzer = new TypeAnalyzer(options)
  const report = await analyzer.analyze()
  const rootDir = options.rootDir || process.cwd()

  if (options.console !== false || options.markdown !== false) {
    const reporter = new ReportGenerator(rootDir)
    if (options.console !== false) {
      reporter.generateConsoleOutput(report)
    }
    if (options.markdown !== false) {
      await reporter.generateMarkdownReport(report)
    }
  }

  return report
}

// 快速检查函数
export async function quickCheck(options = {}) {
  const analyzer = new TypeAnalyzer({
    ...options,
    verbose: false
  })

  const report = await analyzer.analyze()
  const threshold = options.threshold || 70

  return {
    passed: report.issues.errors.length === 0 && report.healthScore >= threshold,
    score: report.healthScore,
    errors: report.issues.errors.length,
    duplicates: Object.keys(report.issues.duplicates).length,
    unused: report.issues.unused.length,
    summary: report.issues.errors.length === 0 
      ? `✅ 类型检查通过 (评分: ${report.healthScore}/100)`
      : `❌ 发现 ${report.issues.errors.length} 个类型错误`
  }
}

// 获取项目统计
export async function getProjectStats(options = {}) {
  const analyzer = new TypeAnalyzer({
    ...options,
    verbose: false
  })

  const report = await analyzer.analyze()

  return {
    files: report.statistics.totalFiles,
    types: report.statistics.totalTypes,
    usages: report.statistics.totalUsages,
    errors: report.statistics.totalErrors,
    duplicates: report.statistics.duplicateTypes,
    unused: report.statistics.unusedTypes,
    healthScore: report.healthScore
  }
}