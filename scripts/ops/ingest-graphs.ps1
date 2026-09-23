# ============================================================
# ingest-graphs.ps1 — 批量上传转写 Markdown 并等待抽取管道完成
# 用法（在项目根目录下执行）：
#   powershell -ExecutionPolicy Bypass -File .\scripts\ops\ingest-graphs.ps1 -Phase subgraphs
#   powershell -ExecutionPolicy Bypass -File .\scripts\ops\ingest-graphs.ps1 -Phase master
# 日志：logs/ingest_subgraphs.log / logs/ingest_master.log
# ============================================================
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('subgraphs', 'master')]
    [string]$Phase
)

$ErrorActionPreference = 'Continue'
# 解析项目根目录（脚本位于 scripts/ops/）
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -Path $root
$logFile = Join-Path $root ("logs\ingest_{0}.log" -f $Phase)
$kg = Join-Path $root '知识图谱'

function Log($m) {
    $line = "{0} {1}" -f (Get-Date -Format 'MM-dd HH:mm:ss'), $m
    Add-Content -Path $logFile -Value $line -Encoding UTF8
    Write-Host $line
}

$dimDirs = @('人物与文献', '地点与交通', '荔枝品种', '历史与制度', '岭南文化与荔湾', '现代产业与科技')
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

function Upload-Dir([int]$port, [string]$dim) {
    $mdDir = Join-Path (Join-Path $kg $dim) 'Markdown转写'
    $files = Get-ChildItem -LiteralPath $mdDir -Filter *.md | Sort-Object Name
    $n = 0
    foreach ($f in $files) {
        $n++
        $ok = $false
        for ($try = 1; $try -le 2 -and -not $ok; $try++) {
            $r = curl.exe -s -X POST "http://127.0.0.1:$port/documents/upload" -F "file=@$($f.FullName)"
            $j = $null
            try { $j = $r | ConvertFrom-Json } catch { }
            if ($j -and $j.status -eq 'success') { $ok = $true }
            elseif ($j -and $j.detail -match 'already contains') { $ok = $true; Log "  跳过(已存在): $($f.Name)" }
            else { Start-Sleep -Seconds 5 }
        }
        if ($ok) { Log "  上传 [$n/$($files.Count)] $($f.Name)" }
        else { Log "  上传失败 [$n/$($files.Count)] $($f.Name) => $r" }
        Start-Sleep -Milliseconds 300
    }
    return $files.Count
}

function Wait-PipelineDone([int]$port, [string]$tag, [int]$maxMinutes) {
    $deadline = (Get-Date).AddMinutes($maxMinutes)
    $stable = 0
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 20
        try {
            $c = (Invoke-RestMethod "http://127.0.0.1:$port/documents/status_counts" -TimeoutSec 15).status_counts
            $p = Invoke-RestMethod "http://127.0.0.1:$port/documents/pipeline_status" -TimeoutSec 15
            $remaining = 0
            foreach ($k in $c.Keys) {
                if ($k -ne 'all' -and $k -notin @('PROCESSED', 'FAILED')) { $remaining += [int]$c.$k }
            }
            if ($remaining -eq 0 -and -not $p.busy -and [int]$p.pending_enqueues -eq 0) {
                $stable++
                if ($stable -ge 2) {
                    Log "[$tag] 管道完成: " + ($c | ConvertTo-Json -Compress)
                    return $true
                }
            } else { $stable = 0 }
        } catch { Log "[$tag] 轮询异常: $_" }
    }
    Log "[$tag] 等待超时(${maxMinutes}分钟)"
    return $false
}

Log "===== Phase $Phase 开始 ====="

if ($Phase -eq 'subgraphs') {
    foreach ($key in $jobs.Keys) {
        $j = $jobs[$key]
        Log "---- $($key) $($j.dir) (端口 $($j.port)) ----"
        docker compose --profile subgraphs up -d $j.svc 2>&1 | Out-Null
        if (-not (Wait-Healthy $j.port)) { Log "[$key] 启动失败，跳过"; docker logs $j.svc --tail 20 2>&1 | ForEach-Object { Log "  log: $_" }; continue }
        Log "[$key] 实例就绪（工作区隔离确认通过）"
        $count = Upload-Dir $j.port $j.dir
        Log "[$key] 共上传 $count 个文件，等待抽取..."
        Wait-PipelineDone $j.port $key 120 | Out-Null
        docker compose --profile subgraphs stop $j.svc 2>&1 | Out-Null
        Log "[$key] 已停止实例"
    }
}
else {
    $port = 9621
    if (-not (Wait-Healthy $port)) { Log "[master] 总图实例不健康，退出"; exit 1 }
    $total = 0
    foreach ($dim in $dimDirs) {
        Log "---- master 全量上传: $dim ----"
        $total += Upload-Dir $port $dim
    }
    Log "[master] 共上传 $total 个文件，等待抽取..."
    Wait-PipelineDone $port 'master' 300 | Out-Null
}

Log "===== Phase $Phase 结束 ====="
