#!/usr/bin/env node

/**
 * compare-build — verify a local build matches a published release ZIP.
 *
 * Compares *file contents* (sorted per-file SHA-256), NOT the ZIP container,
 * because `zip -r` records entry order / timestamps / perms that differ across
 * machines even when the built files are identical. See
 * docs/build-reproducibility.md.
 *
 * Usage:
 *   node scripts/compare-build.mjs                 # build locally, compare vs release v<pkg version>
 *   node scripts/compare-build.mjs --tag v1.2.16   # compare vs a specific release tag
 *   node scripts/compare-build.mjs --ci-zip a.zip  # compare vs an already-downloaded zip
 *   node scripts/compare-build.mjs --twice         # build twice locally, check determinism
 *   node scripts/compare-build.mjs --keep          # keep temp dirs for inspection
 *
 * Exit code: 0 when identical, 1 when builds differ, 2 on operational error.
 */

import { execFileSync } from 'child_process';
import console from 'node:console';
import process from 'node:process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  buildManifest,
  diffManifests,
  formatReport,
  isExcluded,
  releaseRepository,
  releaseAsset,
} from './lib/build-compare.mjs';
import {
  admitArchive,
  downloadReleaseAsset,
  extractZipManifest,
} from './lib/build-compare-zip.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist');

/**
 * Parse argv into options.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const opts = { twice: false, keep: false, tag: null, ciZip: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--twice') opts.twice = true;
    else if (arg === '--keep') opts.keep = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--tag') {
      opts.tag = argv[++i];
      if (!opts.tag) die('--tag requires a value');
    } else if (arg === '--ci-zip') {
      opts.ciZip = argv[++i];
      if (!opts.ciZip) die('--ci-zip requires a value');
    } else die(`Unknown argument: ${arg}`);
  }
  return opts;
}

/** @param {string} msg */
function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(2);
}

/** @param {string} cmd @param {string[]} args @param {string} cwd */
function run(cmd, args, cwd = ROOT) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

/** Read product version and release authority from package.json. */
function readPackage() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
}

/** @returns {string} short HEAD sha, or 'unknown' */
function headSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
  } catch {
    return 'unknown';
  }
}

/** Build the extension into dist/ exactly as the release pipeline does. */
function buildLocal() {
  console.log('▶ building locally (npm run build)…');
  if (process.platform === 'win32') {
    // A .cmd shim cannot be launched through execFileSync on Windows. Prefer
    // npm's current JS entry point when this script is reached through
    // `npm run`; retain a direct-invocation fallback for maintainers.
    if (process.env.npm_execpath) {
      run(process.execPath, [process.env.npm_execpath, 'run', 'build']);
    } else {
      run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm run build']);
    }
    return;
  }
  run('npm', ['run', 'build']);
}

const tempDirs = [];
/** @param {string} prefix */
function makeTemp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/**
 * Remove all temp dirs created this run (best effort).
 * @param {boolean} keep when true, retain dirs and print their paths instead
 */
function cleanup(keep) {
  if (keep && tempDirs.length > 0) {
    console.log(`\nkept temp dirs:\n  ${tempDirs.join('\n  ')}`);
    return;
  }
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort — the OS reclaims /tmp eventually
    }
  }
}

/**
 * Download the release ZIP for a tag into a temp dir and return its path.
 * @param {string} tag
 * @returns {string} path to the downloaded .zip
 */
export async function downloadReleaseZip(tag) {
  const repository = releaseRepository(readPackage());
  console.log(`▶ downloading release ZIP for ${tag} via gh…`);
  let asset;
  try {
    const metadata = execFileSync(
      'gh',
      ['release', 'view', tag, '--repo', repository, '--json', 'assets'],
      {
        cwd: ROOT,
        maxBuffer: 1024 * 1024,
        timeout: 30_000,
      }
    );
    asset = releaseAsset(JSON.parse(metadata.toString('utf8')), repository);
  } catch (error) {
    throw new Error(`release ZIP metadata admission failed for '${tag}': ${error.message}`, {
      cause: error,
    });
  }
  const dir = makeTemp('liska-release-');
  const zipPath = join(dir, asset.name);
  try {
    await downloadReleaseAsset(asset, zipPath, { cwd: ROOT });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  const files = readdirSync(dir);
  if (files.length !== 1 || files[0] !== asset.name) {
    throw new Error(`downloaded ZIP basename does not match release metadata`);
  }
  if ((await admitArchive(zipPath)) !== asset.size) {
    throw new Error('downloaded ZIP size does not match release metadata');
  }
  return zipPath;
}

/** Local-vs-local determinism check. */
export async function runTwice({ build = buildLocal, dist = DIST } = {}) {
  build();
  const first = await buildManifest(dist);
  build();
  const second = await buildManifest(dist);
  const diff = diffManifests(first, second);
  console.log('\n' + formatReport(diff, { localLabel: 'build #1', ciLabel: 'build #2' }));
  if (!diff.identical) {
    console.log(
      '\nLocal build is NON-deterministic on this machine (see Vite issues #13071/#13672).'
    );
  }
  return diff;
}

/**
 * Local-vs-CI content comparison.
 * @param {{ tag: string | null, ciZip: string | null }} opts
 */
async function runCompare(opts) {
  buildLocal();
  const localManifest = await buildManifest(DIST);

  const zipPath = opts.ciZip
    ? resolve(opts.ciZip)
    : await downloadReleaseZip(opts.tag ?? `v${readPackage().version}`);
  const ciDir = join(makeTemp('liska-extract-'), 'contents');
  const ciManifest = await extractZipManifest(zipPath, ciDir, { isExcluded });

  const diff = diffManifests(localManifest, ciManifest);
  console.log(`\nlocal HEAD: ${headSha()}  (ensure it matches the release tag's commit)`);
  console.log(formatReport(diff));
  if (!diff.identical) {
    console.log(`\nInvestigate with:\n  diffoscope ${DIST} ${ciDir}`);
    console.log('(re-run with --keep to retain the extracted CI dir for diffoscope)');
  }
  return diff;
}

function printHelp() {
  console.log(
    [
      'compare-build — verify a local build matches a published release ZIP',
      '',
      'Usage:',
      '  compare-build                 compare local build vs release v<package.json version>',
      '  compare-build --tag <tag>     compare vs a specific release tag',
      '  compare-build --ci-zip <path> compare vs an already-downloaded zip',
      '  compare-build --twice         build twice locally, check determinism',
      '  compare-build --keep          keep temp dirs for diffoscope inspection',
    ].join('\n')
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  try {
    const diff = await (opts.twice ? runTwice() : runCompare(opts));
    cleanup(opts.keep);
    process.exit(diff.identical ? 0 : 1);
  } catch (err) {
    // Any operational failure (build, download, extract, FS) → exit 2,
    // distinct from "builds differ" (exit 1). Always discard temp dirs.
    cleanup(false);
    die(err instanceof Error ? err.message : String(err));
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
