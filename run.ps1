param(
    [Parameter(Mandatory=$true)][string]$JsFile,
    [string]$WindowId,
    [int]$Port = 0,
    [int]$TimeoutSec = 120
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
    $resp = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$BridgePort/execute" -ContentType "application/json" -Body $body -TimeoutSec $TimeoutSec
} catch {
    $r = $_.Exception.Response
    if ($r) {
        $sr = New-Object System.IO.StreamReader($r.GetResponseStream())
        Write-Output ("HTTP_ERROR_BODY: " + $sr.ReadToEnd())
    } else {
        Write-Output ("ERR: " + $_.Exception.Message)
    }
    throw
}
if ($resp.PSObject.Properties.Name -contains "success" -and -not $resp.success) {
    $msg = "EXEC_FAIL: " + ($resp | ConvertTo-Json -Depth 5)
    Write-Output $msg
    throw $msg
}
$resp | ConvertTo-Json -Depth 40
