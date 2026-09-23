# ============================================================
# switch-graph.ps1 — 在 6 个分图谱 LightRAG 实例之间切换
# ------------------------------------------------------------
# 设计原因：LightRAG v1.5.6 一个容器实例固定一个 WORKSPACE，为节省
# 内存，6 个分图实例默认不常驻。本脚本同一时间只启动一个分图实例：
# 选中的启动，其余自动停止；总图实例(lightrag / 9621)始终不受影响。
#
# 用法（在项目根目录下打开 PowerShell，脚本位于 scripts/ops/）：
#   .\scripts\ops\switch-graph.ps1 g01   # 切到「人物与文献」 http://127.0.0.1:9622
#   .\scripts\ops\switch-graph.ps1 g02   # 地点与交通         http://127.0.0.1:9623
#   .\scripts\ops\switch-graph.ps1 g03   # 荔枝品种           http://127.0.0.1:9624
#   .\scripts\ops\switch-graph.ps1 g04   # 历史与制度         http://127.0.0.1:9625
#   .\scripts\ops\switch-graph.ps1 g05   # 岭南文化与荔湾     http://127.0.0.1:9626
#   .\scripts\ops\switch-graph.ps1 g06   # 现代产业与科技     http://127.0.0.1:9627
#   .\scripts\ops\switch-graph.ps1 all   # 课堂演示需要时，6 个分图全部启动（较占内存）
#   .\scripts\ops\switch-graph.ps1 stop  # 停止全部 6 个分图（只留总图 + 数据库）
#
# 若提示执行策略限制，可用：
#   powershell -ExecutionPolicy Bypass -File .\scripts\ops\switch-graph.ps1 g03
# ============================================================

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('g01', 'g02', 'g03', 'g04', 'g05', 'g06', 'all', 'stop')]
    [string]$Graph
)

$ErrorActionPreference = 'Stop'
# 解析项目根目录（脚本位于 scripts/ops/，父级的父级即根目录）
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -Path $root

$graphs = [ordered]@{
    g01 = @{ svc = 'lightrag-g01'; port = 9622; name = '人物与文献';      ws = 'g01_people_literature' }
    g02 = @{ svc = 'lightrag-g02'; port = 9623; name = '地点与交通';      ws = 'g02_places_routes' }
    g03 = @{ svc = 'lightrag-g03'; port = 9624; name = '荔枝品种';        ws = 'g03_varieties' }
    g04 = @{ svc = 'lightrag-g04'; port = 9625; name = '历史与制度';      ws = 'g04_history_institutions' }
    g05 = @{ svc = 'lightrag-g05'; port = 9626; name = '岭南文化与荔湾';  ws = 'g05_lingnan_liwan' }
    g06 = @{ svc = 'lightrag-g06'; port = 9627; name = '现代产业与科技';  ws = 'g06_industry_tech' }
}
$allSvcs = @($graphs.Values | ForEach-Object { $_.svc })

if ($Graph -eq 'stop') {
    docker compose --profile subgraphs stop @allSvcs
    Write-Host '6 个分图实例已全部停止（总图 http://127.0.0.1:9621 不受影响）。' -ForegroundColor Green
    exit 0
}

if ($Graph -eq 'all') {
    docker compose --profile subgraphs up -d
    Write-Host '6 个分图实例已全部启动：' -ForegroundColor Green
    $graphs.Values | ForEach-Object {
        Write-Host ("  {0}  {1,-12} http://127.0.0.1:{2}" -f $_.ws, $_.name, $_.port)
    }
    exit 0
}

# 单图切换：先停其他分图（同一时间只跑一个，省内存），再启动目标
$target = $graphs[$Graph]
$others = @($allSvcs | Where-Object { $_ -ne $target.svc })
docker compose --profile subgraphs stop @others | Out-Null
docker compose --profile subgraphs up -d $target.svc | Out-Null

# 等待健康检查通过（最多约 90 秒）
$url = "http://127.0.0.1:$($target.port)/health"
Write-Host "正在启动 $($target.name)（$($target.ws)）..." -ForegroundColor Yellow
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 3
    try {
        $h = Invoke-RestMethod -Uri $url -TimeoutSec 5
        if ($h.status -eq 'healthy' -and
            $h.configuration.storage_workspaces.graph_storage -eq $target.ws) {
            $ready = $true
            break
        }
    } catch { }
}

if ($ready) {
    Write-Host ""
    Write-Host "[$($target.name)] 已就绪，工作区隔离确认：$($target.ws)" -ForegroundColor Green
    Write-Host "LightRAG Web UI: http://127.0.0.1:$($target.port)" -ForegroundColor Cyan
    Write-Host "请只上传本维度「Markdown转写」文件夹里的 .md 文件。" -ForegroundColor Gray
} else {
    Write-Host "实例启动较慢或健康检查未通过，可用 docker logs $($target.svc) 查看日志。" -ForegroundColor Red
    exit 1
}
