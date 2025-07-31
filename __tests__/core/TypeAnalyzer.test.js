const { TypeAnalyzer } = require('../../lib/core/TypeAnalyzer');
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

describe('TypeAnalyzer', () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new TypeAnalyzer();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      expect(analyzer.options.rootDir).toBe(process.cwd());
      expect(analyzer.options.outputDir).toBe('./type-reports');
      expect(analyzer.options.exclude).toEqual(['node_modules', 'dist', '.git']);
      expect(analyzer.options.include).toEqual(['src/**/*.{ts,tsx,vue}']);
      expect(analyzer.options.verbose).toBe(false);
      expect(analyzer.options.strict).toBe(false);
      expect(analyzer.options.skipLibCheck).toBe(true);
    });

    it('should override default options with custom options', () => {
      const customAnalyzer = new TypeAnalyzer({
        rootDir: '/custom/path',
        outputDir: '/custom/reports',
        exclude: ['custom-exclude'],
        include: ['custom-include'],
        verbose: true,
        strict: true,
        skipLibCheck: false,
      });

      expect(customAnalyzer.options.rootDir).toBe('/custom/path');
      expect(customAnalyzer.options.outputDir).toBe('/custom/reports');
      expect(customAnalyzer.options.exclude).toEqual(['custom-exclude']);
      expect(customAnalyzer.options.include).toEqual(['custom-include']);
      expect(customAnalyzer.options.verbose).toBe(true);
      expect(customAnalyzer.options.strict).toBe(true);
      expect(customAnalyzer.options.skipLibCheck).toBe(false);
    });
  });

  describe('analyze', () => {
    it('should complete analysis without errors', async () => {
      await expect(analyzer.analyze()).resolves.not.toThrow();
    });

    it('should handle errors during analysis', async () => {
      jest.spyOn(analyzer, 'initializeTypeScriptProgram').mockRejectedValue(new Error('Mock error'));
      await expect(analyzer.analyze()).rejects.toThrow('Mock error');
    });
  });

  describe('analyzeWithAST', () => {
    it('should process interface declarations', () => {
      const sourceFile = ts.createSourceFile('test.ts', 'interface Test {}', ts.ScriptTarget.Latest);
      analyzer.analyzeWithAST();
      expect(analyzer.typeMap.has('Test')).toBe(true);
    });

    it('should process type alias declarations', () => {
      const sourceFile = ts.createSourceFile('test.ts', 'type Test = string;', ts.ScriptTarget.Latest);
      analyzer.analyzeWithAST();
      expect(analyzer.typeMap.has('Test')).toBe(true);
    });
  });

  describe('analyzeVueFiles', () => {
    it('should skip if no Vue files are found', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      await analyzer.analyzeVueFiles();
      expect(analyzer.vueComponentTypes.size).toBe(0);
    });

    it('should process Vue files with script content', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockReturnValue('<script>interface Test {}</script>');
      await analyzer.analyzeVueFiles();
      expect(analyzer.typeMap.has('Test')).toBe(true);
    });
  });

  describe('runSemanticAnalysis', () => {
    it('should capture semantic errors', async () => {
      jest.spyOn(analyzer.program, 'getSemanticDiagnostics').mockReturnValue([
        { category: ts.DiagnosticCategory.Error, code: 2322, messageText: 'Type error' },
      ]);
      await analyzer.runSemanticAnalysis();
      expect(analyzer.errors.length).toBe(1);
    });
  });

  describe('runCodeQualityCheck', () => {
    it('should detect any type usage', async () => {
      const sourceFile = ts.createSourceFile('test.ts', 'let test: any;', ts.ScriptTarget.Latest);
      jest.spyOn(analyzer.program, 'getSourceFiles').mockReturnValue([sourceFile]);
      await analyzer.runCodeQualityCheck();
      expect(analyzer.warnings.some(w => w.message.includes('any 类型'))).toBe(true);
    });
  });

  describe('generateReport', () => {
    it('should generate a report with statistics', () => {
      analyzer.typeMap.set('Test', { type: 'interface', file: 'test.ts', line: 1, exported: true });
      const report = analyzer.generateReport();
      expect(report.statistics.typeDefinitions).toBe(1);
    });
  });
});