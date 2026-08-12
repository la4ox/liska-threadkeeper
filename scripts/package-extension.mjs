#!/usr/bin/env node

/**
 * Build a Chrome-loadable ZIP from dist/ without requiring Unix shell syntax.
 *
 * The archive is produced with tools already present on supported developer
 * machines: bsdtar on Windows and zip on macOS/Linux. Files that belong only
 * to the Vite build process are copied out before archiving, so both backends
 * receive exactly the same tree.
 */

import { spawnSync } from 'child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { isExcluded } from './lib/build-compare.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');

/** @param {string} root */
export function readReleaseVersion(root = ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8'));

  if (typeof pkg.version !== 'string' || typeof manifest.version !== 'string') {
    throw new Error('package.json and src/manifest.json must contain string versions');
  }
  if (pkg.version !== manifest.version) {
    throw new Error(
      `version mismatch: package.json=${pkg.version}, src/manifest.json=${manifest.version}`
    );
  }
  return pkg.version;
}

/** @param {string} version */
export function archiveName(version) {
  const components = version.split('.');
  const validComponents =
    components.length >= 1 &&
    components.length <= 4 &&
    components.every(component => {
      if (!/^(?:0|[1-9]\d*)$/.test(component)) return false;
      return Number(component) <= 65_535;
    });
  const allZero = validComponents && components.every(component => component === '0');

  if (!validComponents || allZero) {
    throw new Error(`unsupported Chrome extension version: ${version}`);
  }
  return `liska-threadkeeper-${version}.zip`;
}

/**
 * Copy dist/ into a temporary clean tree, excluding Vite internals and OS
 * metadata. cpSync's filter receives absolute paths, so normalize relative to
 * the source before applying the shared packaging exclusion rule.
 *
 * @param {string} source
 * @param {string} target
 */
export function stageExtension(source, target) {
  cpSync(source, target, {
    recursive: true,
    filter(path) {
      if (path === source) return true;
      const relative = path.slice(source.length + 1).replace(/\\/g, '/');
      return !isExcluded(relative);
    },
  });
}

/** @param {string} command @param {string[]} args @param {string} cwd */
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) {
    throw new Error(`could not start ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

/**
 * @param {{ root?: string, platform?: NodeJS.Platform }} [options]
 * @returns {string} absolute archive path
 */
export function packageExtension(options = {}) {
  const root = resolve(options.root ?? ROOT);
  const platform = options.platform ?? process.platform;
  const dist = join(root, 'dist');

  if (!existsSync(dist) || !statSync(dist).isDirectory()) {
    throw new Error(`dist directory not found: ${dist}; run npm run build first`);
  }

  const version = readReleaseVersion(root);
  const output = join(root, archiveName(version));
  const temp = mkdtempSync(join(tmpdir(), 'liska-package-'));
  const staged = join(temp, 'extension');

  try {
    stageExtension(dist, staged);
    rmSync(output, { force: true });

    if (platform === 'win32') {
      run('tar.exe', ['-a', '-c', '-f', output, '.'], staged);
    } else {
      run('zip', ['-q', '-r', output, '.'], staged);
    }

    console.log(`Created ${basename(output)}`);
    return output;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    packageExtension();
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
