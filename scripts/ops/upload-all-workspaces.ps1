# ============================================================
# 7 个 workspace 并行上传 + 抽取
# ------------------------------------------------------------
# 用法：
#   .\scripts\ops\upload-all-workspaces.ps1
# 启动 7 个 upload-and-extract.ps1 后台进程（每个对应一个端口）。
# ============================================================

$plan = @(
    'g00_master_all|9621',
    'g01_people_literature|9622',
    'g02_places_routes|9623',
    'g03_varieties|9624',
    'g04_history_institutions|9625',
    'g05_lingnan_liwan|9626',
    'g06_industry_tech|9627'
)

Write-Host "=========================================="
Write-Host " 7 个 lightrag 实例并行上传 + 抽取"
Write-Host "=========================================="
foreach ($p in $plan) {
    $parts = $p -split '\|'
    Write-Host ("  " + $parts[0] + " -> port " + $parts[1])
}
Write-Host ""

foreach ($p in $plan) {
    $parts = $p -split '\|'
    $ws = $parts[0]
    $port = $parts[1]
    $logFile = "logs\upload-$ws.log"
    Write-Host "start $ws (port $port), log -> $logFile"
    Start-Process powershell -ArgumentList @(
        '-ExecutionPolicy','Bypass',
        '-File',".\scripts\ops\upload-and-extract.ps1",
        '-Workspace',$ws,
        '-Port',$port,
        '-BatchSize','4',
        '-BatchDelaySec','8'
    ) -RedirectStandardOutput $logFile -WindowStyle Hidden
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "7 个上传任务已在后台启动。"
Write-Host ""
Write-Host "查看进度（新开 PowerShell 窗口）："
foreach ($p in $plan) {
    $parts = $p -split '\|'
    Write-Host ("  .\scripts\ops\poll-extract.ps1 -Workspace " + $parts[0] + " -Port " + $parts[1])
}
Write-Host ""
Write-Host "查看上传日志："
foreach ($p in $plan) {
    $parts = $p -split '\|'
    Write-Host "  Get-Content logs\upload-$($parts[0]).log -Wait"
}
