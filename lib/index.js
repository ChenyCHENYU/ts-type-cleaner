export { TypeAnalyzer } from './analyzer.js'
export { ReportGenerator } from './reporter.js'

// 便捷函数
export async function analyzeProject(options = {}) {
  const { TypeAnalyzer } = await import('./analyzer.js')
  const { ReportGenerator } = await import('./reporter.js')
  
  const analyzer = new TypeAnalyzer(options)
  const report = await analyzer.analyze()
  
  // 如果需要控制台输出
  if (options.console !== false) {
    const reporter = new ReportGenerator(options.rootDir || process.cwd())
    reporter.generateConsoleOutput(report)
  }
  
  // 如果需要 Markdown 报告
  if (options.markdown !== false) {
    const reporter = new ReportGenerator(options.rootDir || process.cwd())
    await reporter.generateMarkdownReport(report)
  }
  
  return report
}

// 快速检查函数
export async function quickCheck(options = {}) {
  const { TypeAnalyzer } = await import('./analyzer.js')
  
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
  const { TypeAnalyzer } = await import('./analyzer.js')
  
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