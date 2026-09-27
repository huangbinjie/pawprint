$ErrorActionPreference = 'Stop'
$installer = $env:PAWPRINT_UPDATE_INSTALLER
$current = $env:PAWPRINT_UPDATE_CURRENT
$root = $env:PAWPRINT_UPDATE_ROOT
$expected = $env:PAWPRINT_UPDATE_SHA256
$parentId = [int]$env:PAWPRINT_UPDATE_PID
$log = Join-Path $root 'install.log'
try {
  if (!(Test-Path -LiteralPath $installer -PathType Leaf) -or $expected -notmatch '^[a-f0-9]{64}$') { throw 'Invalid update package' }
  $parentProcess = Get-Process -Id $parentId -ErrorAction SilentlyContinue
  if ($parentProcess -and !$parentProcess.WaitForExit(120000)) { throw 'Pawprint did not exit in time' }
  if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Update checksum changed' }
  # Start-Process invokes the installer directly. /D must be the last NSIS argument,
  # with no embedded quotes even when the install directory contains spaces.
  $arguments = '/S --updated --force-run /D=' + [IO.Path]::GetDirectoryName($current)
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $installer
  $startInfo.Arguments = $arguments
  $startInfo.UseShellExecute = $true
  $process = [System.Diagnostics.Process]::Start($startInfo)
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw ('Installer exited with ' + $process.ExitCode) }
  if ((Split-Path $root -Leaf) -like 'pawprint-update-*') { Remove-Item -LiteralPath $root -Recurse -Force }
} catch {
  $_.Exception.Message | Out-File -LiteralPath $log -Encoding utf8
  # Keep the verified installer and log for retry. Restore the old app if possible.
  if (Test-Path -LiteralPath $current) { Start-Process -FilePath $current }
  exit 1
}
