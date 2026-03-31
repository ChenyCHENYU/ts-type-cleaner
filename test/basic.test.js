import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TypeAnalyzer } from '../lib/analyzer.js'
import { ReportGenerator } from '../lib/reporter.js'
import { join } from 'path'

const fixtureDir = join(import.meta.dirname, 'fixtures')

describe('TypeAnalyzer', () => {
  it('应正确扫描并收集类型定义', async () => {
    const analyzer = new TypeAnalyzer({ rootDir: fixtureDir, verbose: false })
    const report = await analyzer.analyze()

    assert.ok(report.statistics.totalFiles > 0, '应扫描到源文件')
    assert.ok(report.statistics.totalTypes > 0, '应收集到类型定义')
    assert.ok(typeof report.healthScore === 'number', '应有健康度评分')
    assert.ok(report.healthScore >= 0 && report.healthScore <= 100, '评分范围 0-100')
  })

  it('应正确返回报告结构', async () => {
    const analyzer = new TypeAnalyzer({ rootDir: fixtureDir, verbose: false })
    const report = await analyzer.analyze()

    assert.ok(report.timestamp, '应有时间戳')
    assert.ok(report.statistics, '应有统计信息')
    assert.ok(report.issues, '应有问题列表')
    assert.ok(Array.isArray(report.issues.errors), 'errors 应为数组')
    assert.ok(Array.isArray(report.issues.warnings), 'warnings 应为数组')
    assert.ok(typeof report.issues.duplicates === 'object', 'duplicates 应为对象')
    assert.ok(Array.isArray(report.issues.unused), 'unused 应为数组')
    assert.ok(Array.isArray(report.recommendations), '应有建议')
  })

  it('definitions 应存储为数组以支持重复检测', async () => {
    const analyzer = new TypeAnalyzer({ rootDir: fixtureDir, verbose: false })
    await analyzer.analyze()

    for (const [, defs] of analyzer.types.definitions) {
      assert.ok(Array.isArray(defs), '每个 definition 值应为数组')
      assert.ok(defs.length >= 1, '至少有一个定义')
      assert.ok(defs[0].name, '定义应有 name')
      assert.ok(defs[0].kind, '定义应有 kind')
    }
  })
})

describe('ReportGenerator', () => {
  it('generateConsoleOutput 应无异常执行', async () => {
    const analyzer = new TypeAnalyzer({ rootDir: fixtureDir, verbose: false })
    const report = await analyzer.analyze()
    const reporter = new ReportGenerator(fixtureDir)

    // 不应抛出异常（特别是之前的 [object Object] bug）
    assert.doesNotThrow(() => {
      reporter.generateConsoleOutput(report)
    })
  })

  it('buildMarkdownContent 应返回有效内容', async () => {
    const analyzer = new TypeAnalyzer({ rootDir: fixtureDir, verbose: false })
    const report = await analyzer.analyze()
    const reporter = new ReportGenerator(fixtureDir)

    const content = reporter.buildMarkdownContent(report)
    assert.ok(content.includes('TypeScript 类型分析报告'), '应包含正确标题')
    assert.ok(!content.includes('Vue3 + TypeScript 类型分析报告'), '不应包含旧标题')
    assert.ok(content.includes('ts-type-cleaner'), '应包含正确工具名')
  })
})
