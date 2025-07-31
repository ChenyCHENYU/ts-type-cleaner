import { readdirSync, statSync, existsSync } from 'fs'
import { join, relative, extname } from 'path'

/**
 * 高效的文件扫描器
 * @param {string} startDir - 开始扫描的目录
 * @param {string[]} extensions - 文件扩展名数组
 * @param {string[]} exclude - 排除的目录/文件模式
 * @returns {string[]} 匹配的文件路径数组
 */
export function scanFiles(startDir, extensions = ['.ts', '.tsx'], exclude = []) {
  const results = []
  const normalizedExclude = exclude.map(pattern => 
    pattern.startsWith('/') ? pattern.slice(1) : pattern
  )

  function shouldExclude(filePath, fileName) {
    const relativePath = relative(startDir, filePath)
    
    return normalizedExclude.some(pattern => {
      // 支持 glob 模式匹配
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'))
        return regex.test(relativePath) || regex.test(fileName)
      }
      
      // 精确匹配或包含匹配
      return relativePath.includes(pattern) || 
             fileName.includes(pattern) || 
             relativePath.startsWith(pattern)
    })
  }

  function scanDirectory(currentDir) {
    try {
      const items = readdirSync(currentDir, { withFileTypes: true })
      
      for (const item of items) {
        const fullPath = join(currentDir, item.name)
        
        // 检查是否应该排除
        if (shouldExclude(fullPath, item.name)) {
          continue
        }
        
        if (item.isDirectory()) {
          scanDirectory(fullPath)
        } else if (item.isFile()) {
          const fileExt = extname(item.name)
          if (extensions.includes(fileExt)) {
            results.push(fullPath)
          }
        }
      }
    } catch (error) {
      // 忽略权限错误等，继续扫描其他目录
      console.warn(`⚠️ 无法访问目录 ${currentDir}: ${error.message}`)
    }
  }

  if (existsSync(startDir)) {
    scanDirectory(startDir)
  } else {
    console.warn(`⚠️ 起始目录不存在: ${startDir}`)
  }

  return results.sort() // 返回排序后的结果，保证一致性
}

/**
 * 异步版本的文件扫描器
 * @param {string} startDir 
 * @param {string[]} extensions 
 * @param {string[]} exclude 
 * @returns {Promise<string[]>}
 */
export async function scanFilesAsync(startDir, extensions = ['.ts', '.tsx'], exclude = []) {
  return new Promise((resolve) => {
    const result = scanFiles(startDir, extensions, exclude)
    resolve(result)
  })
}

/**
 * 扫描指定模式的文件
 * @param {string[]} patterns - glob 模式数组
 * @param {string} rootDir - 根目录
 * @returns {string[]}
 */
export function scanFilesByPatterns(patterns, rootDir = process.cwd()) {
  const allFiles = new Set()
  
  for (const pattern of patterns) {
    // 简单的 glob 实现
    if (pattern.includes('**')) {
      const [basePath, ...rest] = pattern.split('**')
      const baseDir = join(rootDir, basePath)
      const extensions = extractExtensions(rest.join(''))
      
      const files = scanFiles(baseDir, extensions, ['node_modules', '.git'])
      files.forEach(file => allFiles.add(file))
    } else {
      // 处理简单模式
      const extensions = extractExtensions(pattern)
      const files = scanFiles(rootDir, extensions, ['node_modules', '.git'])
      files.forEach(file => allFiles.add(file))
    }
  }
  
  return Array.from(allFiles).sort()
}

function extractExtensions(pattern) {
  const match = pattern.match(/\{([^}]+)\}/)
  if (match) {
    return match[1].split(',').map(ext => ext.startsWith('.') ? ext : `.${ext}`)
  }
  
  const ext = extname(pattern)
  return ext ? [ext] : ['.ts', '.tsx']
}