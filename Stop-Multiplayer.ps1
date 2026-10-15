$ErrorActionPreference = 'Stop'
$runtimeDir = Join-Path $PSScriptRoot 'runtime'
$gamePidPath = Join-Path $runtimeDir 'game-pid.txt'
if (Test-Path -LiteralPath $gamePidPath) {
  $gameProcessId = [int](Get-Content -LiteralPath $gamePidPath -Raw).Trim()
  $gameProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$gameProcessId" -ErrorAction SilentlyContinue
  $gameScript = Join-Path $PSScriptRoot 'server/index.js'
  if ($gameProcess -and $gameProcess.CommandLine.Contains($gameScript)) {
    Set-Content -LiteralPath (Join-Path $runtimeDir 'stop-game') -Value 'save and stop'
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
      if (-not (Get-Process -Id $gameProcessId -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 250
    }
    if (Get-Process -Id $gameProcessId -ErrorAction SilentlyContinue) { throw 'Game is still saving. It was left running to protect the world.' }
    Write-Output 'Game stopped; worlds saved.'
  }
}
$tunnelPidPath = Join-Path $runtimeDir 'tunnel-pid.txt'
if (Test-Path -LiteralPath $tunnelPidPath) {
  $tunnelProcessId = [int](Get-Content -LiteralPath $tunnelPidPath -Raw).Trim()
  $tunnelProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$tunnelProcessId" -ErrorAction SilentlyContinue
  if ($tunnelProcess -and $tunnelProcess.ExecutablePath -eq (Join-Path $PSScriptRoot 'tools/cloudflared.exe')) {
    Stop-Process -Id $tunnelProcessId
    Write-Output 'Public tunnel stopped.'
  }
}
