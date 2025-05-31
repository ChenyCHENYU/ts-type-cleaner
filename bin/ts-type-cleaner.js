#!/usr/bin/env node
import { Command } from 'commander'
import { analyzeProject } from '../lib/index.js'
import chalk from 'chalk'
import ora from 'ora'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf8')
)

const program = new Command()

program
  .name('ts-type-cleaner')
  .description('TypeScript 类型定义清理和优化工具')
  .version(packageJson.version)

program
  .command('analyze')
  .description('分析项目中的类型使用情况')
  .option('-r, --root <path>', '项目根目录', process.cwd())
  .option('-o, --output <path>', '输出目录', './type-reports')
  .option('-v, --verbose', '显示详细信息', false)
  .option('--threshold <number>', '健康分数阈值', '70')
  .action(async options => {
    const spinner = ora('正在分析类型使用情况...').start()

    try {
      const result = await analyzeProject({
        rootDir: options.root,
        outputDir: options.output,
        verbose: options.verbose,
        command: 'analyze',
      })

      spinner.succeed('类型分析完成')

      console.log(chalk.blue('\n📊 类型系统分析报告'))
      console.log('='.repeat(50))
      console.log(chalk.green('\n📈 统计概览:'))
      console.log(`  📁 源文件数量: ${result.analysis.sourceFiles}`)
      console.log(`  🎯 类型定义: ${result.analysis.typeDefinitions}`)
      console.log(`  ❌ 未使用类型: ${result.analysis.unusedTypes}`)
      console.log(`  ⚠️  重复定义: ${result.analysis.duplicateDefinitions}`)

      // 健康分数用颜色区分
      const scoreColor =
        result.analysis.healthScore >= parseInt(options.threshold)
          ? 'green'
          : 'red'
      console.log(
        `  💯 健康评分: ${chalk[scoreColor](result.analysis.healthScore)}/100`
      )

      if (result.analysis.suggestions?.length > 0) {
        console.log(chalk.yellow('\n💡 改进建议:'))
        result.analysis.suggestions.forEach(s => console.log(`  ${s}`))
      }

      // 检查健康分数阈值
      if (result.analysis.healthScore < parseInt(options.threshold)) {
        console.log(
          chalk.red(
            `\n⚠️ 健康分数 ${result.analysis.healthScore} 低于阈值 ${options.threshold}`
          )
        )
        process.exit(1)
      }
    } catch (error) {
      spinner.fail('分析失败')
      console.error(chalk.red(error.message))
      process.exit(1)
    }
  })

program
  .command('validate')
  .description('验证类型定义的正确性')
  .option('-r, --root <path>', '项目根目录', process.cwd())
  .option('-v, --verbose', '显示详细信息', false)
  .option('--strict', '严格模式', false)
  .option('--format', '美化错误显示', false)
  .action(async options => {
    const spinner = ora('正在验证类型正确性...').start()

    try {
      const result = await analyzeProject({
        rootDir: options.root,
        verbose: options.verbose,
        strict: options.strict,
        command: 'validate',
      })

      spinner.succeed('类型验证完成')

      console.log(chalk.blue('\n📊 类型验证报告'))
      console.log('='.repeat(50))
      console.log(`  ❌ 错误总数: ${result.validation.errors.length}`)
      console.log(`  ⚠️  警告总数: ${result.validation.warnings.length}`)
      console.log(`  💯 验证评分: ${result.validation.validationScore}/100`)

      // 显示错误
      if (result.validation.errors.length > 0) {
        if (options.format) {
          // 美化显示
          console.log(chalk.blue('\n🔍 详细错误信息:'))
          result.validation.errors.slice(0, 10).forEach((error, i) => {
            console.log(
              chalk.red(`\n${i + 1}. ${error.type?.toUpperCase() || 'ERROR'}`)
            )
            console.log(chalk.cyan(`   📁 ${error.file}:${error.line || ''}`))
            console.log(chalk.yellow(`   💬 ${error.message}`))
            if (error.code) {
              console.log(chalk.gray(`   🏷️ ${error.code}`))
            }

            // 简单的修复建议
            if (error.code === 'TS2304') {
              console.log(chalk.green('   💡 建议: 检查导入是否正确'))
            } else if (error.code === 'TS2322') {
              console.log(chalk.green('   💡 建议: 检查类型是否匹配'))
            } else if (error.code === 'TS2339') {
              console.log(chalk.green('   💡 建议: 检查属性名是否存在'))
            }
          })

          if (result.validation.errors.length > 10) {
            console.log(
              chalk.gray(
                `\n... 还有 ${result.validation.errors.length - 10} 个错误`
              )
            )
          }
        } else {
          // 简单显示
          console.log(chalk.red('\n🚨 类型错误:'))
          result.validation.errors.slice(0, 5).forEach((error, i) => {
            console.log(
              `  ${i + 1}. ${error.file}:${error.line} - ${error.message}`
            )
          })
          if (result.validation.errors.length > 5) {
            console.log(
              `  ... 还有 ${result.validation.errors.length - 5} 个错误`
            )
          }
          console.log(
            chalk.yellow('\n💡 提示: 使用 --format 获取详细的错误信息')
          )
        }
      }

      // 显示警告
      if (result.validation.warnings.length > 0) {
        console.log(chalk.yellow('\n⚠️ 警告:'))
        result.validation.warnings.slice(0, 3).forEach((warning, i) => {
          console.log(`  ${i + 1}. ${warning.message}`)
        })
        if (result.validation.warnings.length > 3) {
          console.log(
            `  ... 还有 ${result.validation.warnings.length - 3} 个警告`
          )
        }
      }

      if (result.validation.errors.length > 0) {
        process.exit(1)
      }
    } catch (error) {
      spinner.fail('验证失败')
      console.error(chalk.red(error.message))
      process.exit(1)
    }
  })

program
  .command('check')
  .description('完整检查（分析 + 验证）')
  .option('-r, --root <path>', '项目根目录', process.cwd())
  .option('-o, --output <path>', '输出目录', './type-reports')
  .option('-v, --verbose', '显示详细信息', false)
  .option('--format', '美化错误显示', false)
  .action(async options => {
    try {
      const result = await analyzeProject({
        rootDir: options.root,
        outputDir: options.output,
        verbose: options.verbose,
        command: 'check',
      })

      console.log(chalk.green('\n✅ 完整检查完成！'))
      console.log(chalk.cyan(`📋 详细报告已保存: ${result.guidePath}`))

      // 显示格式化的错误信息
      if (options.format && result.validation.errors.length > 0) {
        console.log(chalk.blue('\n🔍 主要类型错误:'))
        result.validation.errors.slice(0, 5).forEach((error, i) => {
          console.log(
            chalk.red(`\n${i + 1}. ${error.type?.toUpperCase() || 'ERROR'}`)
          )
          console.log(chalk.cyan(`   📁 ${error.file}:${error.line || ''}`))
          console.log(chalk.yellow(`   💬 ${error.message}`))
          if (error.code) {
            console.log(chalk.gray(`   🏷️ ${error.code}`))
          }
        })
      }
    } catch (error) {
      console.error(chalk.red('检查失败:', error.message))
      process.exit(1)
    }
  })

program.parse(process.argv)
