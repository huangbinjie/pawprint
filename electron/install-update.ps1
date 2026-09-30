$ErrorActionPreference = 'Stop'
$installer = $env:PAWPRINT_UPDATE_INSTALLER
$current = $env:PAWPRINT_UPDATE_CURRENT
$root = $env:PAWPRINT_UPDATE_ROOT
$expected = $env:PAWPRINT_UPDATE_SHA256
$parentId = [int]$env:PAWPRINT_UPDATE_PID
$log = Join-Path $root 'install.log'
function Log([string]$message) { Add-Content -LiteralPath $log -Value $message }
try {
  Log 'Pawprint update helper started'
  if (!(Test-Path -LiteralPath $installer -PathType Leaf) -or $expected -notmatch '^[a-f0-9]{64}$') { throw 'Invalid update package' }
  Log 'Verifying installer checksum'
  $stream = [IO.File]::OpenRead($installer)
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $actual = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $hasher.Dispose() }
  if ($actual -ne $expected) { throw 'Update checksum changed' }
  # Report readiness only after validating the package; the app can now quit.
  [IO.File]::WriteAllText((Join-Path $root 'helper.ready'), 'ready')
  Log 'Waiting for the old process to exit'
  $parentProcess = Get-Process -Id $parentId -ErrorAction SilentlyContinue
  if ($parentProcess -and !$parentProcess.WaitForExit(120000)) { throw 'Pawprint did not exit in time' }
  # Start-Process invokes the installer directly. /D must be the last NSIS argument,
  # with no embedded quotes even when the install directory contains spaces.
  $arguments = '/S --updated --force-run /D=' + [IO.Path]::GetDirectoryName($current)
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $installer
  $startInfo.Arguments = $arguments
  $startInfo.UseShellExecute = $true
  Log 'Launching the verified installer'
  $process = [System.Diagnostics.Process]::Start($startInfo)
  if (!$process.WaitForExit(600000)) { throw 'Installer did not finish within ten minutes' }
  Log ('Installer exit code: ' + $process.ExitCode)
  if ($process.ExitCode -ne 0) { throw ('Installer exited with ' + $process.ExitCode) }
  if ((Split-Path $root -Leaf) -like 'pawprint-update-*') { Remove-Item -LiteralPath $root -Recurse -Force }
} catch {
  Log $_.Exception.Message
  # Keep the verified installer and log for retry. Restore the old app if possible.
  if (!(Get-Process -Id $parentId -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $current)) { Start-Process -FilePath $current }
  exit 1
}
