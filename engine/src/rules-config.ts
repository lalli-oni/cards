#!/usr/bin/env bun
/**
 * Extracts [var:id:value] declarations from rules markdown into JSON config.
 *
 * Usage:
 *   bun engine/src/rules-config.ts
 *
 * Output goes to rules/build/baseline.json
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const RULES_DIR = resolve(import.meta.dir, "../../rules");
const BUILD_DIR = join(RULES_DIR, "build");

// --- Types ---

type ConfigValue = number | string | boolean;

interface VarDeclaration {
  id: string;
  value: ConfigValue;
  file: string;
  line: number;
}

interface TBDVar {
  id: string;
  file: string;
  line: number;
}

interface BuildResult {
  config: Record<string, ConfigValue>;
  warnings: string[];
  errors: string[];
}

// --- Parsing ---

const VAR_PATTERN = /\[var:([^\]]+)\]/g;

export function parseVarValue(raw: string): ConfigValue {
  const num = Number(raw);
  if (!Number.isNaN(num) && raw.trim() !== "") return num;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

export function extractVars(
  markdown: string,
  filePath: string,
): { vars: VarDeclaration[]; tbdVars: TBDVar[] } {
  const vars: VarDeclaration[] = [];
  const tbdVars: TBDVar[] = [];
  const lines = markdown.split("\n");

  for (let i = 0; i < lines.length; i++) {
    let match: RegExpExecArray | null;
    const linePattern = new RegExp(VAR_PATTERN.source, "g");
    while ((match = linePattern.exec(lines[i])) !== null) {
      const content = match[1];
      const parts = content.split(":");
      if (parts.length >= 2 && parts[1] !== "") {
        const id = parts[0];
        const rawValue = parts.slice(1).join(":");
        vars.push({
          id,
          value: parseVarValue(rawValue),
          file: filePath,
          line: i + 1,
        });
      } else {
        tbdVars.push({ id: parts[0], file: filePath, line: i + 1 });
      }
    }
  }

  return { vars, tbdVars };
}

// Non-rule markdown files that should not be scanned for var declarations.
const EXCLUDED = new Set([
  "CLAUDE.md",
  "design-principles.md",
  "open-questions.md",
]);

export function buildBaselineConfig(rulesDir: string): BuildResult {
  const config: Record<string, ConfigValue> = {};
  const warnings: string[] = [];
  const errors: string[] = [];
  const seen = new Map<
    string,
    { value: ConfigValue; file: string; line: number }
  >();

  const files = readdirSync(rulesDir)
    .filter((f) => f.endsWith(".md") && !EXCLUDED.has(f))
    .sort();

  for (const file of files) {
    const filePath = join(rulesDir, file);
    const content = readFileSync(filePath, "utf-8");
    const { vars, tbdVars } = extractVars(content, file);

    for (const tbd of tbdVars) {
      warnings.push(
        `TBD var [var:${tbd.id}] at ${tbd.file}:${tbd.line} — excluded from output`,
      );
    }

    for (const v of vars) {
      const existing = seen.get(v.id);
      if (existing) {
        if (existing.value !== v.value) {
          errors.push(
            `Conflicting values for "${v.id}": ${JSON.stringify(existing.value)} (${existing.file}:${existing.line}) vs ${JSON.stringify(v.value)} (${v.file}:${v.line})`,
          );
        }
        // Same ID + same value = OK, skip duplicate
      } else {
        seen.set(v.id, { value: v.value, file: v.file, line: v.line });
        config[v.id] = v.value;
      }
    }
  }

  return { config, warnings, errors };
}

export function mergeVariant(
  baseline: Record<string, ConfigValue>,
  overrides: Record<string, ConfigValue>,
  knownIds: Set<string>,
): { config: Record<string, ConfigValue>; warnings: string[] } {
  const warnings: string[] = [];
  const config = { ...baseline };

  for (const [key, value] of Object.entries(overrides)) {
    if (!knownIds.has(key)) {
      warnings.push(`Unknown variant key "${key}" — not in baseline config`);
    }
    config[key] = value;
  }

  return { config, warnings };
}

// --- Main ---

function main() {
  const { config, warnings, errors } = buildBaselineConfig(RULES_DIR);

  for (const w of warnings) {
    console.warn(`  warn: ${w}`);
  }

  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s):`);
    for (const e of errors) {
      console.error(`  ${e}`);
    }
    process.exit(1);
  }

  mkdirSync(BUILD_DIR, { recursive: true });
  const outPath = join(BUILD_DIR, "baseline.json");
  writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`);

  const keys = Object.keys(config);
  console.log(`\nDone. ${keys.length} config keys written to ${outPath}`);
}

if (import.meta.main) {
  main();
}
