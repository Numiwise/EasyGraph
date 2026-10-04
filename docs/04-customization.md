# 定制与扩展

本指南演示如何让本项目从「荔枝文化示例」变成**你自己的领域知识图谱**。

## 场景 1：换数据（完全替换领域）

### 步骤

1. **准备原始资料**：把 `data/inputs/_origin/` 下的文件替换为你的资料
   - 支持 html / pdf / png / jpg / md / docx（不同类型有不同解析策略）
2. **改工作区名**（如 `g00_my_domain`）：编辑 `docker-compose.yml` 中所有 `WORKSPACE: "g00_*"` 改你的命名
3. **生成 manifest**：跑 `python scripts/ops/build_origins.py`（自动遍历 `_origin/` 生成索引）
4. **改工作区元数据**（首页 7 张卡的标题 / 颜色 / 描述）：编辑 `frontend/src/api/neo4j.js` 的 `WS_META`
5. **写你的抽取 prompt**（见场景 2）
6. **重启**：`docker compose down && docker compose up -d --build`

### 命名建议

工作区 ID 用 `gXX_<topic>` 格式（gXX 是数字序号）：
- `g00_master_all`：总图
- `g01_<topic>` / `g02_<topic>` ...：分图

## 场景 2：写领域抽取 Prompt

编辑 `data/prompts/entity_type/your_domain.yml`，仿照 `lychee_culture.yml`：

```yaml
# 1) 实体类型列表（最多 50 种）
entity_types:
  - Person
  - Organization
  - Product
  # ... 你领域的实体类型

# 2) 每个类型的属性模板（key: 类型 + 简短描述）
property_templates:
  Person:
    - birth_date: date（出生日期）
    - nationality: string（国籍）

# 3) 关系类型词典（key: 关系名）
keywords:
  - "工作于": WORKS_AT
  - "发明": INVENTED

# 4) few-shot（让模型照着抽，强烈建议）
aliases:
    - from: "张三发明了产品A"
      to:   "(张三)-[INVENTED]->(产品A)"

# 5) 抽取准则（json_mode=true 时生效）
rules:
  - "对齐：同一个实体在不同文档应识别为同一节点"
  - "否定：文本明确否定的事实（如'不是X'）不要抽取"
```

完整示例参考 `lychee_culture.yml`。

`.env` 里改 `ENTITY_TYPE_PROMPT_FILE=your_domain.yml`，重启 LightRAG 即生效。

## 场景 3：扩图谱（增加第 7、8 个子图）

1. 编辑 `docker-compose.yml`，复制 `lightrag-g06` 段：

```yaml
  lightrag-g07: &lightrag-sub
    image: ghcr.1ms.run/hkuds/lightrag:latest
    profiles: ["subgraphs"]
    container_name: lightrag-g07
    restart: unless-stopped
    depends_on: *lightrag-depends
    ports:
      - "127.0.0.1:9628:9621"
    volumes: *lightrag-volumes
    environment:
      <<: *lightrag-env
      WORKSPACE: "g07_my_topic"
      ENTITY_TYPE_PROMPT_FILE: "my_topic.yml"
    extra_hosts: *lightrag-hosts
```

2. 在 `frontend/src/api/neo4j.js` 的 `WS_META` 数组里加：

```js
{
  id: 'g07_my_topic',
  name: '我的主题',
  badge: '新',
  desc: '一句话介绍',
  color: '#ff7eb6'
}
```

3. 在 `data/prompts/entity_type/` 加 `my_topic.yml`，并把对应原始资料放 `data/inputs/_origin/`。

4. 重启：`docker compose up -d --force-recreate webviz lightrag-g07`

## 场景 4：换 LLM / Embedding

编辑 `.env`：

```bash
# 改 OpenAI 兼容服务
LLM_BINDING_HOST=https://api.openai.com/v1
LLM_BINDING_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini

# 或换 DeepSeek（官方）
LLM_BINDING_HOST=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat

# 换本地 Ollama（推荐开发/隐私场景）
LLM_BINDING_HOST=http://host.docker.internal:11434/v1
LLM_MODEL=qwen2:7b
```

> 注意 LightRAG 容器用 `extra_hosts: host.docker.internal:host-gateway` 才能从容器内访问宿主的 11434。

重启 LightRAG：`docker compose up -d --force-recreate lightrag`

## 场景 5：自定义前端

| 想改的 | 改哪里 |
|--------|--------|
| 改首页卡片颜色 / 标题 | `frontend/src/composables/useNeo4j.js` 的 `WS_META` |
| 改首页整体美术 | `frontend/src/views/HomeView.vue` 的 `<style scoped>` |
| 改图谱页节点配色 | `frontend/src/views/GraphView.vue` 的 `<style scoped>` |
| 改问答页交互 | `frontend/src/views/QueryView.vue`（逻辑 + `<style scoped>`） |
| 增加新页面 | 在 `frontend/src/router.js` 加路由 + 新建 `views/XxxView.vue` |

样式组织（Vue 3 习惯）：全局 + 跨视图共性样式在 `frontend/src/styles/main.css`，各 view 的专属样式都在对应 `.vue` 文件的 `<style scoped>` 内，和组件内聚。

## 场景 6：调整 LLM 回答风格

编辑 `frontend/src/api/lightrag.js` 中 `streamRag()` 的 `responseType`：

```js
const POLISH_SAFE = '中文直接回答。仅依据所给检索资料整理输出，忠实原文事实，'
  + '严禁编造、严禁上网或凭空补充内容；开门见山，分点论据；'
  + '引用用行内[1][2]，禁止REFxx；不输出思考块、不写开场白；文末不要References清单。';
```

注意 LightRAG Pydantic 限制 ≤ 256 字符。

## 场景 7：备份与迁移

```bash
# 备份 Neo4j 数据
docker run --rm -v easygraph_neo4j_data:/data -v $(pwd)/backup:/backup \
    alpine tar czf /backup/neo4j.tar.gz /data

# 恢复
docker run --rm -v easygraph_neo4j_data:/data -v $(pwd)/backup:/backup \
    alpine tar xzf /backup/neo4j.tar.gz -C /

# 备份 Qdrant：直接拷贝卷目录即可（Qdrant 格式稳定）
```

或用 Neo4j 自带的 `neo4j-admin dump`。