#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { TypeAnalyzer } from './analyzer.js'
import { ReportGenerator } from './reporter.js'

const program = new Command()

program
  .name('vue-type-checker')
  .description('🛠️ Vue3 + TypeScript 项目类型分析工具')
  .version('1.0.0')

// analyze 命令 - 完整分析
program
  .command('analyze')
  .alias('a')
  .description('📊 分析项目类型使用情况')
  .option('-r, --root <path>', '项目根目录', process.cwd())
  .option('-v, --verbose', '显示详细信息', false)
  .option('--no-report', '不生成 Markdown 报告')
  .action(async (options) => {
    const spinner = ora('🔍 正在分析类型...').start()
    
    try {
      const analyzer = new TypeAnalyzer({
        rootDir: options.root,
        verbose: options.verbose
      })
      
      const report = await analyzer.analyze()
      spinner.succeed('✅ 分析完成')
      
      // 生成控制台输出
      const reporter = new ReportGenerator(options.root)
      reporter.generateConsoleOutput(report)
      
      // 生成 Markdown 报告
      if (options.report !== false) {
        await reporter.generateMarkdownReport(report)
      }
      
      // 根据结果设置退出码
      if (report.issues.errors.length > 0) {
        process.exit(1)
      }
      
    } catch (error) {
      spinner.fail('❌ 分析失败')
      console.error(chalk.red('\n错误:'), error.message)
      if (options.verbose) {
        console.error(chalk.gray(error.stack))
      }
      process.exit(1)
    }
  })

// check 命令 - 快速检查
program
  .command('check')
  .alias('c')
  .description('🎯 快速检查类型错误')
  .option('-r, --root <path>', '项目根目录', process.cwd())
  .option('-t, --threshold <number>', '健康度阈值', '70')
  .action(async (options) => {
    const spinner = ora('🎯 正在检查...').start()
    
    try {
      const analyzer = new TypeAnalyzer({
        rootDir: options.root,
        verbose: false
      })
      
      const report = await analyzer.analyze()
      spinner.stop()
      
      const threshold = parseInt(options.threshold)
      const hasErrors = report.issues.errors.length > 0
      const lowScore = report.healthScore < threshold
      
      // 简化输出
      console.log('\n' + '─'.repeat(50))
      console.log(chalk.cyan.bold('🎯 TypeScript 类型检查'))
      console.log('─'.repeat(50))
      
      const scoreColor = report.healthScore >= 80 ? 'green' : 
                        report.healthScore >= 60 ? 'yellow' : 'red'
      console.log(`📊 健康度评分: ${chalk[scoreColor].bold(report.healthScore)}/100`)
      
      if (hasErrors) {
        console.log(`🚨 类型错误: ${chalk.red.bold(report.issues.errors.length)}`)
      }
      
      if (Object.keys(report.issues.duplicates).length > 0) {
        console.log(`⚠️ 重复定义: ${chalk.yellow.bold(Object.keys(report.issues.duplicates).length)}`)
      }
      
      if (report.issues.unused.length > 0) {
        console.log(`🗑️ 未使用类型: ${chalk.yellow.bold(report.issues.unused.length)}`)
      }
      
      console.log('─'.repeat(50))
      
      if (hasErrors || lowScore) {
        console.log(chalk.red.bold('\n❌ 检查未通过'))
        if (hasErrors) {
          console.log(chalk.gray(`   发现 ${report.issues.errors.length} 个类型错误`))
        }
        if (lowScore) {
          console.log(chalk.gray(`   健康度 ${report.healthScore} 低于阈值 ${threshold}`))
        }
        console.log(chalk.gray('\n   运行 `vue-type-checker analyze` 查看详细信息'))
        process.exit(1)
      } else {
        console.log(chalk.green.bold('\n🎉 检查通过！'))
      }
      
    } catch (error) {
      spinner.fail('❌ 检查失败')
      console.error(chalk.red('\n错误:'), error.message)
      process.exit(1)
    }
  })

// summary 命令 - 项目概览
program
  .command('summary')
  .alias('s')
  .description('📈 显示项目类型统计概览')
  .option('-r, --root <path>', '项目根目录', process.cwd())
  .action(async (options) => {
    const spinner = ora('📈 正在统计...').start()
    
    try {
      const analyzer = new TypeAnalyzer({
        rootDir: options.root,
        verbose: false
      })
      
      const report = await analyzer.analyze()
      spinner.stop()
      
      const stats = report.statistics
      
      console.log('\n' + '═'.repeat(40))
      console.log(chalk.cyan.bold('📈 项目类型统计'))
      console.log('═'.repeat(40))
      
      const data = [
        ['📁 源文件', stats.totalFiles],
        ['🎯 类型定义', stats.totalTypes],
        ['🔗 类型引用', stats.totalUsages],
        ['🚨 类型错误', stats.totalErrors],
        ['⚠️ 重复定义', stats.duplicateTypes],
        ['🗑️ 未使用类型', stats.unusedTypes]
      ]
      
      data.forEach(([label, value]) => {
        const color = label.includes('错误') && value > 0 ? 'red' :
                     label.includes('重复') && value > 0 ? 'yellow' :
                     label.includes('未使用') && value > 0 ? 'yellow' : 'cyan'
        
        console.log(`${label.padEnd(12)} ${chalk[color].bold(value.toString().padStart(3))}`)
      })
      
      console.log('═'.repeat(40) + '\n')
      
    } catch (error) {
      spinner.fail('❌ 统计失败')
      console.error(chalk.red('\n错误:'), error.message)
      process.exit(1)
    }
  })

// 全局错误处理
process.on('uncaughtException', (error) => {
  console.error(chalk.red('\n💥 未捕获异常:'), error.message)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('\n💥 未处理拒绝:'), reason)
  process.exit(1)
})

// 解析命令行参数
program.parse()

// 如果没有提供命令，显示帮助
if (!process.argv.slice(2).length) {
  program.outputHelp()
}