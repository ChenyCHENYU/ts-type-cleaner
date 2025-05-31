import chalk from 'chalk'
import ora from 'ora'
import { TypeManager } from './core/TypeManager.js'
import { TypeValidator } from './core/TypeValidator.js'
import { ReportGenerator } from './core/ReportGenerator.js'
import { Logger } from './utils/logger.js'

/**
 * 运行 analyze 命令
 */
export async function runAnalyze(options) {
  const logger = new Logger(options.verbose)
  const spinner = ora('正在分析类型使用情况...').start()

  try {
    const manager = new TypeManager({
      rootDir: options.root,
      outputDir: options.output,
      include: parsePatterns(options.include),
      exclude: parsePatterns(options.exclude),
      verbose: options.verbose,
    })

    const result = await manager.analyze()
    spinner.succeed('类型分析完成')

    // 显示结果
    displayAnalysisResult(result, options.threshold)

    // 检查健康分数阈值
    if (result.healthScore < parseInt(options.threshold)) {
      logger.warn(
        `健康分数 ${result.healthScore} 低于阈值 ${options.threshold}`
      )
      process.exit(1)
    }
  } catch (error) {
    spinner.fail('分析失败')
    logger.error(error.message)
    process.exit(1)
  }
}

/**
 * 运行 validate 命令
 */
export async function runValidate(options) {
  const logger = new Logger(options.verbose)
  const spinner = ora('正在验证类型正确性...').start()

  try {
    const validator = new TypeValidator({
      rootDir: options.root,
      autoFix: options.autoFix,
      strict: options.strict,
      verbose: options.verbose,
    })

    const result = await validator.validate()
    spinner.succeed('类型验证完成')

    // 显示结果
    displayValidationResult(result)

    // 如果有错误，退出码为 1
    if (result.errors.length > 0) {
      process.exit(1)
    }
  } catch (error) {
    spinner.fail('验证失败')
    logger.error(error.message)
    process.exit(1)
  }
}

/**
 * 运行 check 命令
 */
export async function runCheck(options) {
  const logger = new Logger(options.verbose)

  try {
    // 先运行分析
    logger.info('🔍 第一阶段：分析类型使用情况')
    await runAnalyze(options)

    console.log('') // 空行分隔

    // 再运行验证
    logger.info('🔧 第二阶段：验证类型正确性')
    await runValidate(options)

    console.log(chalk.green('✅ 完整检查通过！'))
  } catch (error) {
    logger.error('检查过程中出现错误')
    process.exit(1)
  }
}

/**
 * 运行 detailed 命令
 */
export async function runDetailed(options) {
  const logger = new Logger(options.verbose)
  const spinner = ora('正在生成详细报告...').start()

  try {
    // 运行分析和验证
    const manager = new TypeManager({
      rootDir: options.root,
      outputDir: options.output,
      verbose: options.verbose,
    })

    const validator = new TypeValidator({
      rootDir: options.root,
      verbose: options.verbose,
    })

    const [analysisResult, validationResult] = await Promise.all([
      manager.analyze(),
      validator.validate(),
    ])

    // 生成详细报告
    const reporter = new ReportGenerator({
      outputDir: options.output,
      format: options.format,
    })

    const reportPath = await reporter.generateDetailedGuide(
      analysisResult,
      validationResult
    )

    spinner.succeed('详细报告生成完成')

    // 显示报告位置
    console.log(chalk.green(`📋 详细清理指南已生成:`))
    console.log(chalk.cyan(`   ${reportPath}`))
    console.log(chalk.yellow(`💡 使用编辑器打开: code "${reportPath}"`))
  } catch (error) {
    spinner.fail('报告生成失败')
    logger.error(error.message)
    process.exit(1)
  }
}

/**
 * 解析文件模式
 */
function parsePatterns(patterns) {
  if (typeof patterns === 'string') {
    return patterns.split(',').map(p => p.trim())
  }
  return patterns
}

/**
 * 显示分析结果
 */
function displayAnalysisResult(result, threshold) {
  console.log(chalk.blue('\n📊 类型系统分析报告'))
  console.log('='.repeat(50))

  console.log(chalk.green('\n📈 统计概览:'))
  console.log(`  📁 源文件数量: ${result.sourceFiles}`)
  console.log(`  🎯 类型定义: ${result.typeDefinitions}`)
  console.log(`  🔗 使用引用: ${result.usageReferences}`)
  console.log(`  ❌ 未使用类型: ${result.unusedTypes}`)
  console.log(`  ⚠️  重复定义: ${result.duplicateDefinitions}`)

  // 健康分数用颜色区分
  const scoreColor = result.healthScore >= threshold ? 'green' : 'red'
  console.log(`  💯 健康评分: ${chalk[scoreColor](result.healthScore)}/100`)

  // 显示建议
  if (result.suggestions && result.suggestions.length > 0) {
    console.log(chalk.yellow('\n💡 改进建议:'))
    result.suggestions.forEach(suggestion => {
      console.log(`  ${suggestion}`)
    })
  }
}

/**
 * 显示验证结果
 */
function displayValidationResult(result) {
  console.log(chalk.blue('\n📊 类型验证报告'))
  console.log('='.repeat(50))

  console.log(chalk.green('\n📈 验证结果:'))
  console.log(`  ❌ 错误总数: ${chalk.red(result.errors.length)}`)
  console.log(`  ⚠️  警告总数: ${chalk.yellow(result.warnings.length)}`)
  console.log(`  💯 验证评分: ${result.validationScore}/100`)

  // 显示错误详情（前5个）
  if (result.errors.length > 0) {
    console.log(chalk.red('\n🚨 类型错误:'))
    result.errors.slice(0, 5).forEach((error, index) => {
      console.log(
        `  ${index + 1}. ${error.file}:${error.line} - ${error.message}`
      )
    })

    if (result.errors.length > 5) {
      console.log(`  ... 还有 ${result.errors.length - 5} 个错误`)
    }
  }
}
