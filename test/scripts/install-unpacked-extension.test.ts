import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, '../../scripts/install-unpacked-extension.ps1');
const probe = spawnSync(
  'pwsh',
  ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'],
  {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  }
);
const hasPowerShell = probe.status === 0 && Number(probe.stdout.trim()) >= 7;
const temporary: string[] = [];

interface Receipt {
  schema: string;
  installStatus: string;
  fileCount: number;
  byteLength: number;
  sourceSha256: string | null;
  installedSha256: string | null;
  manifestSha256: string | null;
  rollbackLeaf: string | null;
  reloadRequired: boolean;
  restartRequested: boolean;
  restartResult: string;
  oldMainPid: number | null;
  newMainPid: number | null;
  errorCode: string | null;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'liska-installer-'));
  temporary.push(root);
  const source = join(root, 'source', 'dist');
  const target = join(root, 'installed', 'dist');
  const rollback = join(root, 'rollbacks');
  for (const directory of [source, target]) mkdirSync(directory, { recursive: true });
  dist(source, 'new');
  dist(target, 'old');
  writeFileSync(join(target, 'stale.js'), 'old stale payload');
  return { root, source, target, rollback };
}

function dist(directory: string, generation: string) {
  writeFileSync(
    join(directory, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Liska — AI Threadkeeper',
      version: generation === 'old' ? '2.0.0' : '3.0.0',
      background: { service_worker: 'worker.js', type: 'module' },
      action: { default_popup: 'popup.html' },
    })
  );
  writeFileSync(join(directory, 'worker.js'), `export const generation = '${generation}';`);
  writeFileSync(join(directory, 'popup.html'), `<!doctype html><title>${generation}</title>`);
  mkdirSync(join(directory, 'assets'), { recursive: true });
  writeFileSync(join(directory, 'assets', 'payload.bin'), Buffer.from([0, 1, 2, 255]));
}

function inventory(root: string): Record<string, { bytes: number; sha256: string }> {
  const result: Record<string, { bytes: number; sha256: string }> = {};
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else {
        const bytes = readFileSync(path);
        result[relative(root, path).replaceAll('\\', '/')] = {
          bytes: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
      }
    }
  }
  visit(root);
  return result;
}

function run(
  paths: ReturnType<typeof fixture>,
  flags: string[] = [],
  runner = script,
  skipBuild = true
) {
  const result = spawnSync(
    'pwsh',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-File',
      runner,
      '-TargetDist',
      paths.target,
      '-SourceDist',
      paths.source,
      '-RollbackRoot',
      paths.rollback,
      ...(skipBuild ? ['-SkipBuild'] : []),
      ...flags,
    ],
    { encoding: 'utf8', timeout: 20000, windowsHide: true }
  );
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe('');
  const receipt = JSON.parse(result.stdout.trim()) as Receipt;
  expect(receipt.schema).toBe('liska-unpacked-install/1');
  expect(result.stdout).not.toContain(paths.root);
  expect(result.stdout).not.toContain('old stale payload');
  return { ...result, receipt };
}

function mockedComet(paths: ReturnType<typeof fixture>, closes: boolean) {
  const wrapper = join(paths.root, 'mock-comet.ps1');
  const executable = join(paths.root, 'comet.exe');
  const evidence = join(paths.root, 'process-evidence.json');
  writeFileSync(executable, 'never execute this fixture');
  writeFileSync(
    wrapper,
    `param([string]$TargetDist,[string]$SourceDist,[string]$RollbackRoot,[switch]$SkipBuild,[switch]$RestartComet,[string]$CometExecutable,[int]$GracefulTimeoutSeconds=1,[switch]$ForceCloseAfterTimeout)
$global:liskaClosed = $false
$global:liskaLaunched = $false
$global:liskaStopped = [Collections.Generic.List[int]]::new()
$global:liskaEvents = [Collections.Generic.List[string]]::new()
$global:liskaExact = $CometExecutable
$global:liskaOther = [IO.Path]::Combine([IO.Path]::GetDirectoryName($CometExecutable), 'unrelated', 'comet.exe')
$main = [pscustomobject]@{ Id=101; Path=$CometExecutable; MainWindowHandle=123 }
$main | Add-Member -MemberType ScriptMethod -Name CloseMainWindow -Value {
  $global:liskaEvents.Add('close-main')
  $global:liskaClosed = $${closes ? 'true' : 'false'}
  return $true
}
$global:liskaMain = $main
function Get-Process {
  param([string]$Name,[int]$Id)
  $rows = @()
  if (-not $global:liskaClosed) {
    $rows += $global:liskaMain
    $rows += [pscustomobject]@{ Id=102; Path=$global:liskaExact; MainWindowHandle=0 }
  }
  $rows += [pscustomobject]@{ Id=201; Path=$global:liskaOther; MainWindowHandle=456 }
  if ($global:liskaLaunched) { $rows += [pscustomobject]@{ Id=301; Path=$global:liskaExact; MainWindowHandle=789 } }
  if ($Id) { return $rows | Where-Object Id -EQ $Id }
  return $rows
}
function Stop-Process {
  param($InputObject,[switch]$Force)
  if ($InputObject.Path -cne $global:liskaExact) { throw 'foreign process stop attempted' }
  $global:liskaStopped.Add($InputObject.Id)
  if ($global:liskaStopped.Count -eq 2) { $global:liskaClosed = $true }
}
function Start-Process {
  param([string]$FilePath,[string[]]$ArgumentList,[switch]$PassThru)
  if ($FilePath -cne $global:liskaExact -or $ArgumentList.Count -ne 1 -or $ArgumentList[0] -cne '--restore-last-session') { throw 'invalid launch' }
  $global:liskaLaunched = $true
  $global:liskaEvents.Add('launch')
  return [pscustomobject]@{ Id=301 }
}
& '${script.replaceAll("'", "''")}' @PSBoundParameters
$result = $LASTEXITCODE
[IO.File]::WriteAllText('${evidence.replaceAll("'", "''")}', (ConvertTo-Json @{ Events=@($global:liskaEvents.ToArray()); Stopped=@($global:liskaStopped.ToArray()); Launched=$global:liskaLaunched } -Compress))
exit $result
`
  );
  return { wrapper, executable, evidence };
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!hasPowerShell)('unpacked extension installer (PowerShell 7 required)', () => {
  it('parses through the actual PowerShell parser', () => {
    const paths = fixture();
    const parser = join(paths.root, 'parse.ps1');
    writeFileSync(
      parser,
      `param([string]$ScriptPath)
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { exit 1 }
Write-Output $ast.ParamBlock.Parameters.Count
`
    );
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', parser, script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(Number(result.stdout.trim())).toBe(10);
  });

  it('plans with exact inventory facts and no build, file or process mutation', () => {
    const paths = fixture();
    const before = inventory(paths.root);
    const result = run(paths, ['-PlanOnly'], script, false);
    expect(result.status).toBe(0);
    expect(result.receipt).toMatchObject({
      installStatus: 'planned',
      fileCount: 4,
      byteLength: Object.values(inventory(paths.source)).reduce((sum, file) => sum + file.bytes, 0),
      installedSha256: null,
      rollbackLeaf: null,
      reloadRequired: true,
      restartResult: 'not-requested',
      oldMainPid: null,
      newMainPid: null,
      errorCode: null,
    });
    expect(result.receipt.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(inventory(paths.root)).toEqual(before);
    expect(existsSync(paths.rollback)).toBe(false);
  });

  it('swaps the exact file set, removes stale installed files, and preserves old rollback bytes', () => {
    const paths = fixture();
    mkdirSync(paths.rollback);
    mkdirSync(join(paths.rollback, 'prior-rollback'));
    writeFileSync(join(paths.rollback, 'prior-rollback', 'keep.bin'), 'keep forever');
    const old = inventory(paths.target);
    const source = inventory(paths.source);
    const result = run(paths);
    expect(result.status).toBe(0);
    expect(result.receipt).toMatchObject({
      installStatus: 'installed',
      fileCount: 4,
      reloadRequired: true,
      restartRequested: false,
      restartResult: 'not-requested',
      errorCode: null,
    });
    expect(result.receipt.installedSha256).toBe(result.receipt.sourceSha256);
    expect(result.receipt.manifestSha256).toBe(source['manifest.json'].sha256);
    expect(result.receipt.rollbackLeaf).toMatch(/^liska-rollback-\d{8}T\d{9}Z-[a-f0-9]{32}$/);
    expect(inventory(paths.target)).toEqual(source);
    expect(inventory(join(paths.rollback, result.receipt.rollbackLeaf!))).toEqual(old);
    expect(readFileSync(join(paths.rollback, 'prior-rollback', 'keep.bin'), 'utf8')).toBe(
      'keep forever'
    );
    expect(readdirSync(dirname(paths.target))).toEqual(['dist']);
  });

  it('supports an explicit first deployment only when the target parent exists', () => {
    const paths = fixture();
    rmSync(paths.target, { recursive: true });
    const result = run(paths);
    expect(result.status).toBe(0);
    expect(result.receipt.installStatus).toBe('installed');
    expect(result.receipt.rollbackLeaf).toBeNull();
    expect(existsSync(paths.rollback)).toBe(false);
    expect(inventory(paths.target)).toEqual(inventory(paths.source));
  });

  it('resolves the localized Liska manifest name before accepting an update', () => {
    const paths = fixture();
    const manifestPath = join(paths.source, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.name = '__MSG_extName__';
    manifest.default_locale = 'en';
    mkdirSync(join(paths.source, '_locales', 'en'), { recursive: true });
    writeFileSync(
      join(paths.source, '_locales', 'en', 'messages.json'),
      JSON.stringify({ extName: { message: 'Liska — AI Threadkeeper' } })
    );
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(run(paths).receipt.installStatus).toBe('installed');
    expect(inventory(paths.target)).toEqual(inventory(paths.source));
  });

  it.each([
    [
      'manifest identity',
      (paths: ReturnType<typeof fixture>) => {
        const file = join(paths.source, 'manifest.json');
        const manifest = JSON.parse(readFileSync(file, 'utf8'));
        manifest.name = 'A different extension';
        writeFileSync(file, JSON.stringify(manifest));
      },
      'manifest-identity-mismatch',
    ],
    [
      'missing worker',
      (paths: ReturnType<typeof fixture>) => rmSync(join(paths.source, 'worker.js')),
      'manifest-entry-invalid',
    ],
    [
      'worker entry that is a directory',
      (paths: ReturnType<typeof fixture>) => {
        const path = join(paths.source, 'worker.js');
        rmSync(path);
        mkdirSync(path);
      },
      'manifest-entry-invalid',
    ],
    [
      'popup entry that is a directory',
      (paths: ReturnType<typeof fixture>) => {
        const path = join(paths.source, 'popup.html');
        rmSync(path);
        mkdirSync(path);
      },
      'manifest-entry-invalid',
    ],
    [
      'duplicate manifest keys',
      (paths: ReturnType<typeof fixture>) =>
        writeFileSync(join(paths.source, 'manifest.json'), '{"name":"one","name":"two"}'),
      'manifest-invalid',
    ],
    [
      'escaping worker',
      (paths: ReturnType<typeof fixture>) => {
        const file = join(paths.source, 'manifest.json');
        const manifest = JSON.parse(readFileSync(file, 'utf8'));
        manifest.background.service_worker = '../worker.js';
        writeFileSync(file, JSON.stringify(manifest));
      },
      'manifest-entry-invalid',
    ],
    [
      'changed extension key',
      (paths: ReturnType<typeof fixture>) => {
        const file = join(paths.source, 'manifest.json');
        const manifest = JSON.parse(readFileSync(file, 'utf8'));
        manifest.key = 'different-persistent-identity';
        writeFileSync(file, JSON.stringify(manifest));
      },
      'manifest-identity-mismatch',
    ],
  ] as const)('rejects %s before touching the installed target', (_name, change, errorCode) => {
    const paths = fixture();
    const before = inventory(paths.target);
    change(paths);
    const result = run(paths);
    expect(result.status).toBe(1);
    expect(result.receipt.errorCode).toBe(errorCode);
    expect(inventory(paths.target)).toEqual(before);
    expect(existsSync(paths.rollback)).toBe(false);
    expect(readdirSync(dirname(paths.target))).toEqual(['dist']);
  });

  it('rejects relative targets, overlap, and a missing parent before staging', () => {
    for (const invalid of ['relative/dist', 'source-overlap', 'missing-parent']) {
      const paths = fixture();
      if (invalid === 'relative/dist') paths.target = invalid;
      if (invalid === 'source-overlap') paths.target = paths.source;
      if (invalid === 'missing-parent') paths.target = join(paths.root, 'missing', 'dist');
      const before = inventory(paths.root);
      const result = run(paths);
      expect(result.status).toBe(1);
      expect(result.receipt.errorCode).toBe(
        {
          'relative/dist': 'absolute-path-required',
          'source-overlap': 'source-target-overlap',
          'missing-parent': 'target-parent-missing',
        }[invalid]
      );
      expect(inventory(paths.root)).toEqual(before);
    }
  });

  it('rejects symlink/reparse descendants before touching the installed target', context => {
    const paths = fixture();
    const elsewhere = join(paths.root, 'elsewhere');
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, 'payload'), 'must not traverse');
    try {
      symlinkSync(
        elsewhere,
        join(paths.source, 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
    } catch {
      context.skip();
      return;
    }
    expect(lstatSync(join(paths.source, 'linked')).isSymbolicLink()).toBe(true);
    const before = inventory(paths.target);
    const result = run(paths);
    expect(result.status).toBe(1);
    expect(result.receipt.errorCode).toBe('reparse-path-rejected');
    expect(inventory(paths.target)).toEqual(before);
    expect(existsSync(paths.rollback)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects case-colliding paths on a case-sensitive filesystem',
    () => {
      const paths = fixture();
      writeFileSync(join(paths.source, 'Duplicate.js'), 'one');
      writeFileSync(join(paths.source, 'duplicate.js'), 'two');
      const result = run(paths);
      expect(result.status).toBe(1);
      expect(result.receipt.errorCode).toBe('ambiguous-inventory');
      expect(existsSync(paths.rollback)).toBe(false);
    }
  );

  it('restores old bytes when the stage-to-target move fails', () => {
    const paths = fixture();
    const wrapper = join(paths.root, 'fail-swap.ps1');
    writeFileSync(
      wrapper,
      `param([string]$TargetDist,[string]$SourceDist,[string]$RollbackRoot,[switch]$SkipBuild)
$global:liskaTestMoveCalls = 0
function Move-Item {
  [CmdletBinding()] param([string]$LiteralPath,[string]$Destination)
  $global:liskaTestMoveCalls++
  if ($global:liskaTestMoveCalls -eq 2) { throw 'synthetic move failure' }
  Microsoft.PowerShell.Management\\Move-Item -LiteralPath $LiteralPath -Destination $Destination
}
& '${script.replaceAll("'", "''")}' @PSBoundParameters
exit $LASTEXITCODE
`
    );
    const before = inventory(paths.target);
    const result = run(paths, [], wrapper);
    expect(result.status).toBe(1);
    expect(result.receipt).toMatchObject({
      installStatus: 'restored',
      errorCode: 'target-swap-failed',
      rollbackLeaf: null,
      installedSha256: null,
    });
    expect(inventory(paths.target)).toEqual(before);
    expect(readdirSync(paths.rollback)).toEqual([]);
    expect(readdirSync(dirname(paths.target))).toEqual(['dist']);
  });

  it('runs the exact build command before deployment without printing build output', () => {
    const paths = fixture();
    const wrapper = join(paths.root, 'build-command.ps1');
    const evidence = join(paths.root, 'build-command.json');
    const copiedScript = join(dirname(paths.source), 'scripts', 'install-unpacked-extension.ps1');
    mkdirSync(dirname(copiedScript));
    writeFileSync(copiedScript, readFileSync(script));
    writeFileSync(
      wrapper,
      `param([string]$TargetDist,[string]$SourceDist,[string]$RollbackRoot)
function npm {
  param([string]$Verb,[string]$Name)
  [IO.File]::WriteAllText('${evidence.replaceAll("'", "''")}', (ConvertTo-Json @($Verb,$Name) -Compress))
  Write-Output 'private build output must be suppressed'
  $global:LASTEXITCODE = 0
}
& '${copiedScript.replaceAll("'", "''")}' @PSBoundParameters
exit $LASTEXITCODE
`
    );
    const result = run(paths, [], wrapper, false);
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(evidence, 'utf8'))).toEqual(['run', 'build']);
    expect(result.stdout).not.toContain('private build output');
    expect(result.receipt.installStatus).toBe('installed');
  });

  it('refuses to build one dist while silently deploying another source', () => {
    const paths = fixture();
    const before = inventory(paths.target);
    const result = run(paths, [], script, false);
    expect(result.status).toBe(1);
    expect(result.receipt.errorCode).toBe('build-source-mismatch');
    expect(inventory(paths.target)).toEqual(before);
    expect(existsSync(paths.rollback)).toBe(false);
  });

  it('keeps restart planned/off and validates force/path flag combinations without a browser', () => {
    const paths = fixture();
    const executable = join(paths.root, 'comet.exe');
    writeFileSync(executable, 'never execute');
    const before = inventory(paths.root);
    const plan = run(paths, [
      '-PlanOnly',
      '-RestartComet',
      '-ForceCloseAfterTimeout',
      '-CometExecutable',
      executable,
    ]);
    expect(plan.status).toBe(0);
    expect(plan.receipt).toMatchObject({
      installStatus: 'planned',
      restartRequested: true,
      restartResult: 'planned',
      reloadRequired: true,
      oldMainPid: null,
      newMainPid: null,
    });
    expect(inventory(paths.root)).toEqual(before);
    expect(run(paths, ['-PlanOnly', '-ForceCloseAfterTimeout']).receipt.errorCode).toBe(
      'force-close-requires-restart'
    );
    expect(run(paths, ['-PlanOnly', '-CometExecutable', executable]).receipt.errorCode).toBe(
      'comet-executable-requires-restart'
    );
    expect(run(paths, ['-PlanOnly', '-GracefulTimeoutSeconds', '0']).receipt.errorCode).toBe(
      'timeout-invalid'
    );
    expect(inventory(paths.root)).toEqual(before);
  });

  it.skipIf(process.platform !== 'win32')(
    'gracefully restarts only the exact executable after verified installation',
    () => {
      const paths = fixture();
      const mock = mockedComet(paths, true);
      const result = run(
        paths,
        ['-RestartComet', '-CometExecutable', mock.executable],
        mock.wrapper
      );
      expect(result.status).toBe(0);
      expect(result.receipt).toMatchObject({
        installStatus: 'installed',
        restartResult: 'confirmed',
        reloadRequired: false,
        oldMainPid: 101,
        newMainPid: 301,
        errorCode: null,
      });
      expect(JSON.parse(readFileSync(mock.evidence, 'utf8'))).toEqual({
        Events: ['close-main', 'launch'],
        Stopped: [],
        Launched: true,
      });
      expect(inventory(paths.target)).toEqual(inventory(paths.source));
    }
  );

  it.skipIf(process.platform !== 'win32')(
    'keeps a verified deployment and rollback when graceful close times out',
    () => {
      const paths = fixture();
      const old = inventory(paths.target);
      const mock = mockedComet(paths, false);
      const result = run(
        paths,
        ['-RestartComet', '-CometExecutable', mock.executable, '-GracefulTimeoutSeconds', '1'],
        mock.wrapper
      );
      expect(result.status).toBe(1);
      expect(result.receipt).toMatchObject({
        installStatus: 'installed',
        restartResult: 'failed',
        reloadRequired: true,
        oldMainPid: 101,
        newMainPid: null,
        errorCode: 'comet-close-timeout',
      });
      expect(inventory(paths.target)).toEqual(inventory(paths.source));
      expect(inventory(join(paths.rollback, result.receipt.rollbackLeaf!))).toEqual(old);
      expect(JSON.parse(readFileSync(mock.evidence, 'utf8'))).toEqual({
        Events: ['close-main'],
        Stopped: [],
        Launched: false,
      });
    }
  );

  it.skipIf(process.platform !== 'win32')(
    'force-closes only rechecked exact-executable processes when explicitly requested',
    () => {
      const paths = fixture();
      const mock = mockedComet(paths, false);
      const result = run(
        paths,
        [
          '-RestartComet',
          '-CometExecutable',
          mock.executable,
          '-GracefulTimeoutSeconds',
          '1',
          '-ForceCloseAfterTimeout',
        ],
        mock.wrapper
      );
      expect(result.status).toBe(0);
      expect(result.receipt).toMatchObject({
        installStatus: 'installed',
        restartResult: 'confirmed',
        oldMainPid: 101,
        newMainPid: 301,
        errorCode: null,
      });
      expect(JSON.parse(readFileSync(mock.evidence, 'utf8'))).toEqual({
        Events: ['close-main', 'launch'],
        Stopped: [101, 102],
        Launched: true,
      });
    }
  );
});
