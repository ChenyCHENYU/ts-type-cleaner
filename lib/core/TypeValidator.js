import { readFileSync, existsSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { execSync } from 'child_process'
import { scanFiles } from '../utils/fileScanner.js'

export class TypeValidator {
  constructor(options = {}) {
    this.options = {
      rootDir: options.rootDir || process.cwd(),
      strict: options.strict || false,
      verbose: options.verbose || false,
      ...options,
    }

    this.errors = []
    this.warnings = []
  }

  async validate() {
    try {
      await this.runTypeScriptCheck()
      await this.checkBestPractices()
      return this.generateValidationReport()
    } catch (error) {
      console.error('验证过程中出现错误:', error.message)
      throw error
    }
  }

  async runTypeScriptCheck() {
    try {
      const configPath = resolve(this.options.rootDir, 'tsconfig.json')

      if (!existsSync(configPath)) {
        if (this.options.verbose) {
          console.log('未找到 tsconfig.json，跳过 TypeScript 检查')
        }
        return
      }

      const result = execSync(`npx tsc --noEmit --project "${configPath}"`, {
        cwd: this.options.rootDir,
        stdio: 'pipe',
        encoding: 'utf8',
      })

      if (this.options.verbose) {
        console.log('TypeScript 编译检查通过')
      }
    } catch (error) {
      const output = error.stdout ? error.stdout.toString() : error.message
      this.parseTypeScriptErrors(output)
    }
  }

  parseTypeScriptErrors(output) {
    const errorRegex = /([^:]+):(\d+):(\d+) - error TS(\d+): (.+)/g
    let match

    while ((match = errorRegex.exec(output)) !== null) {
      this.errors.push({
        type: 'typescript',
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        code: `TS${match[4]}`,
        message: match[5],
        severity: 'error',
      })
    }
  }

  async checkBestPractices() {
    const srcDir = join(this.options.rootDir, 'src')
    const files = scanFiles(srcDir, ['.ts', '.vue'], ['node_modules', 'dist'])

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, 'utf8')

        // 检查 any 类型使用
        const anyRegex = /:\s*any\b/g
        const anyMatches = content.match(anyRegex)
        if (anyMatches && anyMatches.length > 0) {
          this.warnings.push({
            type: 'best-practice',
            file: filePath,
            message: `发现 ${anyMatches.length} 处 any 类型使用，建议使用具体类型`,
            severity: 'warning',
          })
        }

        // 检查未使用的导入
        const importRegex = /import\s+\{([^}]+)\}\s+from/g
        let match
        while ((match = importRegex.exec(content)) !== null) {
          const imports = match[1].split(',').map(i => i.trim())
          for (const imp of imports) {
            const usageRegex = new RegExp(`\\b${imp}\\b`, 'g')
            const usages = content.match(usageRegex)
            if (!usages || usages.length <= 1) {
              this.warnings.push({
                type: 'unused-import',
                file: filePath,
                line: this.getLineNumber(content, match.index),
                message: `未使用的导入: ${imp}`,
                severity: 'warning',
              })
            }
          }
        }
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`无法检查文件 ${filePath}: ${error.message}`)
        }
      }
    }
  }

  generateValidationReport() {
    const totalErrors = this.errors.length
    const totalWarnings = this.warnings.length
    const validationScore = this.calculateValidationScore(
      totalErrors,
      totalWarnings
    )

    return {
      timestamp: new Date().toISOString(),
      errors: this.errors,
      warnings: this.warnings,
      validationScore,
      suggestions: this.generateValidationSuggestions(),
    }
  }

  calculateValidationScore(errors, warnings) {
    const errorPenalty = errors * 15
    const warningPenalty = warnings * 5
    return Math.max(0, Math.round(100 - errorPenalty - warningPenalty))
  }

  generateValidationSuggestions() {
    const suggestions = []

    if (this.errors.length > 0) {
      suggestions.push(
        `🔴 修复 ${this.errors.length} 个类型错误以提高类型安全性`
      )
    }

    const practiceWarnings = this.warnings.filter(
      w => w.type === 'best-practice'
    ).length
    if (practiceWarnings > 0) {
      suggestions.push(
        `🟢 改进 ${practiceWarnings} 个最佳实践问题以提高代码质量`
      )
    }

    if (suggestions.length === 0) {
      suggestions.push('🎉 所有检查都通过了！')
    }

    return suggestions
  }

  getLineNumber(content, index) {
    return content.substring(0, index).split('\n').length
  }
}
