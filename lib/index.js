// lib/index.js - 最简版本，只保留基础功能
export { TypeManager } from './core/TypeManager.js'
export { TypeValidator } from './core/TypeValidator.js'
export { ReportGenerator } from './core/ReportGenerator.js'

export async function analyzeProject(options = {}) {
  const { TypeManager } = await import('./core/TypeManager.js')
  const { TypeValidator } = await import('./core/TypeValidator.js')
  const { ReportGenerator } = await import('./core/ReportGenerator.js')

  try {
    const command = options.command || 'check'

    if (command === 'analyze' || command === 'check') {
      const typeManager = new TypeManager(options)
      const analysisResult = await typeManager.analyze()

      if (command === 'analyze') {
        return { analysis: analysisResult }
      }

      if (command === 'check') {
        const typeValidator = new TypeValidator(options)
        const validationResult = await typeValidator.validate()

        const reportGenerator = new ReportGenerator(options)
        const guidePath = await reportGenerator.generateDetailedGuide(
          analysisResult,
          validationResult
        )

        return {
          analysis: analysisResult,
          validation: validationResult,
          guidePath,
        }
      }
    }

    if (command === 'validate') {
      const typeValidator = new TypeValidator(options)
      const validationResult = await typeValidator.validate()
      return { validation: validationResult }
    }
  } catch (error) {
    console.error('❌ 分析过程中出现错误:', error.message)
    throw error
  }
}
