# prompt.py 改动摘要

只改了与「回答生成」相关的两处 instruction。下方是原文 vs 新文的对照，便于快速研读。

---

## 改动 1 — `PROMPTS["rag_response"]`（标准 RAG 模式 query-suffix 第 1 段）

### 原文（LightRAG 官方）

```
1. Step-by-Step Instruction:
  - ...
  - Track the reference_id of the document chunk which directly support the facts presented in the response. Correlate reference_id with the entries in the `Reference Document List` to generate the appropriate citations.
  - Generate a **References** section at the end of the response. Each reference document must directly support the facts presented in the response.
  - Do not generate anything after the reference section.
...
4. References Section Format:
  - The References section should be under heading: `### References`
  - Reference list entries should adhere to the format: `* [n] Document Title`. Do not include a caret (`^`) after opening square bracket (`[`).
  - The Document Title in the citation must retain its original language.
  - Output each citation on an individual line
  - Provide maximum of 5 most relevant citations.
  - Do not generate footnotes section or any comment, summary, or explanation after the references.
```

### 新文（覆盖版）

```
1. Step-by-Step Instruction:
  - ...
  - Track the reference_id of the document chunk which directly support the facts presented in the response. Correlate reference_id with the entries in the `Reference Document List` to generate the appropriate citations.
  - Use ONLY inline citations like [1] [2] in the running text, placed right after the sentence that cites the source. Do NOT use REF/REFxx/REF0/REF1 formats.
  - Do NOT append a "References" section or any reference list at the end of the response (the front-end renders its own citation popovers).
  - Do NOT include any thinking process, self-reflection, <think>/<thinking>/«think» blocks, or chain-of-thought in the output. Only output the final answer.
  - Do NOT restate the user query or write openings like "以下是回答". Get straight to the point.
  - Do not generate anything after the body (no References list, no footnotes).
...
4. Citations Style (替换官方 "References Section Format"，明确行内引用、无末尾列表)：
  - Citations MUST be inline only, e.g. "...结论[1]。另一结论[2]...". The number is 1-based and corresponds to the entries in the `Reference Document List` (即 backend 返回的 references[i].file_path)。
  - Do NOT use REF / REFxx / REF0 / REF1 / (1) / [脚标1] 之类格式。
  - Do NOT append a `### References` section or any reference list at the end of the response.
  - Maximum of 5 most relevant citations per response.
```

---

## 改动 2 — `PROMPTS["mix_rag_response"]`（mix 模式 query-suffix 第 1 段）

### 原文

```
1. Step-by-Step Instruction:
  - ...
  - Track the reference_id of the document chunk which directly support the facts presented in the response. Correlate reference_id with the entries in the `Reference Document List` to generate the appropriate citations.
  - Generate a references section at the end of the response. Each reference document must directly support the facts presented in the response.
  - Do not generate anything after the reference section.
...
4. References Section Format: ...
```

### 新文

完全同改动 1 的新文结构，把"末尾 References 列表"换成"行内 [n] 引用"。

---

## 验证方式

重启所有 7 个 LightRAG 容器后，打开 `http://localhost:5006/#/query/g02_places_routes`，问"涪州到长安的荔枝路线"，应该看到：

- 答案开头没有"以下是回答"/`<thinking>` 块
- 引用是 `[1] [2]` 紧跟在句末
- 末尾没有 `### References` 列表
- 鼠标悬到 `[1]` 上 → 显示对应 chunk 气泡 → 点击开原网页（开的是该 `[1]` 引用的真实文件，不是错位）