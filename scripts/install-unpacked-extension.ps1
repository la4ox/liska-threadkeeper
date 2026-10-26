#requires -Version 7.0
<#
.SYNOPSIS
Builds and replaces one explicitly named Liska unpacked dist, retaining its old bytes.
.DESCRIPTION
No browser extension is loaded or installed. Reload the existing extension after
deployment, or explicitly request a graceful Comet restart. Existing rollback
directories are never removed. PlanOnly performs no build, writes or process input.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$TargetDist,
    [string]$SourceDist = (Join-Path $PSScriptRoot '../dist'),
    [string]$RollbackRoot = $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'CodexTools/liska-rollbacks' }),
    [switch]$SkipBuild,
    [switch]$PlanOnly,
    [switch]$RestartComet,
    [int]$GracefulTimeoutSeconds = 30,
    [int]$LaunchTimeoutSeconds = 30,
    [switch]$ForceCloseAfterTimeout,
    [string]$CometExecutable
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$script:FailureCode = 'validation-failed'
$pathComparison = [StringComparison]::OrdinalIgnoreCase
$stagePrefix = '.liska-install-stage-'
$receipt = [ordered]@{
    schema = 'liska-unpacked-install/1'
    installStatus = 'failed'
    fileCount = 0
    byteLength = 0
    sourceSha256 = $null
    installedSha256 = $null
    manifestSha256 = $null
    rollbackLeaf = $null
    reloadRequired = $true
    restartRequested = [bool]$RestartComet
    restartResult = $(if ($RestartComet) { 'not-started' } else { 'not-requested' })
    oldMainPid = $null
    newMainPid = $null
    errorCode = $null
}
$stagePath = $null
$targetPath = $null
$targetParent = $null
$rollbackPath = $null
$oldMoved = $false
$promoted = $false
$installed = $false

function Stop-Install([string]$Code) {
    $script:FailureCode = $Code
    throw [InvalidOperationException]::new($Code)
}

function Full-Path([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or -not [IO.Path]::IsPathFullyQualified($Value)) {
        Stop-Install 'absolute-path-required'
    }
    return [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($Value))
}

function Is-Within([string]$Root, [string]$Path) {
    return $Path.StartsWith($Root + [IO.Path]::DirectorySeparatorChar, $pathComparison)
}

function Assert-NoReparse([string]$Path) {
    $cursor = $Path
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType) {
                Stop-Install 'reparse-path-rejected'
            }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if (-not $parent -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Hash-Bytes([byte[]]$Bytes) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}

function Read-Json([string]$Path) {
    $script:FailureCode = 'manifest-invalid'
    $text = [Text.UTF8Encoding]::new($false, $true).GetString([IO.File]::ReadAllBytes($Path))
    $options = [Text.Json.JsonDocumentOptions]::new()
    $options.MaxDepth = 64
    $document = [Text.Json.JsonDocument]::Parse($text, $options)
    try {
        Assert-JsonKeys $document.RootElement
        return ConvertFrom-Json -InputObject $text -AsHashtable -Depth 64
    } finally { $document.Dispose() }
}

function Assert-JsonKeys([Text.Json.JsonElement]$Element) {
    if ($Element.ValueKind -eq [Text.Json.JsonValueKind]::Object) {
        $keys = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($property in $Element.EnumerateObject()) {
            if (-not $keys.Add($property.Name)) { Stop-Install 'manifest-invalid' }
            Assert-JsonKeys $property.Value
        }
    } elseif ($Element.ValueKind -eq [Text.Json.JsonValueKind]::Array) {
        foreach ($child in $Element.EnumerateArray()) { Assert-JsonKeys $child }
    }
}

function Manifest-Identity([string]$Root, [Collections.Generic.HashSet[string]]$FileSlots) {
    $manifest = Read-Json (Join-Path $Root 'manifest.json')
    if ($manifest -isnot [Collections.IDictionary] -or $manifest.manifest_version -ne 3 -or
        $manifest.version -isnot [string] -or $manifest.version -notmatch '^\d{1,5}(?:\.\d{1,5}){0,3}$') {
        Stop-Install 'manifest-invalid'
    }
    foreach ($component in $manifest.version.Split('.')) {
        if ([int]$component -gt 65535) { Stop-Install 'manifest-invalid' }
    }
    $name = $manifest.name
    if ($name -eq '__MSG_extName__') {
        if ($manifest.default_locale -ne 'en' -or -not $FileSlots.Contains('_locales/en/messages.json')) {
            Stop-Install 'manifest-invalid'
        }
        $messages = Read-Json (Join-Path $Root '_locales/en/messages.json')
        if ($messages.extName -isnot [Collections.IDictionary]) { Stop-Install 'manifest-invalid' }
        $name = $messages.extName.message
    }
    if ($name -cne 'Liska — AI Threadkeeper') { Stop-Install 'manifest-identity-mismatch' }
    if ($manifest.background -isnot [Collections.IDictionary] -or $manifest.background.type -ne 'module') {
        Stop-Install 'manifest-invalid'
    }
    $worker = $manifest.background.service_worker
    if ($worker -isnot [string] -or $worker -notmatch '^[A-Za-z0-9_./-]+\.js$' -or
        $worker.Split('/') -contains '..' -or -not $FileSlots.Contains($worker)) {
        Stop-Install 'manifest-entry-invalid'
    }
    if ($manifest.action -isnot [Collections.IDictionary]) { Stop-Install 'manifest-invalid' }
    $popup = $manifest.action.default_popup
    if ($popup -isnot [string] -or $popup -notmatch '^[A-Za-z0-9_./-]+\.html$' -or
        $popup.Split('/') -contains '..' -or -not $FileSlots.Contains($popup)) {
        Stop-Install 'manifest-entry-invalid'
    }
    $key = if ($manifest.Contains('key')) { $manifest.key } else { $null }
    if ($null -ne $key -and ($key -isnot [string] -or [string]::IsNullOrWhiteSpace($key))) {
        Stop-Install 'manifest-invalid'
    }
    return [pscustomobject]@{ Name = $name; Key = $key }
}

function Inventory([string]$Root) {
    Assert-NoReparse $Root
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { Stop-Install 'directory-missing' }
    $slots = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $fileSlots = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $files = [Collections.Generic.List[object]]::new()
    $directories = [Collections.Generic.List[string]]::new()
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($Root)
    [long]$total = 0
    while ($pending.Count -gt 0) {
        $directory = $pending.Pop()
        foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force)) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType) {
                Stop-Install 'reparse-path-rejected'
            }
            $relative = [IO.Path]::GetRelativePath($Root, $item.FullName).Replace('\', '/')
            if ($relative -match '[\x00-\x1f\x7f:]' -or $relative.Split('/') -contains '..' -or
                $relative.Split('/') -match '[.\s]$' -or -not $slots.Add($relative)) {
                Stop-Install 'ambiguous-inventory'
            }
            if ($item.PSIsContainer) {
                $directories.Add($relative)
                $pending.Push($item.FullName)
            } else {
                [void]$fileSlots.Add($relative)
                $hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                $files.Add([pscustomobject]@{ RelativePath = $relative; ByteLength = $item.Length; Sha256 = $hash })
                $total += $item.Length
            }
        }
    }
    if (-not $fileSlots.Contains('manifest.json')) { Stop-Install 'manifest-missing' }
    $identity = Manifest-Identity $Root $fileSlots
    $ordered = @($files.ToArray())
    [Array]::Sort($ordered, [Collections.Generic.Comparer[object]]::Create({ param($left, $right) [StringComparer]::Ordinal.Compare($left.RelativePath, $right.RelativePath) }))
    $projection = [Text.StringBuilder]::new()
    foreach ($file in $ordered) {
        [void]$projection.Append($file.RelativePath).Append([char]0).Append($file.ByteLength).Append([char]0).Append($file.Sha256).Append("`n")
    }
    return [pscustomobject]@{
        Files = $ordered
        Directories = @($directories | Sort-Object)
        FileCount = $ordered.Count
        ByteLength = $total
        Sha256 = Hash-Bytes ([Text.Encoding]::UTF8.GetBytes($projection.ToString()))
        ManifestSha256 = ($ordered | Where-Object RelativePath -CEQ 'manifest.json').Sha256
        Identity = $identity
    }
}

function Assert-EqualInventory($Expected, $Actual) {
    if ($Expected.FileCount -ne $Actual.FileCount -or $Expected.ByteLength -ne $Actual.ByteLength -or
        $Expected.Sha256 -cne $Actual.Sha256) { Stop-Install 'inventory-verification-failed' }
}

function Remove-GeneratedStage([string]$Path, [string]$Expected, [string]$Parent) {
    $full = Full-Path $Path
    if (-not $full.Equals($Expected, $pathComparison) -or
        -not ([IO.Path]::GetDirectoryName($full)).Equals($Parent, $pathComparison) -or
        [IO.Path]::GetFileName($full) -notmatch '^\.liska-install-stage-[a-f0-9]{32}$') {
        Stop-Install 'stage-cleanup-refused'
    }
    if (Test-Path -LiteralPath $full) {
        Assert-NoReparse $full
        # Inspect every descendant before a recursive delete can cross a link.
        $pending = [Collections.Generic.Stack[string]]::new()
        $pending.Push($full)
        while ($pending.Count -gt 0) {
            foreach ($item in @(Get-ChildItem -LiteralPath $pending.Pop() -Force)) {
                if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType) {
                    Stop-Install 'stage-cleanup-refused'
                }
                if ($item.PSIsContainer) { $pending.Push($item.FullName) }
            }
        }
        Remove-Item -LiteralPath $full -Recurse -Force
    }
}

function Comet-Processes([string]$Executable) {
    $matched = [Collections.Generic.List[object]]::new()
    foreach ($process in @(Get-Process -Name 'comet' -ErrorAction SilentlyContinue)) {
        try { $path = $process.Path } catch { Stop-Install 'comet-process-uninspectable' }
        if (-not $path) { Stop-Install 'comet-process-uninspectable' }
        if ((Full-Path $path).Equals($Executable, $pathComparison)) { $matched.Add($process) }
    }
    return $matched.ToArray()
}

function Resolve-Comet {
    if (-not $IsWindows) { Stop-Install 'comet-restart-windows-only' }
    if ($CometExecutable) {
        $executable = Full-Path $CometExecutable
    } else {
        $main = @(Get-Process -Name 'comet' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
        if ($main.Count -ne 1) { Stop-Install 'comet-executable-required' }
        try { $executable = Full-Path $main[0].Path } catch { Stop-Install 'comet-process-uninspectable' }
    }
    Assert-NoReparse $executable
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf) -or [IO.Path]::GetFileName($executable) -ine 'comet.exe') {
        Stop-Install 'comet-executable-invalid'
    }
    $processes = @(Comet-Processes $executable)
    $main = @($processes | Where-Object { $_.MainWindowHandle -ne 0 })
    if ($main.Count -gt 1) { Stop-Install 'comet-main-window-ambiguous' }
    return [pscustomobject]@{ Executable = $executable; MainPid = $(if ($main.Count -eq 1) { $main[0].Id } else { $null }) }
}

function Restart-ExactComet($Context) {
    $script:FailureCode = 'comet-close-failed'
    $oldIds = @((Comet-Processes $Context.Executable) | ForEach-Object Id)
    foreach ($process in @(Comet-Processes $Context.Executable)) {
        if ($process.MainWindowHandle -ne 0) { [void]$process.CloseMainWindow() }
    }
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while (@(Comet-Processes $Context.Executable).Count -gt 0 -and $clock.Elapsed.TotalSeconds -lt $GracefulTimeoutSeconds) {
        Start-Sleep -Milliseconds 100
    }
    $remaining = @(Comet-Processes $Context.Executable)
    if ($remaining.Count -gt 0) {
        if (-not $ForceCloseAfterTimeout) { Stop-Install 'comet-close-timeout' }
        foreach ($process in $remaining) {
            # Never stop by name or stale PID: rebind and recheck exact executable.
            $current = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
            if ($current -and (Full-Path $current.Path).Equals($Context.Executable, $pathComparison)) {
                Stop-Process -InputObject $current -Force
            }
        }
        $clock.Restart()
        while (@(Comet-Processes $Context.Executable).Count -gt 0 -and $clock.Elapsed.TotalSeconds -lt 5) {
            Start-Sleep -Milliseconds 100
        }
        if (@(Comet-Processes $Context.Executable).Count -gt 0) { Stop-Install 'comet-close-timeout' }
    }
    $script:FailureCode = 'comet-launch-failed'
    Assert-NoReparse $Context.Executable
    # The user explicitly requested an interactive browser restart, not a hidden helper.
    $launched = Start-Process -FilePath $Context.Executable -ArgumentList @('--restore-last-session') -PassThru
    $clock.Restart()
    do {
        $main = @(Comet-Processes $Context.Executable | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Id -notin $oldIds })
        if ($main.Count -eq 1) { return $main[0].Id }
        if ($main.Count -gt 1) { Stop-Install 'comet-main-window-ambiguous' }
        Start-Sleep -Milliseconds 100
    } while ($clock.Elapsed.TotalSeconds -lt $LaunchTimeoutSeconds)
    Stop-Install 'comet-launch-timeout'
}

try {
    if ($GracefulTimeoutSeconds -lt 1 -or $GracefulTimeoutSeconds -gt 300 -or
        $LaunchTimeoutSeconds -lt 1 -or $LaunchTimeoutSeconds -gt 300) { Stop-Install 'timeout-invalid' }
    if ($ForceCloseAfterTimeout -and -not $RestartComet) { Stop-Install 'force-close-requires-restart' }
    if ($CometExecutable -and -not $RestartComet) { Stop-Install 'comet-executable-requires-restart' }
    $sourcePath = Full-Path $SourceDist
    $targetPath = Full-Path $TargetDist
    if (-not $SkipBuild -and -not $PlanOnly -and
        -not $sourcePath.Equals((Full-Path (Join-Path $PSScriptRoot '../dist')), $pathComparison)) {
        Stop-Install 'build-source-mismatch'
    }
    $targetParent = [IO.Path]::GetDirectoryName($targetPath)
    if (-not $targetParent -or [IO.Path]::GetFileName($targetPath) -ine 'dist') { Stop-Install 'target-must-be-dist' }
    Assert-NoReparse $sourcePath
    Assert-NoReparse $targetPath
    if (-not (Test-Path -LiteralPath $targetParent -PathType Container)) { Stop-Install 'target-parent-missing' }
    if ($sourcePath.Equals($targetPath, $pathComparison) -or (Is-Within $sourcePath $targetPath) -or (Is-Within $targetPath $sourcePath)) {
        Stop-Install 'source-target-overlap'
    }
    $rollbackRootPath = Full-Path $RollbackRoot
    Assert-NoReparse $rollbackRootPath
    if ($rollbackRootPath -eq [IO.Path]::GetPathRoot($rollbackRootPath) -or
        $rollbackRootPath.Equals($targetPath, $pathComparison) -or
        $rollbackRootPath.Equals($sourcePath, $pathComparison) -or
        (Is-Within $sourcePath $rollbackRootPath) -or (Is-Within $targetPath $rollbackRootPath) -or
        (Is-Within $rollbackRootPath $sourcePath) -or (Is-Within $rollbackRootPath $targetPath)) {
        Stop-Install 'rollback-path-overlap'
    }
    if (-not ([IO.Path]::GetPathRoot($rollbackRootPath)).Equals([IO.Path]::GetPathRoot($targetPath), $pathComparison)) {
        Stop-Install 'rollback-volume-mismatch'
    }
    $oldInventory = if (Test-Path -LiteralPath $targetPath) { Inventory $targetPath } else { $null }
    $cometContext = $null
    if ($RestartComet -and -not $PlanOnly) { $cometContext = Resolve-Comet }
    if ($CometExecutable -and $PlanOnly) {
        $executable = Full-Path $CometExecutable
        Assert-NoReparse $executable
        if (-not (Test-Path -LiteralPath $executable -PathType Leaf) -or [IO.Path]::GetFileName($executable) -ine 'comet.exe') {
            Stop-Install 'comet-executable-invalid'
        }
    }
    if (-not $SkipBuild -and -not $PlanOnly) {
        $script:FailureCode = 'build-failed'
        Push-Location (Join-Path $PSScriptRoot '..')
        try { & npm run build *> $null; $buildExit = $LASTEXITCODE } finally { Pop-Location }
        if ($buildExit -ne 0) { Stop-Install 'build-failed' }
    }
    $expected = Inventory $sourcePath
    if ($oldInventory -and ($oldInventory.Identity.Key -cne $expected.Identity.Key)) { Stop-Install 'manifest-identity-mismatch' }
    $receipt.fileCount = $expected.FileCount
    $receipt.byteLength = $expected.ByteLength
    $receipt.sourceSha256 = $expected.Sha256
    $receipt.manifestSha256 = $expected.ManifestSha256
    if ($PlanOnly) {
        $receipt.installStatus = 'planned'
        if ($RestartComet) { $receipt.restartResult = 'planned' }
    } else {
        $script:FailureCode = 'staging-copy-failed'
        $stagePath = Join-Path $targetParent ($stagePrefix + [Guid]::NewGuid().ToString('N'))
        if (Test-Path -LiteralPath $stagePath) { Stop-Install 'staging-collision' }
        [void][IO.Directory]::CreateDirectory($stagePath)
        foreach ($directory in $expected.Directories) { [void][IO.Directory]::CreateDirectory((Join-Path $stagePath $directory)) }
        foreach ($file in $expected.Files) { [IO.File]::Copy((Join-Path $sourcePath $file.RelativePath), (Join-Path $stagePath $file.RelativePath), $false) }
        Assert-EqualInventory $expected (Inventory $stagePath)
        Assert-EqualInventory $expected (Inventory $sourcePath)
        Assert-NoReparse $targetPath
        Assert-NoReparse $rollbackRootPath
        if ($oldInventory) {
            Assert-EqualInventory $oldInventory (Inventory $targetPath)
            [void][IO.Directory]::CreateDirectory($rollbackRootPath)
            $rollbackLeaf = 'liska-rollback-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N')
            $rollbackPath = Join-Path $rollbackRootPath $rollbackLeaf
            if (Test-Path -LiteralPath $rollbackPath) { Stop-Install 'rollback-collision' }
            $script:FailureCode = 'target-swap-failed'
            Move-Item -LiteralPath $targetPath -Destination $rollbackPath
            $oldMoved = $true
            $receipt.rollbackLeaf = $rollbackLeaf
        } elseif (Test-Path -LiteralPath $targetPath) { Stop-Install 'target-changed' }
        $script:FailureCode = 'target-swap-failed'
        Move-Item -LiteralPath $stagePath -Destination $targetPath
        $promoted = $true
        $actual = Inventory $targetPath
        Assert-EqualInventory $expected $actual
        $receipt.installedSha256 = $actual.Sha256
        $receipt.installStatus = 'installed'
        $installed = $true
        if ($RestartComet) {
            $receipt.oldMainPid = $cometContext.MainPid
            $receipt.newMainPid = Restart-ExactComet $cometContext
            $receipt.restartResult = 'confirmed'
            $receipt.reloadRequired = $false
        }
    }
    $receipt | ConvertTo-Json -Compress -Depth 4
    exit 0
} catch {
    $code = $script:FailureCode
    if ($installed) {
        $receipt.restartResult = 'failed'
    } elseif ($oldMoved) {
        try {
            if (Test-Path -LiteralPath $targetPath) {
                if (-not $promoted) { throw [InvalidOperationException]::new('foreign-target') }
                $failedStage = Join-Path $targetParent ($stagePrefix + [Guid]::NewGuid().ToString('N'))
                Assert-NoReparse $targetPath
                Move-Item -LiteralPath $targetPath -Destination $failedStage
            }
            Assert-NoReparse $rollbackPath
            Move-Item -LiteralPath $rollbackPath -Destination $targetPath
            Assert-EqualInventory $oldInventory (Inventory $targetPath)
            $receipt.installStatus = 'restored'
            $receipt.rollbackLeaf = $null
        } catch { $receipt.installStatus = 'failed-recovery-required' }
    }
    if (-not $promoted -and $stagePath -and (Test-Path -LiteralPath $stagePath)) {
        try { Remove-GeneratedStage $stagePath $stagePath $targetParent } catch { }
    }
    $receipt.errorCode = $code
    $receipt | ConvertTo-Json -Compress -Depth 4
    exit 1
}
