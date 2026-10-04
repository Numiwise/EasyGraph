# ============================================================
# LightRAG 抽取进度轮询脚本
# ------------------------------------------------------------
# 用法（手动在 PowerShell 跑）：
#   .\scripts\ops\poll-extract.ps1 -Workspace g00_master_all -Port 9621
#
# 输出每 5 秒一行：
#   [HH:mm:ss] g00_master_all: docs=12/84 entities=89 relations=124 pending=72
#
# 字段含义：
#   docs     : 已抽取完成的文档数 / 输入目录里的 md 总数
#   entities : neo4j 当前该 workspace 的实体数（label 即 workspace 名）
#   relations: neo4j 当前该 workspace 的关系数
#   pending  : postgres 里 doc_status 处于 pending/processing 的文档数
# ============================================================

param(
    [Parameter(Mandatory=$true)][string]$Workspace,
    [Parameter(Mandatory=$false)][int]$Port = 9621,
    [Parameter(Mandatory=$false)][int]$IntervalSec = 5
)

$ErrorActionPreference = "Continue"
$neo4jBolt   = "http://localhost:7474"
$neo4jUser   = "neo4j"
$neo4jPass   = (Select-String .env -Pattern '^NEO4J_PASSWORD=').ToString().Split('=',2)[1].Trim()
$lightragUrl = "http://localhost:$Port"

# 总 md 文件数（用于 "docs=12/84" 这种进度条）
$inputsDir = "data/inputs/$Workspace/__parsed__"
if (Test-Path $inputsDir) {
    $totalMd = (Get-ChildItem -File $inputsDir -Filter *.md | Measure-Object).Count
} else {
    $totalMd = 0
}

Write-Host "=========================================="
Write-Host "LightRAG 抽取轮询 — workspace=$Workspace  port=$Port"
Write-Host "总文件数 = $totalMd   每 ${IntervalSec}s 刷新一次   Ctrl+C 退出"
Write-Host "=========================================="

while ($true) {
    $ts = Get-Date -Format "HH:mm:ss"

    # 1) 已完成文档数（neo4j 该 label 的实体数粗略估计；更准的方式是查 lightrag /documents）
    try {
        $r1 = Invoke-WebRequest -Uri "$neo4jBolt/db/data/transaction/commit" `
             -Method Post -ContentType "application/json" `
             -Body (@{ statements = @(@{ statement = "MATCH (n:$Workspace) RETURN count(n) AS c" }) } | ConvertTo-Json -Depth 5) `
             -Headers @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${neo4jUser}:${neo4jPass}")) } `
             -UseBasicParsing -TimeoutSec 5
        $j1 = $r1.Content | ConvertFrom-Json
        $entities = $j1.results[0].data[0].row[0]
    } catch {
        $entities = "?"
    }

    # 2) 关系数
    try {
        $r2 = Invoke-WebRequest -Uri "$neo4jBolt/db/data/transaction/commit" `
             -Method Post -ContentType "application/json" `
             -Body (@{ statements = @(@{ statement = "MATCH ()-[r]->() WHERE any(l IN labels(startNode(r)) WHERE l = '$Workspace') RETURN count(r) AS c" }) } | ConvertTo-Json -Depth 5) `
             -Headers @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${neo4jUser}:${neo4jPass}")) } `
             -UseBasicParsing -TimeoutSec 5
        $j2 = $r2.Content | ConvertFrom-Json
        $relations = $j2.results[0].data[0].row[0]
    } catch {
        $relations = "?"
    }

    # 3) LightRAG 内部 doc 状态（pending = 还没抽完）
    try {
        $r3 = Invoke-WebRequest -Uri "$lightragUrl/documents" -UseBasicParsing -TimeoutSec 5
        $j3 = $r3.Content | ConvertFrom-Json
        $docs = ($j3 | Where-Object { $_.status -eq "processed" }).Count
        $pending = ($j3 | Where-Object { $_.status -in @("pending","processing") }).Count
    } catch {
        $docs = "?"; $pending = "?"
    }

    Write-Host "[$ts] $Workspace : docs=$docs/$totalMd entities=$entities relations=$relations pending=$pending"
    Start-Sleep -Seconds $IntervalSec
}
