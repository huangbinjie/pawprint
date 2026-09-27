$ErrorActionPreference = 'Stop'
$version = (Get-Content -Raw package.json | ConvertFrom-Json).version
$workspace = Join-Path $env:RUNNER_TEMP ('pawprint-upgrade-test-' + [guid]::NewGuid())
$target = Join-Path $workspace 'Pawprint update test'
$stage = Join-Path $workspace ('pawprint-update-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force $target,$stage | Out-Null
$old = Join-Path $workspace 'old-setup.exe'
$oldUrl = 'https://github.com/huangbinjie/pawprint/releases/download/v0.11.9/Pawprint-0.11.9-win-x64-setup.exe'
Invoke-WebRequest -Uri $oldUrl -OutFile $old
$checksumFile = Join-Path $workspace 'baseline.sha256'
Invoke-WebRequest -Uri ($oldUrl + '.sha256') -OutFile $checksumFile
$checksum = (Get-Content -Raw $checksumFile).Trim().Split(' ')[0]
if ((Get-FileHash $old -Algorithm SHA256).Hash.ToLowerInvariant() -ne $checksum) { throw 'Baseline installer checksum mismatch' }
function Install-Initial {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $old; $info.Arguments = '/S /D=' + $target; $info.UseShellExecute = $true
  $process = [System.Diagnostics.Process]::Start($info); $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw 'Baseline install failed' }
}
$exe = Join-Path $target 'Pawprint.exe'
try {
  Install-Initial
  if ((Get-Item $exe).VersionInfo.ProductVersion -notlike '0.11.9*') { throw 'Wrong baseline version' }
  $profile = Join-Path $env:APPDATA 'Pawprint'
  New-Item -ItemType Directory -Force $profile | Out-Null
  node --input-type=module -e "import { seedMatureCompanion } from './tests/fixtures/game.mjs'; await seedMatureCompanion(process.argv[1]);" $profile
  if ($LASTEXITCODE -ne 0) { throw 'Failed to seed test pet' }
  $marker = Join-Path $profile 'update-preservation-test.txt'
  [IO.File]::WriteAllText($marker, 'preserve-pawprint-user-data')
  $oldApp = Start-Process -FilePath $exe -PassThru
  Start-Sleep -Seconds 3
  $before = Get-Content -Raw (Join-Path $profile 'save-v1.json') | ConvertFrom-Json
  $ready = Join-Path $stage "Pawprint-$version-win-x64-setup.exe"
  Copy-Item "release/Pawprint-$version-win-x64-setup.exe" $ready
  $hash = (Get-FileHash $ready -Algorithm SHA256).Hash.ToLowerInvariant()
  node tests/run-windows-installer.mjs $exe $ready $stage $oldApp.Id $hash (Join-Path $pwd 'electron/install-update.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Updater helper failed to start' }
  Start-Sleep -Seconds 2
  if ((Get-Item $exe).VersionInfo.ProductVersion -notlike '0.11.9*') { throw 'Updater replaced a running app' }
  Stop-Process -Id $oldApp.Id -Force -ErrorAction SilentlyContinue
  $deadline = (Get-Date).AddMinutes(3)
  do {
    Start-Sleep -Seconds 2
    $updated = (Test-Path $exe) -and (Get-Item $exe).VersionInfo.ProductVersion -like "$version*"
    $restarted = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $exe }).Count -gt 0
    $finished = !(Test-Path $stage)
  } until (($updated -and $restarted -and $finished) -or (Get-Date) -gt $deadline)
  if (!$updated -or !$restarted -or !$finished) {
    if (Test-Path ($stage + '.log')) { Get-Content -LiteralPath ($stage + '.log') }
    Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'Pawprint|setup|powershell|smartscreen' } | Select-Object Name, ProcessId, ParentProcessId, ExecutablePath | Format-Table -AutoSize
    if (Test-Path (Join-Path $stage 'install.log')) { Get-Content (Join-Path $stage 'install.log') }
    throw "Update failed: updated=$updated restarted=$restarted finished=$finished"
  }
  if ((Get-Content -Raw $marker) -ne 'preserve-pawprint-user-data') { throw 'User data was lost' }
  $after = Get-Content -Raw (Join-Path $profile 'save-v1.json') | ConvertFrom-Json
  foreach ($field in @('pets','eggs','balance','ledger','capacity','activePetId')) {
    if (($before.$field | ConvertTo-Json -Depth 100 -Compress) -ne ($after.$field | ConvertTo-Json -Depth 100 -Compress)) { throw "Changed saved field: $field" }
  }
  Write-Output "PASS: 0.11.9 -> $version; parent exit respected, custom path preserved, automatic restart and user data verified."
} finally {
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $exe } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
