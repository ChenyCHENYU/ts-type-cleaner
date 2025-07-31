// lib/index.js - 优化版本
import { TypeManager } from './core/TypeManager.js'
import { TypeValidator } from './core/TypeValidator.js'
import { ReportGenerator } from './core/ReportGenerator.js'
import { ErrorFormatter } from './utils/errorFormatter.js'

export { TypeManager, TypeValidator, ReportGenerator, ErrorFormatter }

/**
 * 主分析函数 - 统一入口
 */
export async function analyzeProject(options = {}) {
  const startTime = Date.now()
  
  // 标准化选项
  const normalizedOptions = {
    rootDir: options.rootDir || process.cwd(),
    outputDir: options.outputDir || './type-reports',
    verbose: options.verbose || false,
    strict: options.strict || false,
    command: options.command || 'check',
    include: options.include || ['src/**/*.{ts,tsx,vue}'],
    exclude: options.exclude || ['node_modules', 'dist', '.git', '**/*.d.ts'],
    ...options,
  }

  try {
    const result = {}
    
    switch (normalizedOptions.command) {
      case 'analyze':
        result.analysis = await runAnalysis(normalizedOptions)
        break
        
      case 'validate':
        result.validation = await runValidation(normalizedOptions)
        break
        
      case 'check':
      default:
        // 并行运行分析和验证以提高性能
        const [analysis, validation] = await Promise.all([
          runAnalysis(normalizedOptions),
          runValidation(normalizedOptions)
        ])
        
        result.analysis = analysis
        result.validation = validation
        
        // 生成综合报告
        const reportGenerator = new ReportGenerator(normalizedOptions)
        result.guidePath = await reportGenerator.generateDetailedGuide(analysis, validation)
        break
    }

    // 添加性能统计
    result.performance = {
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }

    if (normalizedOptions.verbose) {
      console.log(`✅ 分析完成，耗时 ${result.performance.duration}ms`)
    }

    return result
    
  } catch (error) {
    // 增强错误信息
    const enhancedError = new Error(`TypeScript 分析失败: ${error.message}`)
    enhancedError.originalError = error
    enhancedError.options = normalizedOptions
    enhancedError.duration = Date.now() - startTime
    
    if (normalizedOptions.verbose) {
      console.error('详细错误信息:', error)
    }
    
    throw enhancedError
  }
}

/**
 * 运行类型分析
 */
async function runAnalysis(options) {
  if (options.verbose) {
    console.log('🔍 开始类型使用分析...')
  }

  const typeManager = new TypeManager(options)
  const result = await typeManager.analyze()

  if (options.verbose) {
    console.log(`📊 分析完成: ${result.typeDefinitions} 个类型, ${result.unusedTypes} 个未使用`)
  }

  return result
}

/**
 * 运行类型验证
 */
async function runValidation(options) {
  if (options.verbose) {
    console.log('🔧 开始类型验证...')
  }

  const typeValidator = new TypeValidator(options)
  const result = await typeValidator.validate()

  if (options.verbose) {
    console.log(`🚨 验证完成: ${result.errors.length} 个错误, ${result.warnings.length} 个警告`)
  }

  return result
}

/**
 * 快速检查函数 - 用于 CI/CD
 */
export async function quickCheck(options = {}) {
  const result = await analyzeProject({
    ...options,
    command: 'validate',
    verbose: false,
  })

  const hasErrors = result.validation.errors.length > 0
  const score = result.validation.validationScore

  return {
    passed: !hasErrors && score >= (options.threshold || 70),
    score,
    errors: result.validation.errors.length,
    warnings: result.validation.warnings.length,
    summary: hasErrors 
      ? `❌ 发现 ${result.validation.errors.length} 个类型错误`
      : `✅ 类型检查通过 (评分: ${score}/100)`,
  }
}

/**
 * 格式化输出错误 - 用于 CLI
 */
export function formatOutput(result, options = {}) {
  const formatter = new ErrorFormatter({
    colorize: options.colorize !== false,
    showContext: options.showContext !== false,
    showSuggestions: options.showSuggestions !== false,
  })

  const output = []

  // 分析结果
  if (result.analysis) {
    output.push('📊 类型分析结果:')
    output.push(`   源文件: ${result.analysis.sourceFiles}`)
    output.push(`   类型定义: ${result.analysis.typeDefinitions}`)
    output.push(`   未使用类型: ${result.analysis.unusedTypes}`)
    output.push(`   重复定义: ${result.analysis.duplicateDefinitions}`)
    output.push(`   健康评分: ${result.analysis.healthScore}/100`)
    output.push('')
  }

  // 验证结果
  if (result.validation) {
    output.push('🔧 类型验证结果:')
    output.push(`   错误: ${result.validation.errors.length}`)
    output.push(`   警告: ${result.validation.warnings.length}`)
    output.push(`   验证评分: ${result.validation.validationScore}/100`)
    output.push('')

    // 格式化错误
    if (result.validation.errors.length > 0) {
      const errorOutput = formatter.formatErrors(
        result.validation.errors.slice(0, options.maxErrors || 10),
        '类型错误'
      )
      output.push(errorOutput)
    }

    // 格式化警告
    if (result.validation.warnings.length > 0 && options.showWarnings !== false) {
      const warningOutput = formatter.formatErrors(
        result.validation.warnings.slice(0, options.maxWarnings || 5),
        '警告'
      )
      output.push(warningOutput)
    }
  }

  // 建议
  const allSuggestions = [
    ...(result.analysis?.suggestions || []),
    ...(result.validation?.suggestions || []),
  ]

  if (allSuggestions.length > 0) {
    output.push('💡 改进建议:')
    allSuggestions.forEach(suggestion => {
      output.push(`   ${suggestion}`)
    })
    output.push('')
  }

  // 性能信息
  if (result.performance && options.showPerformance) {
    output.push(`⏱️ 分析耗时: ${result.performance.duration}ms`)
  }

  return output.join('\n')
}

/**
 * 配置验证
 */
export function validateConfig(options) {
  const errors = []
  const warnings = []

  // 检查必要的字段
  if (!options.rootDir) {
    errors.push('rootDir 是必需的')
  }

  // 检查路径是否存在
  if (options.rootDir && !require('fs').existsSync(options.rootDir)) {
    errors.push(`rootDir 路径不存在: ${options.rootDir}`)
  }

  // 检查输出目录权限
  if (options.outputDir) {
    try {
      require('fs').accessSync(require('path').dirname(options.outputDir), require('fs').constants.W_OK)
    } catch (error) {
      warnings.push(`输出目录可能没有写入权限: ${options.outputDir}`)
    }
  }

  // 检查 include/exclude 模式
  if (options.include && !Array.isArray(options.include)) {
    warnings.push('include 应该是一个数组')
  }

  if (options.exclude && !Array.isArray(options.exclude)) {
    warnings.push('exclude 应该是一个数组')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * 默认配置
 */
export const defaultConfig = {
  rootDir: process.cwd(),
  outputDir: './type-reports',
  verbose: false,
  strict: false,
  include: ['src/**/*.{ts,tsx,vue}'],
  exclude: ['node_modules', 'dist', '.git', '**/*.d.ts', '**/*.spec.ts', '**/*.test.ts'],
  threshold: 70,
  maxErrors: 20,
  maxWarnings: 10,
  showContext: true,
  showSuggestions: true,
  colorize: true,
}