# ============================================================
# 批量上传 workspace 的所有 md 到 lightrag-server 触发抽取
# ------------------------------------------------------------
# 用法（PowerShell）：
#   .\scripts\ops\upload-and-extract.ps1 -Workspace g00_master_all -Port 9621
# ============================================================

param(
    [Parameter(Mandatory=$true)][string]$Workspace,
    [Parameter(Mandatory=$false)][int]$Port = 9621,
    [Parameter(Mandatory=$false)][int]$BatchSize = 4,
    [Parameter(Mandatory=$false)][int]$BatchDelaySec = 10
)

$ErrorActionPreference = "Stop"
$Url = "http://localhost:$Port"

$dir = "data/inputs/$Workspace/__parsed__"
if (-not (Test-Path $dir)) {
    Write-Host "ERR: 目录不存在 $dir" -ForegroundColor Red
    exit 1
}

$filesAll = Get-ChildItem -File $dir -Filter *.md | Sort-Object Name
# 排除带 _NNN 或 _NNN_NNN 结尾的副本文件（早期 chunking 脚本重复切出来的）
# 使用单一正则：文件名以 _NNN 或 _NNN_NNN 结尾视为副本
$files = $filesAll | Where-Object { -not ($_.BaseName -match '_\d{3}$' -or $_.BaseName -match '_\d{3}_\d{3}$') }
$skipped = $filesAll.Count - $files.Count
Write-Host "Workspace = $Workspace"
Write-Host "目录文件  = $($filesAll.Count)"
Write-Host "实际抽   = $($files.Count)  (跳过 $skipped 个 _001/_002 副本)"
Write-Host "目标端口  = $Port"
Write-Host "批量      = $BatchSize 文件/批，每批后等 ${BatchDelaySec}s"
Write-Host "----------------------------------------"

# 1) 先扫一遍确保 lightrag 看到这个 workspace
try {
    $r = Invoke-WebRequest -Uri "$Url/documents?workspace=$Workspace" -UseBasicParsing -TimeoutSec 10
    Write-Host "lightrag /documents 返回: HTTP $($r.StatusCode)"
} catch {
    Write-Host "ERR: 无法连接 lightrag ($Url) — $($_.Exception.Message)" -ForegroundColor Red
    exit 2
}

$ok = 0; $fail = 0
for ($i = 0; $i -lt $files.Count; $i += $BatchSize) {
    $batch = $files[$i..[Math]::Min($i + $BatchSize - 1, $files.Count - 1)]
    $batchNo = [int][Math]::Floor($i/$BatchSize) + 1
    $totalBatches = [int][Math]::Ceiling($files.Count/$BatchSize)
    Write-Host ("[{0,2}/{1,2}] 上传批次: " -f $batchNo, $totalBatches)
    foreach ($f in $batch) {
        try {
            # PowerShell 的 Invoke-WebRequest 不支持 -Form，用 curl.exe 走 multipart/form-data
            $tmpBody = [System.IO.Path]::GetTempFileName()
            $curlOut = & curl.exe -sS -w "`n%{http_code}" -X POST "$Url/documents/upload?workspace=$Workspace" -F "file=@$($f.FullName)" 2>&1
            $httpCode = ($curlOut -split "`n")[-1]
            if ([int]$httpCode -ge 200 -and [int]$httpCode -lt 300) {
                $ok++
                Write-Host "  + $($f.Name)  (HTTP $httpCode)"
            } else {
                $fail++
                Write-Host "  ! $($f.Name)  HTTP $httpCode  $((($curlOut -split "`n")[0..-2]) -join ' ')" -ForegroundColor Yellow
            }
        } catch {
            $fail++
            Write-Host "  X $($f.Name) — $($_.Exception.Message)" -ForegroundColor Red
        }
    }
    if ($i + $BatchSize -lt $files.Count) {
        Write-Host "  ...等待 ${BatchDelaySec}s 让 lightrag 处理..."
        Start-Sleep -Seconds $BatchDelaySec
    }
}

Write-Host "----------------------------------------"
Write-Host "上传完成: 成功=$ok 失败=$fail" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Yellow" })
Write-Host ""
Write-Host "实时进度查询 (另开一个 PowerShell 窗口跑):"
Write-Host "  .\scripts\ops\poll-extract.ps1 -Workspace $Workspace -Port $Port"
