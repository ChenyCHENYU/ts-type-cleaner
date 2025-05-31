import { TypeManager, TypeValidator, ReportGenerator } from '../lib/index.js'

async function example() {
  console.log('TypeScript Type Cleaner 使用示例\n')

  try {
    // 1. 分析类型使用情况
    console.log('1. 分析类型使用情况...')
    const manager = new TypeManager({
      rootDir: process.cwd(),
      verbose: true,
    })
    const analysisResult = await manager.analyze()

    console.log(`\n找到 ${analysisResult.typeDefinitions} 个类型定义`)
    console.log(`未使用的类型: ${analysisResult.unusedTypes} 个`)
    console.log(`重复的类型: ${analysisResult.duplicateDefinitions} 个`)
    console.log(`健康评分: ${analysisResult.healthScore}/100\n`)

    // 2. 验证类型正确性
    console.log('2. 验证类型正确性...')
    const validator = new TypeValidator({
      rootDir: process.cwd(),
      strict: false,
    })
    const validationResult = await validator.validate()

    console.log(`\n类型错误: ${validationResult.errors.length} 个`)
    console.log(`警告: ${validationResult.warnings.length} 个`)
    console.log(`验证评分: ${validationResult.validationScore}/100\n`)

    // 3. 生成详细报告
    console.log('3. 生成详细报告...')
    const reporter = new ReportGenerator({
      outputDir: './type-reports',
    })
    const reportPath = await reporter.generateDetailedGuide(
      analysisResult,
      validationResult
    )

    console.log(`\n报告已生成: ${reportPath}`)
  } catch (error) {
    console.error('错误:', error.message)
  }
}

example()
