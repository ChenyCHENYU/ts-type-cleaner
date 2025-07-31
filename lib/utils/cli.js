/*
 * @Author: ChenYu ycyplus@gmail.com
 * @Date: 2025-07-31 13:39:17
 * @LastEditors: ChenYu ycyplus@gmail.com
 * @LastEditTime: 2025-07-31 16:38:50
 * @FilePath: \ts-type-cleaner\lib\utils\cli.js
 * @Description:
 * Copyright (c) 2025 by CHENY, All Rights Reserved 😎.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import chalk from "chalk";

export function mergeConfig(globalOptions, commandOptions) {
  const defaultConfig = {
    rootDir: process.cwd(),
    outputDir: "./type-reports",
    verbose: false,
    strict: false,
    include: ["src/**/*.{ts,tsx,vue}"],
    exclude: ["node_modules", "dist", ".git", "**/*.d.ts"],
    threshold: 70,
    colorize: true,
  };

  let configFromFile = {};

  // 尝试加载配置文件
  const configPath = globalOptions.config || ".ts-type-cleaner.json";
  if (existsSync(configPath)) {
    try {
      configFromFile = JSON.parse(readFileSync(configPath, "utf8"));
    } catch (error) {
      if (globalOptions.verbose) {
        console.warn(
          chalk.yellow(`⚠️ 无法加载配置文件 ${configPath}: ${error.message}`)
        );
      }
    }
  }

  return {
    ...defaultConfig,
    ...configFromFile,
    ...globalOptions,
    ...commandOptions,
    colorize: !globalOptions.noColor,
    include: parsePatterns(
      commandOptions.include || configFromFile.include || defaultConfig.include
    ),
    exclude: parsePatterns(
      commandOptions.exclude || configFromFile.exclude || defaultConfig.exclude
    ),
  };
}

export function validateConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config.rootDir) {
    errors.push("rootDir 是必需的");
  }

  if (config.rootDir && !existsSync(config.rootDir)) {
    errors.push(`rootDir 路径不存在: ${config.rootDir}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function createConfig(force = false) {
  const configPath = join(process.cwd(), ".ts-type-cleaner.json");

  if (existsSync(configPath) && !force) {
    throw new Error("配置文件已存在，使用 --force 强制覆盖");
  }

  const defaultConfig = {
    rootDir: "./",
    outputDir: "./type-reports",
    verbose: false,
    strict: false,
    include: ["src/**/*.{ts,tsx,vue}"],
    exclude: ["node_modules", "dist", ".git", "**/*.d.ts"],
    threshold: 70,
    ignoreVueComponentTypes: true,
    ignorePatterns: ["^Props$", "^Emits$", "/Props$/", "/Events?$/"],
  };

  writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
  return configPath;
}

function parsePatterns(patterns) {
  if (typeof patterns === "string") {
    return patterns.split(",").map((p) => p.trim());
  }
  return Array.isArray(patterns) ? patterns : [patterns];
}
