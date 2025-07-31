#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { analyzeProject, quickCheck, formatOutput, validateConfig, defaultConfig } from '../lib/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf8')
)

const program = new Command()

program
  .name('ts-type-cleaner')
  .description('🛠️ 精确的 TypeScript 类型分析和清理工具')
  .version(packageJson.version)

// 全局选项
program
  .option('-r, --root <path>', '项目根目录', process.cwd())
  .option('-v, --verbose', '显示详细信息', false)
  .option('--no-color', '禁用颜色输出')

/**
 * 分析命令
 */
program
  .command('analyze')
  .alias('a')
  .description('📊 分析项目中的类型使用情况')
  .option('-o, --output <path>', '输出目录', './type-reports')
  .option('--threshold <number>', '健康分数阈值', '70')
  .option('--include <patterns>', '包含文件模式 (逗号分隔)', 'src/**/*.{ts,tsx,vue}')
  .option('--exclude <patterns>', '排除文件模式 (逗号分隔)', 'node_modules,dist,.git')
  .action(async (options) => {
    const spinner = ora('🔍 分析类型使用情况...').start()

    try {
      const config = mergeConfig(options)
      const configValidation = validateConfig(config)
      
      if (!configValidation.valid) {
        spinner.fail('配置验证失败')
        configValidation.errors.forEach(error => console.error(chalk.red(`❌ ${error}`)))
        process.exit(1)
      }

      const result = await analyzeProject({
        ...config,
        command: 'analyze',
      })

      spinner.succeed('类型分析完成')

      // 显示结果
      console.log(formatOutput(result, {
        colorize: !options.noColor,
        showWarnings: false,
        showPerformance: options.verbose,
      }))

      // 检查阈值
      const threshold = parseInt(options.threshold)
      if (result.analysis.healthScore < threshold) {
        console.log(chalk.red(`\n⚠️ 健康分数 ${result.analysis.healthScore} 低于阈值 ${threshold}`))
        process.exit(1)
      }

    } catch (error) {
      spinner.fail('分析失败')
      console.error(chalk.red(`❌ ${error.message}`))
      if (options.verbose) {
        console.error(error)
      }
      process.exit(1)
    }
  })

/**
 * 验证命令
 */
program
  .command('validate')
  .alias('v')
  .description('🔧 验证类型定义的正确性')
  .option('--strict', '启用严格模式', false)
  .option('--max-errors <number>', '最大显示错误数', '10')
  .option('--max-warnings <number>', '最大显示警告数', '5')
  .option('--no-warnings', '不显示警告')
  .option('--format', '美化错误显示', false)
  .action(async (options) => {
    const spinner = ora('🔧 验证类型正确性...').start()

    try {
      const config = mergeConfig(options)
      const result = await analyzeProject({
        ...config,
        command: 'validate',
      })

      spinner.succeed('类型验证完成')

      // 显示结果
      console.log(formatOutput(result, {
        colorize: !options.noColor,
        showWarnings: options.warnings !== false,
        maxErrors: parseInt(options.maxErrors),
        maxWarnings: parseInt(options.maxWarnings),
        showContext: options.format,
        showSuggestions: options.format,
        showPerformance: options.verbose,
      }))

      // 如果有错误，退出码为 1
      if (result.validation.errors.length > 0) {
        process.exit(1)
      }

    } catch (error) {
      spinner.fail('验证失败')
      console.error(chalk.red(`❌ ${error.message}`))
      if (options.verbose) {
        console.error(error)
      }
      process.exit(1)
    }
  })

/**
 * 完整检查命令
 */
program
  .command('check')
  .alias('c')
  .description('🎯 完整检查 (分析 + 验证)')
  .option('-o, --output <path>', '输出目录', './type-reports')
  .option('--threshold <number>', '健康分数阈值', '70')
  .option('--strict', '启用严格模式', false)
  .option('--format', '美化错误显示', false)
  .action(async (options) => {
    const spinner = ora('🎯 执行完整检查...').start()

    try {
      const config = mergeConfig(options)
      const result = await analyzeProject({
        ...config,
        command: 'check',
      })

      spinner.succeed('完整检查完成')

      // 显示结果
      console.log(formatOutput(result, {
        colorize: !options.noColor,
        showWarnings: true,
        maxErrors: 10,
        maxWarnings: 5,
        showContext: options.format,
        showSuggestions: true,
        showPerformance: options.verbose,
      }))

      // 显示报告位置
      if (result.guidePath) {
        console.log(chalk.green(`\n📋 详细报告已生成:`))
        console.log(chalk.cyan(`   ${result.guidePath}`))
        console.log(chalk.yellow(`💡 使用编辑器打开: code "${result.guidePath}"`))
      }

      // 检查是否通过
      const threshold = parseInt(options.threshold)
      const healthScore = result.analysis.healthScore
      const hasErrors = result.validation.errors.length > 0

      if (hasErrors || healthScore < threshold) {
        const issues = []
        if (hasErrors) issues.push(`${result.validation.errors.length} 个类型错误`)
        if (healthScore < threshold) issues.push(`健康分数 ${healthScore} 低于阈值 ${threshold}`)
        
        console.log(chalk.red(`\n❌ 检查未通过: ${issues.join(', ')}`))
        process.exit(1)
      } else {
        console.log(chalk.green('\n✅ 所有检查都通过了！'))
      }

    } catch (error) {
      spinner.fail('检查失败')
      console.error(chalk.red(`❌ ${error.message}`))
      if (options.verbose) {
        console.error(error)
      }
      process.exit(1)
    }
  })

/**
 * 快速检查命令 - 适用于 CI/CD
 */
program
  .command('quick')
  .alias('q')
  .description('⚡ 快速检查 (仅验证，适用于 CI/CD)')
  .option('--threshold <number>', '分数阈值', '70')
  .option('--silent', '静默模式，只输出结果', false)
  .action(async (options) => {
    try {
      const config = mergeConfig(options)
      
      if (!options.silent) {
        console.log('⚡ 执行快速检查...')
      }

      const result = await quickCheck({
        ...config,
        threshold: parseInt(options.threshold),
      })

      if (options.silent) {
        console.log(result.passed ? 'PASS' : 'FAIL')
      } else {
        console.log(result.summary)
        if (!result.passed) {
          console.log(chalk.yellow(`   评分: ${result.score}/100`))
          console.log(chalk.yellow(`   错误: ${result.errors} 个`))
          console.log(chalk.yellow(`   警告: ${result.warnings} 个`))
        }
      }

      process.exit(result.passed ? 0 : 1)

    } catch (error) {
      if (!options.silent) {
        console.error(chalk.red(`❌ ${error.message}`))
      } else {
        console.log('ERROR')
      }
      process.exit(1)
    }
  })

/**
 * 配置检查命令
 */
program
  .command('config')
  .description('🔧 检查配置是否正确')
  .action(async (options) => {
    const config = mergeConfig(options)
    const validation = validateConfig(config)

    console.log(chalk.blue('📋 配置检查结果:'))
    console.log('='.repeat(40))

    if (validation.valid) {
      console.log(chalk.green('✅ 配置验证通过'))
    } else {
      console.log(chalk.red('❌ 配置验证失败'))
      validation.errors.forEach(error => {
        console.log(chalk.red(`   • ${error}`))
      })
    }

    if (validation.warnings.length > 0) {
      console.log(chalk.yellow('\n⚠️ 配置警告:'))
      validation.warnings.forEach(warning => {
        console.log(chalk.yellow(`   • ${warning}`))
      })
    }

    console.log(chalk.gray('\n📖 当前配置:'))
    console.log(JSON.stringify(config, null, 2))

    process.exit(validation.valid ? 0 : 1)
  })

/**
 * 合并配置
 */
function mergeConfig(options) {
  const globalOptions = program.opts()
  
  return {
    ...defaultConfig,
    rootDir: globalOptions.root || options.root || defaultConfig.rootDir,
    verbose: globalOptions.verbose || options.verbose || defaultConfig.verbose,
    strict: options.strict || defaultConfig.strict,
    outputDir: options.output || defaultConfig.outputDir,
    colorize: !globalOptions.noColor,
    include: parsePatterns(options.include || defaultConfig.include),
    exclude: parsePatterns(options.exclude || defaultConfig.exclude),
  }
}

/**
 * 解析文件模式
 */
function parsePatterns(patterns) {
  if (typeof patterns === 'string') {
    return patterns.split(',').map(p => p.trim())
  }
  return Array.isArray(patterns) ? patterns : [patterns]
}

// 全局错误处理
process.on('uncaughtException', (error) => {
  console.error(chalk.red('💥 未捕获的异常:'), error.message)
  if (program.opts().verbose) {
    console.error(error.stack)
  }
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('💥 未处理的 Promise 拒绝:'), reason)
  if (program.opts().verbose) {
    console.error('Promise:', promise)
  }
  process.exit(1)
})

program.parse(process.argv)

// 如果没有提供命令，显示帮助
if (!process.argv.slice(2).length) {
  program.outputHelp()
}