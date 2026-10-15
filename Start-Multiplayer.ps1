param([ValidateSet('quic', 'http2')][string]$Transport = 'quic')
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$runtimeDir = Join-Path $projectRoot 'runtime'
$stopPath = Join-Path $runtimeDir 'stop-game'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$tunnelExe = Join-Path $projectRoot 'tools/cloudflared.exe'
if (-not (Test-Path -LiteralPath $tunnelExe)) { throw 'tools/cloudflared.exe is missing.' }

function Game-IsReady {
  try { return (Invoke-RestMethod 'http://127.0.0.1:8080/healthz' -TimeoutSec 2).ok -eq $true } catch { return $false }
}

$gamePidPath = Join-Path $runtimeDir 'game-pid.txt'
$trackedGameAlive = $false
if (Test-Path -LiteralPath $gamePidPath) {
  $trackedGamePid = [int](Get-Content -LiteralPath $gamePidPath -Raw).Trim()
  $trackedGame = Get-CimInstance Win32_Process -Filter "ProcessId=$trackedGamePid" -ErrorAction SilentlyContinue
  $trackedGameAlive = $trackedGame -and $trackedGame.CommandLine.Contains((Join-Path $projectRoot 'server/index.js'))
}
if (-not $trackedGameAlive -and -not (Game-IsReady)) {
  Remove-Item -LiteralPath $stopPath -Force -ErrorAction SilentlyContinue
  $oldStopFile = $env:STOP_FILE
  $oldPort = $env:PORT
  try {
    $env:STOP_FILE = $stopPath
    $env:PORT = '8080'
    $gameProcessId = & $nodeExe (Join-Path $projectRoot 'tools/launch-background.mjs') $nodeExe (Join-Path $runtimeDir 'game.out.log') (Join-Path $runtimeDir 'game.err.log') (Join-Path $projectRoot 'server/index.js')
    if ($LASTEXITCODE -ne 0) { throw 'Could not launch game' }
  } finally {
    $env:STOP_FILE = $oldStopFile
    $env:PORT = $oldPort
  }
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if (Game-IsReady) { $ready = $true; break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) { throw 'Game did not start. Check runtime/game.err.log.' }
  $gameProcessId | Set-Content -LiteralPath $gamePidPath
}

$tunnelPidPath = Join-Path $runtimeDir 'tunnel-pid.txt'
$urlPath = Join-Path $runtimeDir 'public-url.txt'
if ((Test-Path -LiteralPath $tunnelPidPath) -and (Test-Path -LiteralPath $urlPath)) {
  $savedTunnelPid = [int](Get-Content -LiteralPath $tunnelPidPath -Raw).Trim()
  $existingTunnel = Get-CimInstance Win32_Process -Filter "ProcessId=$savedTunnelPid" -ErrorAction SilentlyContinue
  if ($existingTunnel -and $existingTunnel.ExecutablePath -eq $tunnelExe) {
    $savedUrl = (Get-Content -LiteralPath $urlPath -Raw).Trim()
    try {
      if ((Invoke-RestMethod ($savedUrl + '/healthz') -TimeoutSec 5).ok) {
        Write-Output ('PLAY / SHARE: ' + $savedUrl)
        exit 0
      }
    } catch {}
    Stop-Process -Id $savedTunnelPid
  }
}

# cloudflared's Windows edge connection needs an explicit PEM bundle to use
# certificates already trusted by Windows, including antivirus HTTPS scanning.
# Export public root certificates only; TLS verification stays enabled.
$caBundlePath = Join-Path $runtimeDir 'windows-roots.pem'
$trustedRoots = Get-ChildItem Cert:/CurrentUser/Root,Cert:/LocalMachine/Root | Sort-Object Thumbprint -Unique
$caBundle = ($trustedRoots | ForEach-Object {
  "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($_.RawData, [Base64FormattingOptions]::InsertLineBreaks) + "`n-----END CERTIFICATE-----"
}) -join "`n"
$caBundle += "`n" + (Get-Content -LiteralPath (Join-Path $projectRoot 'tools/cloudflare-ca.pem') -Raw)
Set-Content -LiteralPath $caBundlePath -Value $caBundle -Encoding ascii
$tunnelLog = Join-Path $runtimeDir 'tunnel.err.log'
Remove-Item -LiteralPath $tunnelLog -Force -ErrorAction SilentlyContinue
$tunnelProcessId = & $nodeExe (Join-Path $projectRoot 'tools/launch-background.mjs') $tunnelExe (Join-Path $runtimeDir 'tunnel.out.log') $tunnelLog tunnel --no-autoupdate --protocol $Transport --edge-ip-version 4 --cacert $caBundlePath --url http://127.0.0.1:8080
if ($LASTEXITCODE -ne 0) { throw 'Could not launch tunnel' }
$tunnelProcessId | Set-Content -LiteralPath $tunnelPidPath
for ($attempt = 0; $attempt -lt 240; $attempt++) {
  if (-not (Get-Process -Id ([int]$tunnelProcessId) -ErrorAction SilentlyContinue)) { throw 'Tunnel stopped. Check runtime/tunnel.err.log.' }
  if (Test-Path -LiteralPath $tunnelLog) {
    $tunnelText = Get-Content -LiteralPath $tunnelLog -Raw -ErrorAction SilentlyContinue
    if ($tunnelText -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
      $publicUrl = $Matches[0]
      if ($tunnelText -notmatch 'Registered tunnel connection') { Start-Sleep -Milliseconds 250; continue }
      try { if (-not (Invoke-RestMethod ($publicUrl + '/healthz') -TimeoutSec 5).ok) { continue } } catch { continue }
      Set-Content -LiteralPath $urlPath -Value $publicUrl
      Write-Output ('PLAY / SHARE: ' + $publicUrl)
      Write-Output 'Create a private Duo, Squad or Penta room, then use Invite to share the room link.'
      Write-Output 'Keep this PC awake and connected to the internet. Restarting the tunnel changes the URL.'
      exit 0
    }
  }
  Start-Sleep -Milliseconds 250
}
throw 'Tunnel URL did not arrive. Check runtime/tunnel.err.log.'
