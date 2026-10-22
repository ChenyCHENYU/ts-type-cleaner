export { TypeAnalyzer } from './analyzer.js'
export { ReportGenerator } from './reporter.js'
export { TypeFixer } from './fixer.js'
export { parseCompilerDiagnostics } from './analyzer.js'

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
  const maxUnused = options.maxUnused ?? null

  const hasErrors = report.issues.errors.length > 0
  const lowScore = report.healthScore < threshold
  const tooManyUnused = maxUnused !== null && report.issues.unused.length > maxUnused

  return {
    passed: !hasErrors && !lowScore && !tooManyUnused,
    score: report.healthScore,
    threshold,
    maxUnused,
    errors: report.issues.errors.length,
    duplicates: Object.keys(report.issues.duplicates).length,
    unused: report.issues.unused.length,
    summary: passedText(hasErrors, tooManyUnused, report, maxUnused)
  }
}

function passedText(hasErrors, tooManyUnused, report, maxUnused) {
  if (hasErrors) return `❌ 发现 ${report.issues.errors.length} 个类型错误`
  if (tooManyUnused) return `❌ 未使用类型 ${report.issues.unused.length} 个，超过上限 ${maxUnused}`
  return `✅ 类型检查通过 (评分: ${report.healthScore}/100)`
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
    warnings: report.statistics.totalWarnings,
    duplicates: report.statistics.duplicateTypes,
    unused: report.statistics.unusedTypes,
    namingExempted: report.statistics.namingExempted,
    crossValidated: report.statistics.crossValidated,
    healthScore: report.healthScore,
    analysisMethod: report.analysisMethod,
    degraded: report.degraded
  }
}