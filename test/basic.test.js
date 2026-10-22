import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { TypeAnalyzer } from '../lib/analyzer.js'
import { ReportGenerator } from '../lib/reporter.js'
import { join } from 'path'

const fixtureDir = join(import.meta.dirname, 'fixtures')

// fixtures 行号契约（types.ts / comp.vue 固定行号，改动文件须同步改断言）：
//   Role       types.ts:12  导出且无人 import → unused
//   UnusedLocal types.ts:8  未导出未使用 → unused（local 检测盲区补齐）
//   SelfRef    types.ts:17  自引用不算使用 → unused
//   UsedInVue  types.ts:19  仅被 comp.vue 使用 → 不得报 unused（交叉否决）
//   VueLocal   comp.vue:5   vue script 内定义，行号须带 <script> 偏移
//   PanelProps types.ts:21  命中默认命名豁免（Props）→ 不报且计数
//   SharedExport dup-a/dup-b 同名导出 → 同名提示；LocalSame 未导出 → 不提示
async function analyzeFixture(extraOptions = {}) {
  const analyzer = new TypeAnalyzer({ rootDir: fixtureDir, verbose: false, ...extraOptions })
  return { analyzer, report: await analyzer.analyze() }
}

describe('TypeAnalyzer 未使用检测（准确性）', () => {
  it('主检测引擎应为 ts-unused-exports（未静默降级）', async () => {
    const { report } = await analyzeFixture()
    assert.equal(report.analysisMethod, 'ts-unused-exports')
    assert.equal(report.degraded, false)
  })

  it('导出且无人引用的类型应报出（Role/SharedExport），行号准确', async () => {
    const { report } = await analyzeFixture()
    const byName = Object.fromEntries(report.issues.unused.map(u => [u.name, u]))

    assert.ok(byName.Role, 'Role（导出未使用）应被报出')
    assert.equal(byName.Role.line, 12, 'Role 定义在 types.ts 第 12 行')
    assert.ok(byName.SharedExport, 'SharedExport（导出未使用）应被报出')
  })

  it('未导出未使用的局部类型应报出（ts-unused-exports 盲区）', async () => {
    const { report } = await analyzeFixture()
    const byName = Object.fromEntries(report.issues.unused.map(u => [u.name, u]))
    assert.ok(byName.UnusedLocal, 'UnusedLocal（未导出未使用）应被报出')
    assert.equal(byName.UnusedLocal.line, 8)
  })

  it('自引用不算使用（SelfRef 应报 unused）', async () => {
    const { report } = await analyzeFixture()
    const names = report.issues.unused.map(u => u.name)
    assert.ok(names.includes('SelfRef'), 'type Tree = { children: Tree[] } 式自引用不应掩盖未使用')
  })

  it('仅被 .vue 使用的类型不得误报（UsedInVue 交叉否决）', async () => {
    const { report } = await analyzeFixture()
    const names = report.issues.unused.map(u => u.name)
    assert.ok(!names.includes('UsedInVue'), 'UsedInVue 被 comp.vue 导入使用，误报会导致删除后编译失败')
    assert.ok(!names.includes('UserInfo') && !names.includes('Status'), '被 TS 文件使用的类型不得误报')
    assert.ok(report.statistics.crossValidated >= 1, '被否决的类型应计入 crossValidated 指标')
  })

  it('.vue 内定义的类型行号应含 <script> 块偏移（VueLocal: line 5）', async () => {
    const { analyzer } = await analyzeFixture()
    const defs = analyzer.types.definitions.get('VueLocal')
    assert.ok(defs, '应收集到 comp.vue 内的 VueLocal')
    assert.equal(defs[0].line, 5, 'script 内容第 4 行 + <script> 标签 1 行偏移 = 文件第 5 行')
  })

  it('命中命名豁免的类型不报 unused 且计入 namingExempted（默认仅 Props/Emits）', async () => {
    const { report } = await analyzeFixture()
    const names = report.issues.unused.map(u => u.name)
    assert.ok(!names.includes('PanelProps'), 'PanelProps 命中默认 Props 豁免')
    assert.ok(report.statistics.namingExempted >= 1)
    assert.ok(report.namingExemptedNames.includes('PanelProps'))
  })

  it('Config/Options/State/Window 后缀不再默认豁免（旧宽匹配漏报回归）', async () => {
    const { report } = await analyzeFixture()
    // fixture 无这类名字，此处锁口径：报告的豁免名单只允许来自 Props/Emits
    for (const name of report.namingExemptedNames) {
      assert.ok(/(Props|Emits)$/.test(name), `豁免名单不应含非默认豁免项: ${name}`)
    }
  })

  it('只被 extends/implements 的本地类型不得误报（BaseShape）', async () => {
    const { report } = await analyzeFixture()
    const names = report.issues.unused.map(u => u.name)
    assert.ok(!names.includes('BaseShape'), 'BaseShape 被 ExtendedShape extends，heritage 子句不是 TypeReference，漏记会误报')
  })

  it('只在值位置使用的本地 enum 不得误报（LocalMode）', async () => {
    const { report } = await analyzeFixture()
    const names = report.issues.unused.map(u => u.name)
    assert.ok(!names.includes('LocalMode'), 'LocalMode 以 LocalMode.On 值形式使用，不得报 unused')
  })

  it('--ignore-pattern 可追加豁免后缀', async () => {
    const { report } = await analyzeFixture({ ignorePattern: ['Role'] })
    const names = report.issues.unused.map(u => u.name)
    assert.ok(!names.includes('Role'), 'Role 被 ignore-pattern 豁免后不应报出')
  })
})

describe('TypeAnalyzer 同名类型口径', () => {
  it('跨文件同名导出报"同名提示"，未导出同名不报', async () => {
    const { report } = await analyzeFixture()
    assert.ok(report.issues.duplicates.SharedExport, '同名导出 SharedExport 应提示')
    assert.ok(!report.issues.duplicates.LocalSame, '未导出同名 LocalSame 模块隔离下合法，不应提示')
  })

  it('同名提示不计入健康度扣分（非错误）', async () => {
    const { report } = await analyzeFixture()
    // fixture 无类型错误；若 duplicates 扣分，分数会低于 100 - unused 扣分
    const expected = 100 - Math.min(15, (report.statistics.unusedTypes / report.statistics.totalTypes) * 60)
    assert.equal(report.healthScore, Math.max(0, Math.round(expected)))
  })
})

describe('TypeAnalyzer 路径与结构', () => {
  it('相对路径 rootDir 不应导致引擎降级（临时配置 files 绝对化）', async () => {
    const analyzer = new TypeAnalyzer({ rootDir: 'test/fixtures', verbose: false })
    const report = await analyzer.analyze()
    assert.equal(report.analysisMethod, 'ts-unused-exports', '相对路径下主引擎应正常工作')
    assert.ok(report.statistics.totalTypes > 0)
  })

  it('TS2307 引用 .vue 模块不算项目错误（工具无 vue-tsc 的能力边界）', async () => {
    const { report } = await analyzeFixture()
    // imports-vue.ts 导入 ./comp.vue，纯 tsc 报 TS2307——应被豁免而非计入错误
    const vue2307 = report.issues.errors.filter(
      e => e.code === 'TS2307' && /\.vue/.test(e.message)
    )
    assert.equal(vue2307.length, 0, '.vue 模块解析失败是工具能力边界，不应计入类型错误')
  })

  it('应正确返回报告结构', async () => {
    const { report } = await analyzeFixture()
    assert.ok(report.timestamp)
    assert.ok(report.statistics)
    assert.ok(report.issues)
    assert.ok(Array.isArray(report.issues.errors))
    assert.ok(Array.isArray(report.issues.warnings))
    assert.ok(typeof report.issues.duplicates === 'object')
    assert.ok(Array.isArray(report.issues.unused))
    assert.ok(Array.isArray(report.recommendations))
    assert.ok(report.healthScore >= 0 && report.healthScore <= 100)
  })

  it('definitions 应存储为数组以支持同名检测', async () => {
    const { analyzer } = await analyzeFixture()
    for (const [, defs] of analyzer.types.definitions) {
      assert.ok(Array.isArray(defs))
      assert.ok(defs.length >= 1)
      assert.ok(defs[0].name)
      assert.ok(defs[0].kind)
    }
  })
})

describe('ReportGenerator', () => {
  it('generateConsoleOutput 应无异常执行', async () => {
    const { report } = await analyzeFixture()
    const reporter = new ReportGenerator(fixtureDir)
    assert.doesNotThrow(() => reporter.generateConsoleOutput(report))
  })

  it('buildMarkdownContent 应返回有效内容并说明豁免/交叉排除', async () => {
    const { report } = await analyzeFixture()
    const reporter = new ReportGenerator(fixtureDir)
    const content = reporter.buildMarkdownContent(report)

    assert.ok(content.includes('TypeScript 类型分析报告'))
    assert.ok(content.includes('ts-type-cleaner'))
    assert.ok(content.includes('命名豁免'), '应说明命名豁免口径')
    assert.ok(content.includes('交叉排除') || content.includes('交叉验证'), '应说明交叉验证口径')
  })
})

describe('CLI check --max-unused', () => {
  it('未使用类型超上限时应以非零码退出', () => {
    const bin = join(import.meta.dirname, '..', 'bin', 'cli.js')
    let status = 0
    let stdout = ''
    try {
      stdout = execFileSync('node', [bin, 'check', '-r', fixtureDir, '--max-unused', '0', '--json'], { encoding: 'utf8' })
    } catch (err) {
      status = err.status
      stdout = err.stdout
    }
    const parsed = JSON.parse(stdout)
    assert.equal(parsed.passed, false)
    assert.ok(status !== 0, '超上限应非零退出')
  })
})
