# 写回顺序：移动 -> 清线 -> 建符号 -> 建导线 -> 缩放
param(
	[switch]$Force,
	[string]$WindowId
)
$ErrorActionPreference = 'Stop'
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($env:EASYEDA_APPLY_RUN_AUTHORIZED -ne '1') {
	Write-Error "Manual apply_run.ps1 is blocked. Use node engine/apply_gated.mjs so the full commercial gate is enforced."
	exit 1
}
if (-not $Force) {
	Write-Error "apply_run.ps1 requires an internal -Force from apply_gated.mjs after commercial gate acceptance."
	exit 1
}
function ChunkNames($Pattern) {
	@(Get-ChildItem (Join-Path $Dir $Pattern) -ErrorAction SilentlyContinue |
		Sort-Object { [int]([regex]::Match($_.BaseName, '\d+$').Value) } |
		ForEach-Object { $_.Name })
}
$order = @('af_delparts.js') +
	(ChunkNames 'af_move_parts_*.js') +
	@('af_nc.js', 'af_del.js') +
	(ChunkNames 'af_wires_*.js') +
	(ChunkNames 'af_flags_*.js') +
	(ChunkNames 'af_ports_*.js') +
	@('af_docs.js') +
	@('af_zoom.js')
$MaxAttempts = 3
foreach ($f in $order) {
	$stepOk = $false
	$lastMessage = ''
	for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
		if ($attempt -eq 1) {
			Write-Host ">> $f"
		} else {
			Write-Host ">> $f retry $attempt/$MaxAttempts"
		}
		$global:LASTEXITCODE = 0
		try {
			$jsPath = Join-Path $Dir $f
			if ($WindowId) {
				$stepOutput = & (Join-Path $Dir 'run.ps1') -JsFile $jsPath -WindowId $WindowId -TimeoutSec 120
			} else {
				$stepOutput = & (Join-Path $Dir 'run.ps1') -JsFile $jsPath -TimeoutSec 120
			}
			$stepOutput | ForEach-Object { Write-Host $_ }
			if ((-not $?) -or ($global:LASTEXITCODE -ne 0)) {
				throw "run.ps1 exited with code $global:LASTEXITCODE"
			}
			$stepOk = $true
			break
		} catch {
			$lastMessage = $_.Exception.Message
			$isTimeout = ($lastMessage -match 'timed out|timeout|Request .* timed out') -or (($stepOutput -join "`n") -match 'timed out|timeout|Request .* timed out')
			if ((-not $isTimeout) -or ($attempt -ge $MaxAttempts)) {
				break
			}
			Start-Sleep -Seconds (1 + $attempt)
		}
	}
	if (-not $stepOk) {
		throw "apply step failed: $f`n$lastMessage"
	}
}
