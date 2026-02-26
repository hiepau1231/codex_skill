#!/usr/bin/env node

// Runtime guard: Node.js >= 22 required (Codex CLI requirement)
const major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 22) {
  console.error(`Error: Node.js >= 22 required (found ${process.version})`);
  process.exit(1);
}

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');

const skillPackDir = path.join(packageRoot, 'skill-packs', 'codex-review');
const installDir = path.join(os.homedir(), '.claude', 'skills', 'codex-review');
const runnerPath = path.join(installDir, 'scripts', 'codex-runner.js');

const SKILLS = ['codex-plan-review', 'codex-impl-review', 'codex-think-about'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape characters special in double-quoted shell strings: \ " $ ` */
function escapeForDoubleQuotedShell(s) {
  return s.replace(/[\\"$`]/g, '\\$&');
}

/** Recursively copy a directory */
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Build staging directory
// ---------------------------------------------------------------------------

const skillsParent = path.dirname(installDir);
const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const stagingDir = path.join(skillsParent, `.codex-review-staging-${uid}`);

try {
  fs.mkdirSync(stagingDir, { recursive: true });

  // 1. Copy codex-runner.js
  const runnerSrc = path.join(skillPackDir, 'scripts', 'codex-runner.js');
  const runnerDest = path.join(stagingDir, 'scripts', 'codex-runner.js');
  fs.mkdirSync(path.dirname(runnerDest), { recursive: true });
  fs.copyFileSync(runnerSrc, runnerDest);

  // chmod +x on Unix
  if (process.platform !== 'win32') {
    fs.chmodSync(runnerDest, 0o755);
  }

  // 2. Process each skill: inject RUNNER_PATH into SKILL.md, copy references/
  const escapedRunnerPath = escapeForDoubleQuotedShell(runnerPath);

  for (const skill of SKILLS) {
    const skillSrcDir = path.join(skillPackDir, 'skills', skill);
    const skillDestDir = path.join(stagingDir, 'skills', skill);
    fs.mkdirSync(skillDestDir, { recursive: true });

    // Read template SKILL.md, inject runner path
    const templatePath = path.join(skillSrcDir, 'SKILL.md');
    const template = fs.readFileSync(templatePath, 'utf8');
    if (!template.includes('{{RUNNER_PATH}}')) {
      throw new Error(`Template ${skill}/SKILL.md missing {{RUNNER_PATH}} placeholder`);
    }
    const injected = template.replaceAll('{{RUNNER_PATH}}', escapedRunnerPath);
    if (injected.includes('{{RUNNER_PATH}}')) {
      throw new Error(`Template ${skill}/SKILL.md still contains {{RUNNER_PATH}} after injection`);
    }
    fs.writeFileSync(path.join(skillDestDir, 'SKILL.md'), injected, 'utf8');

    // Copy references/ directory (required by all skills)
    const refsSrc = path.join(skillSrcDir, 'references');
    if (!fs.existsSync(refsSrc)) {
      throw new Error(`Missing references/ directory for ${skill}`);
    }
    copyDirSync(refsSrc, path.join(skillDestDir, 'references'));
  }

  // 3. Verify runner works
  console.log('Verifying codex-runner.js ...');
  const runnerTestPath = path.join(stagingDir, 'scripts', 'codex-runner.js');
  const versionOutput = execFileSync(process.execPath, [runnerTestPath, 'version'], {
    encoding: 'utf8',
    timeout: 10_000,
  }).trim();
  console.log(`  codex-runner.js version: ${versionOutput}`);

  // 4. Atomic swap: backup old → move staging → cleanup
  let backupDir = null;
  try {
    if (fs.existsSync(installDir)) {
      backupDir = path.join(skillsParent, `.codex-review-backup-${uid}`);
      fs.renameSync(installDir, backupDir);
    }
    fs.renameSync(stagingDir, installDir);
  } catch (err) {
    // Swap failed → restore backup
    if (backupDir && fs.existsSync(backupDir) && !fs.existsSync(installDir)) {
      fs.renameSync(backupDir, installDir);
    }
    // Cleanup staging if still present
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    throw new Error(`Installation failed: ${err.message}`);
  }

  // Cleanup backup (non-critical — install already succeeded)
  if (backupDir) {
    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch {
      console.warn(`Warning: could not remove backup at ${backupDir}`);
    }
  }

  // 5. Success message
  console.log('');
  console.log('codex-review skills installed successfully!');
  console.log(`  Location: ${installDir}`);
  console.log('');
  console.log('Skills available in Claude Code:');
  console.log('  /codex-plan-review  — debate plans before implementation');
  console.log('  /codex-impl-review  — review uncommitted changes');
  console.log('  /codex-think-about  — peer reasoning/debate');
} catch (err) {
  // Cleanup staging on any error
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  console.error(err.message || err);
  process.exit(1);
}
