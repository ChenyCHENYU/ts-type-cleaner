// lib/core/HtmlReportGenerator.js
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, relative } from 'path'

export class HtmlReportGenerator {
  constructor(options = {}) {
    this.options = {
      outputDir: options.outputDir || './type-reports',
      theme: options.theme || 'modern',
      ...options,
    }
  }

  async generateHtmlReport(analysisResult, validationResult) {
    if (!existsSync(this.options.outputDir)) {
      mkdirSync(this.options.outputDir, { recursive: true })
    }

    const html = this.buildHtmlContent(analysisResult, validationResult)
    const fileName = `type-report-${new Date().toISOString().slice(0, 10)}.html`
    const outputPath = join(this.options.outputDir, fileName)

    writeFileSync(outputPath, html)
    return outputPath
  }

  buildHtmlContent(analysisResult, validationResult) {
    const css = this.getStyleSheet()
    const js = this.getJavaScript()

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TypeScript 类型分析报告</title>
    <style>${css}</style>
</head>
<body>
    <div class="container">
        ${this.buildHeader(analysisResult, validationResult)}
        ${this.buildOverview(analysisResult, validationResult)}
        ${this.buildCharts(analysisResult, validationResult)}
        ${this.buildUnusedTypes(analysisResult)}
        ${this.buildDuplicateTypes(analysisResult)}
        ${this.buildErrors(validationResult)}
        ${this.buildWarnings(validationResult)}
        ${this.buildSuggestions(analysisResult, validationResult)}
        ${this.buildFooter()}
    </div>
    <script>${js}</script>
</body>
</html>`
  }

  buildHeader(analysisResult, validationResult) {
    const timestamp = new Date().toLocaleString('zh-CN')
    const healthScore = analysisResult.healthScore
    const validationScore = validationResult.validationScore

    return `
    <header class="header">
        <div class="header-content">
            <h1>🛠️ TypeScript 类型分析报告</h1>
            <div class="header-meta">
                <span class="timestamp">📅 生成时间: ${timestamp}</span>
                <div class="scores">
                    <div class="score-item">
                        <span class="score-label">健康评分</span>
                        <span class="score-value score-${this.getScoreLevel(
                          healthScore
                        )}">${healthScore}/100</span>
                    </div>
                    <div class="score-item">
                        <span class="score-label">验证评分</span>
                        <span class="score-value score-${this.getScoreLevel(
                          validationScore
                        )}">${validationScore}/100</span>
                    </div>
                </div>
            </div>
        </div>
    </header>`
  }

  buildOverview(analysisResult, validationResult) {
    return `
    <section class="overview">
        <h2>📊 统计概览</h2>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon">📁</div>
                <div class="stat-content">
                    <div class="stat-number">${analysisResult.sourceFiles}</div>
                    <div class="stat-label">源文件数量</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">🎯</div>
                <div class="stat-content">
                    <div class="stat-number">${
                      analysisResult.typeDefinitions
                    }</div>
                    <div class="stat-label">类型定义</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">🔗</div>
                <div class="stat-content">
                    <div class="stat-number">${
                      analysisResult.usageReferences || 0
                    }</div>
                    <div class="stat-label">使用引用</div>
                </div>
            </div>
            <div class="stat-card alert">
                <div class="stat-icon">❌</div>
                <div class="stat-content">
                    <div class="stat-number">${analysisResult.unusedTypes}</div>
                    <div class="stat-label">未使用类型</div>
                </div>
            </div>
            <div class="stat-card warning">
                <div class="stat-icon">⚠️</div>
                <div class="stat-content">
                    <div class="stat-number">${
                      analysisResult.duplicateDefinitions
                    }</div>
                    <div class="stat-label">重复定义</div>
                </div>
            </div>
            <div class="stat-card error">
                <div class="stat-icon">🚨</div>
                <div class="stat-content">
                    <div class="stat-number">${
                      validationResult.errors.length
                    }</div>
                    <div class="stat-label">类型错误</div>
                </div>
            </div>
        </div>
    </section>`
  }

  buildCharts(analysisResult, validationResult) {
    const chartData = {
      healthScore: analysisResult.healthScore,
      validationScore: validationResult.validationScore,
      typeBreakdown: {
        used: analysisResult.typeDefinitions - analysisResult.unusedTypes,
        unused: analysisResult.unusedTypes,
        duplicate: analysisResult.duplicateDefinitions,
      },
      issueBreakdown: {
        errors: validationResult.errors.length,
        warnings: validationResult.warnings.length,
      },
    }

    return `
    <section class="charts">
        <h2>📈 数据可视化</h2>
        <div class="charts-grid">
            <div class="chart-container">
                <h3>健康评分</h3>
                <div class="score-chart">
                    <div class="score-circle" data-score="${
                      analysisResult.healthScore
                    }">
                        <span class="score-text">${
                          analysisResult.healthScore
                        }</span>
                    </div>
                    <div class="score-label">类型系统健康度</div>
                </div>
            </div>
            <div class="chart-container">
                <h3>类型使用分布</h3>
                <div class="pie-chart" id="typeChart" data-chart='${JSON.stringify(
                  chartData.typeBreakdown
                )}'></div>
            </div>
            <div class="chart-container">
                <h3>问题分布</h3>
                <div class="bar-chart" id="issueChart" data-chart='${JSON.stringify(
                  chartData.issueBreakdown
                )}'></div>
            </div>
        </div>
    </section>`
  }

  buildUnusedTypes(analysisResult) {
    if (
      !analysisResult.details?.unusedTypes ||
      analysisResult.details.unusedTypes.length === 0
    ) {
      return '<section class="unused-types"><h2>🗑️ 未使用的类型</h2><p class="no-issues">✨ 没有发现未使用的类型！</p></section>'
    }

    const unusedTypesHtml = analysisResult.details.unusedTypes
      .map((typeName, index) => {
        const typeInfo = analysisResult.details.typeDefinitions[typeName]
        if (!typeInfo) return ''

        return `
      <div class="issue-item" data-severity="warning">
          <div class="issue-header">
              <span class="issue-number">${index + 1}</span>
              <span class="issue-title">${typeName}</span>
              <span class="issue-type">${typeInfo.type}</span>
          </div>
          <div class="issue-details">
              <div class="issue-location">
                  📁 ${relative(process.cwd(), typeInfo.file)}:${typeInfo.line}
              </div>
              <div class="issue-action">
                  <button class="btn-action" onclick="copyToClipboard('${
                    typeInfo.file
                  }:${typeInfo.line}')">
                      📋 复制位置
                  </button>
                  <button class="btn-action btn-danger" onclick="showDeleteConfirm('${typeName}')">
                      🗑️ 标记删除
                  </button>
              </div>
          </div>
      </div>`
      })
      .join('')

    return `
    <section class="unused-types">
        <h2>🗑️ 未使用的类型 (${analysisResult.details.unusedTypes.length})</h2>
        <div class="issues-list">
            ${unusedTypesHtml}
        </div>
    </section>`
  }

  buildDuplicateTypes(analysisResult) {
    if (
      !analysisResult.details?.duplicates ||
      analysisResult.details.duplicates.length === 0
    ) {
      return '<section class="duplicate-types"><h2>🔗 重复的类型定义</h2><p class="no-issues">✨ 没有发现重复的类型定义！</p></section>'
    }

    const duplicatesHtml = analysisResult.details.duplicates
      .map((typeName, index) => {
        return `
      <div class="issue-item" data-severity="warning">
          <div class="issue-header">
              <span class="issue-number">${index + 1}</span>
              <span class="issue-title">${typeName}</span>
              <span class="issue-badge">重复定义</span>
          </div>
          <div class="issue-details">
              <div class="issue-suggestion">
                  💡 建议：选择一个主要位置保留定义，删除其他重复项
              </div>
          </div>
      </div>`
      })
      .join('')

    return `
    <section class="duplicate-types">
        <h2>🔗 重复的类型定义 (${analysisResult.details.duplicates.length})</h2>
        <div class="issues-list">
            ${duplicatesHtml}
        </div>
    </section>`
  }

  buildErrors(validationResult) {
    if (!validationResult.errors || validationResult.errors.length === 0) {
      return '<section class="errors"><h2>🚨 类型错误</h2><p class="no-issues">✨ 没有发现类型错误！</p></section>'
    }

    const errorsHtml = validationResult.errors
      .slice(0, 20)
      .map((error, index) => {
        return `
      <div class="issue-item" data-severity="error">
          <div class="issue-header">
              <span class="issue-number">${index + 1}</span>
              <span class="issue-title">${error.message}</span>
              ${
                error.code
                  ? `<span class="issue-code">${error.code}</span>`
                  : ''
              }
          </div>
          <div class="issue-details">
              <div class="issue-location">
                  📁 ${relative(process.cwd(), error.file)}${
          error.line ? `:${error.line}` : ''
        }${error.column ? `:${error.column}` : ''}
              </div>
              <div class="issue-action">
                  <button class="btn-action" onclick="copyToClipboard('${
                    error.file
                  }${error.line ? `:${error.line}` : ''}')">
                      📋 复制位置
                  </button>
              </div>
          </div>
      </div>`
      })
      .join('')

    const showingCount = Math.min(20, validationResult.errors.length)
    const remainingCount = validationResult.errors.length - showingCount

    return `
    <section class="errors">
        <h2>🚨 类型错误 (${validationResult.errors.length})</h2>
        <div class="issues-list">
            ${errorsHtml}
            ${
              remainingCount > 0
                ? `<div class="more-items">... 还有 ${remainingCount} 个错误</div>`
                : ''
            }
        </div>
    </section>`
  }

  buildWarnings(validationResult) {
    if (!validationResult.warnings || validationResult.warnings.length === 0) {
      return '<section class="warnings"><h2>⚠️ 警告</h2><p class="no-issues">✨ 没有发现警告！</p></section>'
    }

    const warningsHtml = validationResult.warnings
      .slice(0, 15)
      .map((warning, index) => {
        return `
      <div class="issue-item" data-severity="warning">
          <div class="issue-header">
              <span class="issue-number">${index + 1}</span>
              <span class="issue-title">${warning.message}</span>
              <span class="issue-type">${warning.type}</span>
          </div>
          <div class="issue-details">
              <div class="issue-location">
                  📁 ${relative(process.cwd(), warning.file)}${
          warning.line ? `:${warning.line}` : ''
        }
              </div>
          </div>
      </div>`
      })
      .join('')

    return `
    <section class="warnings">
        <h2>⚠️ 警告 (${validationResult.warnings.length})</h2>
        <div class="issues-list">
            ${warningsHtml}
        </div>
    </section>`
  }

  buildSuggestions(analysisResult, validationResult) {
    const allSuggestions = [
      ...(analysisResult.suggestions || []),
      ...(validationResult.suggestions || []),
    ]

    if (allSuggestions.length === 0) {
      return '<section class="suggestions"><h2>💡 改进建议</h2><p class="no-issues">🎉 一切看起来都很好！</p></section>'
    }

    const suggestionsHtml = allSuggestions
      .map(
        (suggestion, index) => `
      <div class="suggestion-item">
          <span class="suggestion-number">${index + 1}</span>
          <span class="suggestion-text">${suggestion}</span>
      </div>
    `
      )
      .join('')

    return `
    <section class="suggestions">
        <h2>💡 改进建议</h2>
        <div class="suggestions-list">
            ${suggestionsHtml}
        </div>
    </section>`
  }

  buildFooter() {
    return `
    <footer class="footer">
        <p>📊 报告由 TypeScript Type Cleaner 生成</p>
        <p>🕒 生成时间: ${new Date().toLocaleString('zh-CN')}</p>
    </footer>`
  }

  getScoreLevel(score) {
    if (score >= 80) return 'good'
    if (score >= 60) return 'warning'
    return 'error'
  }

  getStyleSheet() {
    return `
    * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
    }

    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        line-height: 1.6;
        color: #333;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
    }

    .container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 20px;
    }

    .header {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        border-radius: 15px;
        padding: 30px;
        margin-bottom: 30px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .header h1 {
        font-size: 2.5rem;
        margin-bottom: 20px;
        background: linear-gradient(45deg, #667eea, #764ba2);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
    }

    .header-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 20px;
    }

    .timestamp {
        color: #666;
        font-size: 1.1rem;
    }

    .scores {
        display: flex;
        gap: 20px;
    }

    .score-item {
        text-align: center;
    }

    .score-label {
        display: block;
        font-size: 0.9rem;
        color: #666;
        margin-bottom: 5px;
    }

    .score-value {
        font-size: 1.5rem;
        font-weight: bold;
        padding: 8px 16px;
        border-radius: 20px;
        min-width: 80px;
        display: inline-block;
    }

    .score-good { background: #4CAF50; color: white; }
    .score-warning { background: #FF9800; color: white; }
    .score-error { background: #F44336; color: white; }

    section {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        border-radius: 15px;
        padding: 30px;
        margin-bottom: 30px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    section h2 {
        font-size: 1.8rem;
        margin-bottom: 25px;
        color: #333;
    }

    .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 20px;
    }

    .stat-card {
        background: white;
        border-radius: 12px;
        padding: 25px;
        text-align: center;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        transition: transform 0.3s ease;
        border-left: 4px solid #667eea;
    }

    .stat-card:hover {
        transform: translateY(-5px);
    }

    .stat-card.alert { border-left-color: #F44336; }
    .stat-card.warning { border-left-color: #FF9800; }
    .stat-card.error { border-left-color: #F44336; }

    .stat-icon {
        font-size: 2.5rem;
        margin-bottom: 15px;
    }

    .stat-number {
        font-size: 2rem;
        font-weight: bold;
        color: #333;
        margin-bottom: 5px;
    }

    .stat-label {
        color: #666;
        font-size: 0.9rem;
    }

    .charts-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 30px;
    }

    .chart-container {
        background: white;
        border-radius: 12px;
        padding: 25px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
    }

    .chart-container h3 {
        text-align: center;
        margin-bottom: 20px;
        color: #333;
    }

    .score-chart {
        text-align: center;
    }

    .score-circle {
        width: 120px;
        height: 120px;
        border-radius: 50%;
        background: conic-gradient(from 0deg, #4CAF50 var(--score-angle, 0deg), #e0e0e0 var(--score-angle, 0deg));
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 15px;
        position: relative;
    }

    .score-circle::before {
        content: '';
        width: 80px;
        height: 80px;
        background: white;
        border-radius: 50%;
        position: absolute;
    }

    .score-text {
        font-size: 1.5rem;
        font-weight: bold;
        color: #333;
        position: relative;
        z-index: 1;
    }

    .issues-list {
        space-y: 15px;
    }

    .issue-item {
        background: white;
        border-radius: 8px;
        padding: 20px;
        margin-bottom: 15px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
        border-left: 4px solid #667eea;
        transition: all 0.3s ease;
    }

    .issue-item:hover {
        transform: translateX(5px);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
    }

    .issue-item[data-severity="error"] { border-left-color: #F44336; }
    .issue-item[data-severity="warning"] { border-left-color: #FF9800; }

    .issue-header {
        display: flex;
        align-items: center;
        gap: 15px;
        margin-bottom: 10px;
        flex-wrap: wrap;
    }

    .issue-number {
        background: #667eea;
        color: white;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-size: 0.9rem;
        flex-shrink: 0;
    }

    .issue-title {
        font-weight: 600;
        color: #333;
        flex: 1;
        min-width: 200px;
    }

    .issue-type, .issue-code, .issue-badge {
        background: #f0f0f0;
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 0.8rem;
        color: #666;
    }

    .issue-code {
        background: #e3f2fd;
        color: #1976d2;
        font-family: monospace;
    }

    .issue-details {
        margin-left: 45px;
    }

    .issue-location {
        color: #666;
        font-family: monospace;
        margin-bottom: 10px;
        background: #f8f9fa;
        padding: 8px 12px;
        border-radius: 6px;
        display: inline-block;
    }

    .issue-suggestion {
        color: #4CAF50;
        font-style: italic;
        margin-bottom: 10px;
    }

    .issue-action {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
    }

    .btn-action {
        background: #667eea;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.9rem;
        transition: background 0.3s ease;
    }

    .btn-action:hover { background: #5a6fd8; }
    .btn-danger { background: #F44336; }
    .btn-danger:hover { background: #d32f2f; }

    .suggestions-list { space-y: 10px; }

    .suggestion-item {
        display: flex;
        align-items: flex-start;
        gap: 15px;
        padding: 15px;
        background: white;
        border-radius: 8px;
        margin-bottom: 10px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
    }

    .suggestion-number {
        background: #4CAF50;
        color: white;
        width: 25px;
        height: 25px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-size: 0.8rem;
        flex-shrink: 0;
    }

    .suggestion-text {
        color: #333;
        line-height: 1.5;
    }

    .no-issues {
        text-align: center;
        color: #4CAF50;
        font-size: 1.2rem;
        padding: 40px;
        background: white;
        border-radius: 8px;
    }

    .more-items {
        text-align: center;
        color: #666;
        font-style: italic;
        margin-top: 20px;
        padding: 15px;
        background: #f8f9fa;
        border-radius: 8px;
    }

    .footer {
        text-align: center;
        color: rgba(255, 255, 255, 0.8);
        margin-top: 50px;
    }

    .footer p { margin-bottom: 5px; }

    @media (max-width: 768px) {
        .container { padding: 15px; }
        .header h1 { font-size: 2rem; }
        .header-meta { flex-direction: column; align-items: flex-start; }
        .scores { flex-direction: column; width: 100%; }
        .stats-grid { grid-template-columns: 1fr; }
        .charts-grid { grid-template-columns: 1fr; }
        .issue-header { flex-direction: column; align-items: flex-start; }
        .issue-title { min-width: auto; }
        .issue-details { margin-left: 0; }
    }`
  }

  getJavaScript() {
    return `
    // 初始化页面
    document.addEventListener('DOMContentLoaded', function() {
        initializeCharts();
        initializeScoreCircles();
        setupInteractions();
    });

    // 初始化评分圆圈
    function initializeScoreCircles() {
        document.querySelectorAll('.score-circle').forEach(circle => {
            const score = parseInt(circle.dataset.score);
            const angle = (score / 100) * 360;
            circle.style.setProperty('--score-angle', angle + 'deg');
            
            let color = '#4CAF50';
            if (score < 60) color = '#F44336';
            else if (score < 80) color = '#FF9800';
            
            circle.style.background = \`conic-gradient(from 0deg, \${color} \${angle}deg, #e0e0e0 \${angle}deg)\`;
        });
    }

    // 初始化图表
    function initializeCharts() {
        document.querySelectorAll('.pie-chart').forEach(chart => {
            try {
                const data = JSON.parse(chart.dataset.chart);
                renderPieChart(chart, data);
            } catch (e) {
                console.error('饼图数据解析错误:', e);
            }
        });

        document.querySelectorAll('.bar-chart').forEach(chart => {
            try {
                const data = JSON.parse(chart.dataset.chart);
                renderBarChart(chart, data);
            } catch (e) {
                console.error('柱状图数据解析错误:', e);
            }
        });
    }

    // 渲染饼图
    function renderPieChart(container, data) {
        const total = Object.values(data).reduce((sum, val) => sum + val, 0);
        if (total === 0) {
            container.innerHTML = '<div style="text-align: center; color: #666;">暂无数据</div>';
            return;
        }

        const colors = { used: '#4CAF50', unused: '#F44336', duplicate: '#FF9800' };
        let html = '<div style="display: flex; align-items: center; gap: 20px;">';
        
        html += '<svg width="120" height="120" viewBox="0 0 120 120">';
        let currentAngle = 0;
        Object.entries(data).forEach(([key, value]) => {
            if (value > 0) {
                const percentage = value / total;
                const angle = percentage * 360;
                const x1 = 60 + 50 * Math.cos((currentAngle - 90) * Math.PI / 180);
                const y1 = 60 + 50 * Math.sin((currentAngle - 90) * Math.PI / 180);
                const x2 = 60 + 50 * Math.cos((currentAngle + angle - 90) * Math.PI / 180);
                const y2 = 60 + 50 * Math.sin((currentAngle + angle - 90) * Math.PI / 180);
                
                const largeArcFlag = angle > 180 ? 1 : 0;
                html += \`<path d="M 60 60 L \${x1} \${y1} A 50 50 0 \${largeArcFlag} 1 \${x2} \${y2} Z" fill="\${colors[key] || '#ccc'}" stroke="white" stroke-width="2"></path>\`;
                currentAngle += angle;
            }
        });
        html += '</svg>';
        
        html += '<div>';
        Object.entries(data).forEach(([key, value]) => {
            if (value > 0) {
                const label = key === 'used' ? '已使用' : key === 'unused' ? '未使用' : '重复';
                html += \`<div style="display: flex; align-items: center; margin-bottom: 8px;">
                    <div style="width: 16px; height: 16px; background: \${colors[key]}; margin-right: 8px; border-radius: 2px;"></div>
                    <span>\${label}: \${value}</span>
                </div>\`;
            }
        });
        html += '</div></div>';
        
        container.innerHTML = html;
    }

    // 渲染柱状图
    function renderBarChart(container, data) {
        const maxValue = Math.max(...Object.values(data));
        if (maxValue === 0) {
            container.innerHTML = '<div style="text-align: center; color: #666;">暂无数据</div>';
            return;
        }

        const colors = { errors: '#F44336', warnings: '#FF9800' };
        let html = '<div style="display: flex; align-items: end; gap: 20px; height: 120px;">';
        
        Object.entries(data).forEach(([key, value]) => {
            const height = (value / maxValue) * 100;
            const label = key === 'errors' ? '错误' : '警告';
            
            html += \`<div style="text-align: center; flex: 1;">
                <div style="height: \${height}px; background: \${colors[key]}; margin-bottom: 8px; border-radius: 4px 4px 0 0; transition: all 0.3s ease;" title="\${label}: \${value}"></div>
                <div style="font-size: 0.9rem; color: #666;">\${label}</div>
                <div style="font-weight: bold;">\${value}</div>
            </div>\`;
        });
        
        html += '</div>';
        container.innerHTML = html;
    }

    // 设置交互功能
    function setupInteractions() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth' });
                }
            });
        });

        document.querySelectorAll('.stat-card').forEach(card => {
            card.addEventListener('click', function() {
                this.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    this.style.transform = '';
                }, 150);
            });
        });
    }

    // 复制到剪贴板
    function copyToClipboard(text) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
                showToast('已复制到剪贴板: ' + text);
            });
        } else {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            showToast('已复制到剪贴板: ' + text);
        }
    }

    // 显示删除确认
    function showDeleteConfirm(typeName) {
        const confirmed = confirm(\`确定要标记删除类型 "\${typeName}" 吗?\\n\\n这将在清理脚本中标记此类型待删除。\`);
        if (confirmed) {
            showToast(\`已标记类型 "\${typeName}" 待删除\`);
        }
    }

    // 显示提示消息
    function showToast(message) {
        const toast = document.createElement('div');
        toast.style.cssText = \`
            position: fixed;
            top: 20px;
            right: 20px;
            background: #333;
            color: white;
            padding: 12px 20px;
            border-radius: 6px;
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.3s ease;
        \`;
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '1';
        }, 100);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, 3000);
    }`
  }
}
