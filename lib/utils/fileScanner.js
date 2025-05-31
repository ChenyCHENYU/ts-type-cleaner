import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, extname } from 'path'

export function scanFiles(
  baseDir,
  includeExtensions = ['.ts', '.vue', '.js'],
  excludeDirs = ['node_modules', 'dist', '.git']
) {
  const results = []

  function walkDir(currentDir) {
    try {
      const items = readdirSync(currentDir)

      for (const item of items) {
        const fullPath = join(currentDir, item)
        const relativePath = relative(baseDir, fullPath)

        if (excludeDirs.some(excludeDir => relativePath.includes(excludeDir))) {
          continue
        }

        try {
          const stat = statSync(fullPath)

          if (stat.isDirectory()) {
            walkDir(fullPath)
          } else if (stat.isFile()) {
            const ext = extname(fullPath)
            if (includeExtensions.includes(ext)) {
              results.push(fullPath)
            }
          }
        } catch (error) {
          // 忽略无法读取的文件
        }
      }
    } catch (error) {
      // 忽略无法读取的目录
    }
  }

  if (existsSync(baseDir)) {
    walkDir(baseDir)
  }

  return results
}
