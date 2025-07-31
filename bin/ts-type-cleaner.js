#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { analyzeProject, quickCheck, formatOutput, Formatter } from '../lib/index.js'
import { mergeConfig, validateConfig, createConfig } from '../lib/utils/cli.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))

const program = new Command()

program
  .name('ts-type-cleaner')
  .description('🛠️ TypeScript 类型分析和清理工具')
  .version(packageJson.version)
  .option('-r, --root <path>', '项目根目录', process.cwd())
  .option('-v, --verbose', '显示详细信息', false)
  .option('--no-color', '禁用颜色输出')
  .option('--config <path>', '指定配置文件路径')

// analyze 命令
program
  .command('analyze')
  .alias('a')
  .description('📊 分析项目类型使用情况')
  .option('-o, --output <path>', '输出目录', './type-reports')
  .option('-t, --threshold <number>', '健康分数阈值', '70')
  .option('--include <patterns>', '包含文件模式', 'src/**/*.{ts,tsx,vue}')
  .option('--exclude <patterns>', '排除文件模式', 'node_modules,dist,.git')
  .option('--json', '输出JSON格式', false)
  .action(async (options) => {
    await runCommand(options, async (config) => {
      const result = await analyzeProject(config)
      
      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(formatOutput(result, { colorize: config.colorize }))
      }

      const threshold = parseInt(options.threshold)
      if (result.scores.healthScore < threshold) {
        console.log(chalk.red.bold(`\n❌ 健康分数 ${result.scores.healthScore} 低于阈值 ${threshold}`))
        process.exit(1)
      }
    })
  })

// validate 命令
program
  .command('validate')
  .alias('v')
  .description('🔧 验证类型定义正确性')
  .option('--strict', '启用严格模式', false)
  .option('--fix', '尝试自动修复', false)
  .option('--json', '输出JSON格式', false)
  .action(async (options) => {
    await runCommand(options, async (config) => {
      const result = await analyzeProject({
        ...config,
        strict: options.strict,
        autoFix: options.fix,
      })

      if (options.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(formatOutput(result, { colorize: config.colorize }))
      }

      if (result.details.errors.length > 0) {
        console.log(chalk.red.bold(`\n❌ 发现 ${result.details.errors.length} 个类型错误`))
        process.exit(1)
      }
    })
  })

// check 命令
program
  .command('check')
  .alias('c')
  .description('🎯 完整检查')
  .option('-o, --output <path>', '输出目录', './type-reports')
  .option('-t, --threshold <number>', '健康分数阈值', '70')
  .option('--format <format>', '报告格式', 'html')
  .action(async (options) => {
    await runCommand(options, async (config) => {
      const result = await analyzeProject(config)
      
      // 生成报告
      const { ReportGenerator } = await import('../lib/core/ReportGenerator.js')
      const reporter = new ReportGenerator({
        outputDir: config.outputDir,
        format: options.format,
      })
      const reportPath = await reporter.generateDetailedGuide(result)

      console.log(formatOutput(result, { colorize: config.colorize }))
      console.log(chalk.green.bold(`\n📋 详细报告: ${chalk.cyan(reportPath)}`))

      // 检查结果
      const threshold = parseInt(options.threshold)
      const hasErrors = result.details.errors.length > 0
      const lowScore = result.scores.healthScore < threshold

      if (hasErrors || lowScore) {
        console.log(chalk.red.bold('\n❌ 检查未通过'))
        process.exit(1)
      } else {
        console.log(chalk.green.bold('\n🎉 检查通过！'))
      }
    })
  })

// quick 命令
program
  .command('quick')
  .alias('q')
  .description('⚡ 快速检查')
  .option('-t, --threshold <number>', '分数阈值', '70')
  .option('--silent', '静默模式', false)
  .option('--format <format>', '输出格式', 'text')
  .action(async (options) => {
    try {
      const config = mergeConfig(program.opts(), options)
      const result = await quickCheck({
        ...config,
        threshold: parseInt(options.threshold),
      })

      if (!options.silent) {
        console.log('⚡ 快速检查结果:')
      }

      const formatter = new Formatter()
      console.log(formatter.formatQuickResult(result, options.format))
      
      process.exit(result.passed ? 0 : 1)
    } catch (error) {
      if (!options.silent) {
        console.error(chalk.red('❌ 检查失败:'), error.message)
      }
      process.exit(1)
    }
  })

// init 命令
program
  .command('init')
  .description('🚀 初始化配置文件')
  .option('--force', '强制覆盖', false)
  .action(async (options) => {
    try {
      const configPath = createConfig(options.force)
      console.log(chalk.green('✅ 配置文件已创建:'), chalk.cyan(configPath))
    } catch (error) {
      console.error(chalk.red('❌ 创建失败:'), error.message)
      process.exit(1)
    }
  })

// 通用命令处理
async function runCommand(options, handler) {
  const spinner = ora('⚙️ 执行中...').start()
  
  try {
    const config = mergeConfig(program.opts(), options)
    const validation = validateConfig(config)
    
    if (!validation.valid) {
      spinner.fail('配置验证失败')
      validation.errors.forEach(error => {
        console.error(chalk.red(`  • ${error}`))
      })
      process.exit(1)
    }

    await handler(config)
    spinner.succeed('✅ 完成')
  } catch (error) {
    spinner.fail('❌ 失败')
    console.error(chalk.red('错误:'), error.message)
    if (program.opts().verbose && error.stack) {
      console.error(chalk.gray(error.stack))
    }
    process.exit(1)
  }
}

// 错误处理
process.on('uncaughtException', (error) => {
  console.error(chalk.red('💥 未捕获异常:'), error.message)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('💥 未处理拒绝:'), reason)
  process.exit(1)
})

program.parse()