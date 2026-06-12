param(
    [Parameter(Mandatory=$true)][string]$JsFile,
    [Parameter(Mandatory=$true)][string]$OutFile,
    [string]$WindowId,
    [int]$Port = 0
)
$ErrorActionPreference = "Stop"

function Find-BridgePort {
    param([int]$PreferredPort)
    $ports = @()
    if ($PreferredPort -gt 0) { $ports += $PreferredPort }
    $ports += 49620..49629 | Where-Object { $_ -ne $PreferredPort }
    foreach ($p in $ports) {
        try {
            $h = Invoke-RestMethod -Uri "http://127.0.0.1:$p/health" -TimeoutSec 1
            if ($h.service -eq "easyeda-bridge") { return $p }
        } catch {}
    }
    throw "EasyEDA bridge service not found on ports 49620-49629"
}

$BridgePort = Find-BridgePort -PreferredPort $Port
$code = [string](Get-Content -Raw -Encoding UTF8 $JsFile)
$payload = @{ code = $code }
if ($WindowId) { $payload.windowId = $WindowId }
$body = $payload | ConvertTo-Json -Compress
try {
    $resp = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$BridgePort/execute" -ContentType "application/json" -Body $body
    if (-not $resp.success) { Write-Output ("EXEC_FAIL: " + ($resp | ConvertTo-Json -Depth 5)); exit 1 }
    $resp.result | ConvertTo-Json -Depth 60 -Compress | Set-Content -Path $OutFile -Encoding UTF8
    $bytes = (Get-Item $OutFile).Length
    Write-Output ("SAVED $OutFile ($bytes bytes)")
} catch {
    $r = $_.Exception.Response
    if ($r) { $sr = New-Object System.IO.StreamReader($r.GetResponseStream()); Write-Output ("HTTP_ERROR: " + $sr.ReadToEnd()) }
    else { Write-Output ("ERR: " + $_.Exception.Message) }
    exit 1
}
