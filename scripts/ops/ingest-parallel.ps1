# ============================================================
# ingest-parallel.ps1 — 6 个分图实例并行摄取（与总图管道同时工作）
# 每个分图：启动→等健康→上传对应维度 Markdown转写（已存在自动跳过）
# 全部上传完后统一轮询各端口直到抽取完成（不停止容器，保持可用）
# 用法（在项目根目录下执行）：
#   powershell -ExecutionPolicy Bypass -File .\scripts\ops\ingest-parallel.ps1
# 日志：logs/ingest_parallel.log
# ============================================================
$ErrorActionPreference = 'Continue'
# 解析项目根目录（脚本位于 scripts/ops/）
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -Path $root
$logFile = Join-Path $root 'logs\ingest_parallel.log'
$kg = Join-Path $root '知识图谱'

function Log($m) {
    $line = "{0} {1}" -f (Get-Date -Format 'MM-dd HH:mm:ss'), $m
    Add-Content -Path $logFile -Value $line -Encoding UTF8
    Write-Host $line
}

$jobs = [ordered]@{
    'g01' = @{ svc = 'lightrag-g01'; port = 9622; dir = '人物与文献' }
    'g02' = @{ svc = 'lightrag-g02'; port = 9623; dir = '地点与交通' }
    'g03' = @{ svc = 'lightrag-g03'; port = 9624; dir = '荔枝品种' }
    'g04' = @{ svc = 'lightrag-g04'; port = 9625; dir = '历史与制度' }
    'g05' = @{ svc = 'lightrag-g05'; port = 9626; dir = '岭南文化与荔湾' }
    'g06' = @{ svc = 'lightrag-g06'; port = 9627; dir = '现代产业与科技' }
}

function Wait-Healthy([int]$port) {
    for ($i = 0; $i -lt 80; $i++) {
        try {
            $h = Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 5
            if ($h.status -eq 'healthy') { return $true }
        } catch { }
        Start-Sleep -Seconds 3
    }
    return $false
}

function Upload-Dir([int]$port, [string]$dim, [string]$tag) {
    $mdDir = Join-Path (Join-Path $kg $dim) 'Markdown转写'
    $files = Get-ChildItem -LiteralPath $mdDir -Filter *.md | Sort-Object Name
    $n = 0; $fresh = 0
    foreach ($f in $files) {
        $n++
        $ok = $false
        for ($try = 1; $try -le 2 -and -not $ok; $try++) {
            $r = curl.exe -s -X POST "http://127.0.0.1:$port/documents/upload" -F "file=@$($f.FullName)"
            $j = $null
            try { $j = $r | ConvertFrom-Json } catch { }
            if ($j -and $j.status -eq 'success') { $ok = $true; $fresh++ }
            elseif ($j -and $j.detail -match 'already contains') { $ok = $true }
            else { Start-Sleep -Seconds 5 }
        }
        if ($ok) { Log "  [$tag] 上传 [$n/$($files.Count)] $($f.Name)" }
        else { Log "  [$tag] 上传失败 [$n/$($files.Count)] $($f.Name) => $r" }
        Start-Sleep -Milliseconds 300
    }
    Log "[$tag] 文件就绪：共 $($files.Count)（新传 $fresh），等待抽取..."
    return $files.Count
}

Log "===== 并行摄取开始（6 分图同时） ====="

# 第一轮：全部启动
foreach ($key in $jobs.Keys) {
    $j = $jobs[$key]
    docker compose --profile subgraphs up -d $j.svc 2>&1 | Out-Null
}
# 第二轮：等健康
foreach ($key in $jobs.Keys) {
    $j = $jobs[$key]
    if (Wait-Healthy $j.port) { Log "[$key] 实例就绪（端口 $($j.port)）" }
    else { Log "[$key] 启动失败！"; docker logs $j.svc --tail 15 2>&1 | ForEach-Object { Log "  log: $_" } }
}
# 第三轮：上传各自维度
foreach ($key in $jobs.Keys) {
    $j = $jobs[$key]
    Upload-Dir $j.port $j.dir $key | Out-Null
}

# 第四轮：统一轮询直到全部完成
$deadline = (Get-Date).AddMinutes(180)
$done = @{}
while ((Get-Date) -lt $deadline -and $done.Count -lt $jobs.Count) {
    Start-Sleep -Seconds 60
    $progress = @()
    foreach ($key in $jobs.Keys) {
        if ($done.ContainsKey($key)) { $progress += "$key:done"; continue }
        $j = $jobs[$key]
        try {
            $c = (Invoke-RestMethod "http://127.0.0.1:$($j.port)/documents/status_counts" -TimeoutSec 15).status_counts
            $p = Invoke-RestMethod "http://127.0.0.1:$($j.port)/documents/pipeline_status" -TimeoutSec 15
            $remaining = 0
            foreach ($k in $c.Keys) {
                if ($k -ne 'all' -and $k -notin @('processed', 'failed')) { $remaining += [int]$c.$k }
            }
            if ($remaining -eq 0 -and -not $p.busy -and [int]$p.pending_enqueues -eq 0 -and [int]$c.all -gt 0) {
                $done[$key] = $c
                Log "[$key] 完成: " + ($c | ConvertTo-Json -Compress)
                $progress += "$key:done"
            } else {
                $progress += ("{0}:{1}/{2}" -f $key, $c.processed, $c.all)
            }
        } catch { $progress += "$key:err" }
    }
    Log ("进度 " + ($progress -join ' | '))
}
foreach ($key in $jobs.Keys) {
    if (-not $done.ContainsKey($key)) { Log "[$key] 超时/未完成，请查看 WebUI 与日志" }
}
Log "===== 并行摄取结束（容器保持运行） ====="
