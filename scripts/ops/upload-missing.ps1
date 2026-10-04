# ============================================================
# Upload missing markdown files for a workspace (lightrag DB diff)
# ------------------------------------------------------------
# Usage:
#   .\scripts\ops\upload-missing.ps1 -Workspace g00_master_all -Port 9621
# ============================================================

param(
    [Parameter(Mandatory=$true)][string]$Workspace,
    [Parameter(Mandatory=$false)][int]$Port = 9621,
    [Parameter(Mandatory=$false)][int]$BatchDelaySec = 6
)

$ErrorActionPreference = "Continue"
$Url = "http://localhost:$Port"
$dir = "data/inputs/$Workspace/__parsed__"

$diskFiles = Get-ChildItem -File $dir -Filter *.md |
    Where-Object { $_.BaseName -notmatch '_\d{3}$' -and $_.BaseName -notmatch '_\d{3}_\d{3}$' } |
    ForEach-Object { $_.Name } | Sort-Object

$dbRaw = docker exec lightrag-postgres psql -U lightrag -d lightrag -At -c "SELECT file_path FROM lightrag_doc_status WHERE workspace='$Workspace';" 2>&1
$dbFiles = ($dbRaw | Select-String -Pattern "\.md" | ForEach-Object { $_.ToString().Trim() }) | Sort-Object

$missing = $diskFiles | Where-Object { $dbFiles -notcontains $_ }

Write-Host "=========================================="
Write-Host " workspace = $Workspace, port = $Port"
Write-Host " disk count = $($diskFiles.Count)"
Write-Host " DB   count = $($dbFiles.Count)"
Write-Host " missing   = $($missing.Count)"
Write-Host "=========================================="

if ($missing.Count -eq 0) {
    Write-Host "no missing files."
    exit 0
}

$ok = 0; $fail = 0
foreach ($name in $missing) {
    $f = Join-Path $dir $name
    if (-not (Test-Path $f)) { Write-Host "  MISSING file: $f"; $fail++; continue }
    $curlOut = & curl.exe -sS -w "`n%{http_code}" -X POST "$Url/documents/upload?workspace=$Workspace" -F "file=@$($(Resolve-Path $f).Path)" 2>&1
    $code = ($curlOut -split "`n")[-1]
    if ([int]$code -ge 200 -and [int]$code -lt 300) {
        $ok++
        Write-Host "  + $name  (HTTP $code)"
    } else {
        $fail++
        Write-Host "  X $name  HTTP $code  $curlOut"
    }
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "done: ok=$ok fail=$fail"
