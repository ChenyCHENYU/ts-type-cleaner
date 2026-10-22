#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { TypeAnalyzer } from '../lib/analyzer.js'
import { ReportGenerator } from '../lib/reporter.js'
import { TypeFixer } from '../lib/fixer.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

const program = new Command()

program
  .name('ts-type-cleaner')
  .description('🛠️ TypeScript 类型分析和清理工具')
  .version(pkg.version)

// analyze 命令 - 完整分析
program
  .command('analyze')
  .alias('a')
  .description('📊 分析项目类型使用情况')
  .option('-r, --root <path>', '项目根目录', process.cwd())
  .option('--src <dir>', '源码目录（相对 root）', 'src')
  .option('--exclude <dirs>', '追加排除目录，逗号分隔', '')
  .option('--allow <names>', '公共 API 白名单，逗号分隔（不计为未使用）', '')
  .option('--ignore-pattern <names>', '命名豁免追加后缀，逗号分隔（默认仅豁免 Vue 惯用名 Props/Emits）', '')
  .option('--json', 'JSON 格式输出（隐含不生成 Markdown 报告）', false)
  .option('-v, --verbose', '显示详细信息', false)
  .option('--no-report', '不生成 Markdown 报告')
  .option('--fix', '生成未使用类型的删除计划（默认 dry-run 只预览不写盘）', false)
  .option('--write', '配合 --fix 实际写盘（写盘后自动跑错误验证，失败整体回滚）', false)
  .option('--no-errors', '跳过类型错误检测（日常清理更快；--fix 时强制完整检测）')
  .option('--error-engine <engine>', '错误检测口径：auto | tsc | vue-tsc（默认 auto：装了 vue-tsc 就用）', 'auto')
  .action(async (options) => {
    const spinner = ora('🔍 正在分析类型...').start()
    
    try {
      const analyzer = new TypeAnalyzer({
        rootDir: options.root,
        srcDir: options.src,
        exclude: (options.exclude || '').split(',').map(s => s.trim()).filter(Boolean),
        allow: (options.allow || '').split(',').map(s => s.trim()).filter(Boolean),
        ignorePattern: (options.ignorePattern || '').split(',').map(s => s.trim()).filter(Boolean),
        // --fix 需要错误数据做删除后验证的基线，强制完整检测
        // commander 的 --no-errors 写入 options.errors（传参后为 false）
        skipErrors: options.fix ? false : options.errors === false,
        errorEngine: options.errorEngine,
        verbose: options.verbose
      })
      
      const report = await analyzer.analyze()

      // JSON 输出：纯净数据，隐含不生成 Markdown 报告
      if (options.json) {
        spinner.stop()
        console.log(JSON.stringify(report, null, 2))
      } else {
        spinner.succeed('✅ 分析完成')

        // 生成控制台输出
        const reporter = new ReportGenerator(options.root)
        reporter.generateConsoleOutput(report)

        // 生成 Markdown 报告
        if (options.report !== false) {
          await reporter.generateMarkdownReport(report)
        }
      }
      
      // --fix：生成删除计划；--write 才写盘（验证失败自动回滚）
      if (options.fix) {
        spinner.stop()
        const fixer = new TypeFixer(options.root)
        const { plans, skipped } = fixer.planFixes(report.issues.unused)

        if (plans.length === 0 && skipped.length === 0) {
          console.log(chalk.green('\n✨ 没有可删除的类型声明'))
        } else {
          console.log('\n' + '─'.repeat(50))
          console.log(chalk.cyan.bold(options.write ? '🔧 正在删除未使用类型...' : '🔧 删除计划（dry-run，加 --write 执行）'))
          console.log('─'.repeat(50))
          for (const plan of plans) {
            console.log(`\n📄 ${chalk.blue(plan.file)}`)
            for (const r of plan.removals) {
              console.log(`   ✂️  删除 ${chalk.yellow(r.name)}（第 ${r.startLine}-${r.endLine} 行）`)
            }
          }
          for (const item of skipped) {
            console.log(chalk.gray(`\n⏭️  跳过 ${item.name}（${item.file}:${item.line}）— ${item.reason}`))
          }

          if (options.write && plans.length > 0) {
            fixer.apply(plans)
            const { newErrors } = fixer.verify(analyzer, report.issues.errors)
            if (newErrors.length > 0) {
              fixer.revert(plans)
              console.log(chalk.red.bold(`\n❌ 删除后验证发现 ${newErrors.length} 个新增类型错误，已整体回滚`))
              for (const e of newErrors.slice(0, 5)) {
                console.log(chalk.gray(`   ${e.file}:${e.line} ${e.code} ${e.message.slice(0, 60)}`))
              }
              process.exit(1)
            }
            console.log(chalk.green.bold(`\n✅ 已删除并验证通过（无新增类型错误），共修改 ${plans.length} 个文件`))
          }
        }
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
  .option('--src <dir>', '源码目录（相对 root）', 'src')
  .option('--exclude <dirs>', '追加排除目录，逗号分隔', '')
  .option('--allow <names>', '公共 API 白名单，逗号分隔（不计为未使用）', '')
  .option('--ignore-pattern <names>', '命名豁免追加后缀，逗号分隔（默认仅豁免 Vue 惯用名 Props/Emits）', '')
  .option('--json', 'JSON 格式输出（隐含不生成 Markdown 报告）', false)
  .option('-t, --threshold <number>', '健康度阈值', '70')
  .option('--max-unused <number>', '允许的未使用类型上限，超出则以非零码退出', '')
  .option('--no-errors', '跳过类型错误检测（仅卡 unused 与健康度）')
  .option('--error-engine <engine>', '错误检测口径：auto | tsc | vue-tsc', 'auto')
  .action(async (options) => {
    const spinner = ora('🎯 正在检查...').start()
    
    try {
      const analyzer = new TypeAnalyzer({
        rootDir: options.root,
        srcDir: options.src,
        exclude: (options.exclude || '').split(',').map(s => s.trim()).filter(Boolean),
        allow: (options.allow || '').split(',').map(s => s.trim()).filter(Boolean),
        ignorePattern: (options.ignorePattern || '').split(',').map(s => s.trim()).filter(Boolean),
        skipErrors: options.errors === false,
        errorEngine: options.errorEngine || 'auto',
        verbose: false
      })
      
      const report = await analyzer.analyze()
      spinner.stop()
      
      const threshold = parseInt(options.threshold)
      const maxUnused = options.maxUnused !== '' && options.maxUnused !== undefined
        ? parseInt(options.maxUnused) : null
      const hasErrors = report.issues.errors.length > 0
      const lowScore = report.healthScore < threshold
      const tooManyUnused = maxUnused !== null && !Number.isNaN(maxUnused)
        && report.issues.unused.length > maxUnused

      // JSON 输出：纯净数据 + 结论字段
      if (options.json) {
        console.log(JSON.stringify({
          passed: !hasErrors && !lowScore && !tooManyUnused,
          healthScore: report.healthScore,
          threshold,
          maxUnused,
          errors: report.issues.errors.length,
          duplicates: Object.keys(report.issues.duplicates).length,
          unused: report.issues.unused.length
        }, null, 2))
        if (hasErrors || lowScore || tooManyUnused) process.exit(1)
        return
      }
      
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
      
      if (tooManyUnused) {
        console.log(`🗑️ 未使用类型: ${chalk.yellow.bold(report.issues.unused.length)}（上限 ${maxUnused}）`)
      }

      if (hasErrors || lowScore || tooManyUnused) {
        console.log(chalk.red.bold('\n❌ 检查未通过'))
        if (hasErrors) {
          console.log(chalk.gray(`   发现 ${report.issues.errors.length} 个类型错误`))
        }
        if (lowScore) {
          console.log(chalk.gray(`   健康度 ${report.healthScore} 低于阈值 ${threshold}`))
        }
        if (tooManyUnused) {
          console.log(chalk.gray(`   未使用类型 ${report.issues.unused.length} 个，超过上限 ${maxUnused}`))
        }
        console.log(chalk.gray('\n   运行 `ts-type-cleaner analyze` 查看详细信息'))
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
  .option('--src <dir>', '源码目录（相对 root）', 'src')
  .option('--exclude <dirs>', '追加排除目录，逗号分隔', '')
  .option('--allow <names>', '公共 API 白名单，逗号分隔（不计为未使用）', '')
  .option('--ignore-pattern <names>', '命名豁免追加后缀，逗号分隔（默认仅豁免 Vue 惯用名 Props/Emits）', '')
  .option('--json', 'JSON 格式输出（隐含不生成 Markdown 报告）', false)
  .option('--no-errors', '跳过类型错误检测')
  .option('--error-engine <engine>', '错误检测口径：auto | tsc | vue-tsc', 'auto')
  .action(async (options) => {
    const spinner = ora('📈 正在统计...').start()
    
    try {
      const analyzer = new TypeAnalyzer({
        rootDir: options.root,
        srcDir: options.src,
        exclude: (options.exclude || '').split(',').map(s => s.trim()).filter(Boolean),
        allow: (options.allow || '').split(',').map(s => s.trim()).filter(Boolean),
        ignorePattern: (options.ignorePattern || '').split(',').map(s => s.trim()).filter(Boolean),
        skipErrors: options.errors === false,
        errorEngine: options.errorEngine || 'auto',
        verbose: false
      })
      
      const report = await analyzer.analyze()
      spinner.stop()
      
      const stats = report.statistics

      // JSON 输出：纯净统计
      if (options.json) {
        console.log(JSON.stringify({ statistics: stats, healthScore: report.healthScore }, null, 2))
        return
      }
      
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