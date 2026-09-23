"""Patch LightRAG /app/lightrag/prompt.py to enforce:
  - Use ONLY inline [n] citations in the running text (no REF/REFxx)
  - Do NOT append a References list at the end
  - Do NOT output thinking / chain-of-thought blocks
  - No restating the user query or filler openings
This is what we want so the front-end can render its own citation popovers.
Run inside the lightrag container:
  docker cp scripts/patch_lightrag_prompt.py lightrag-server:/tmp/
  docker exec lightrag-server python3 /tmp/patch_lightrag_prompt.py
"""
import sys

P = "/app/lightrag/prompt.py"
with open(P, "r", encoding="utf-8") as f:
    src = f.read()

old1 = (
    "  - Generate a **References** section at the end of the response. Each reference document must directly support the facts presented in the response.\n"
    "  - Do not generate anything after the reference section.\n"
)
new1 = (
    "  - Use ONLY inline citations like [1] [2] in the running text, placed right after the sentence that cites the source. Do NOT use REF/REFxx/REF0/REF1 formats.\n"
    "  - Do NOT append a \"References\" section or any reference list at the end of the response (the front-end renders its own citation popovers).\n"
    "  - Do NOT include any thinking process, self-reflection, <think>/<thinking>/«think» blocks, or chain-of-thought in the output. Only output the final answer.\n"
    "  - Do NOT restate the user query or write openings like \"以下是回答\". Get straight to the point.\n"
    "  - Do not generate anything after the body (no References list, no footnotes).\n"
)
old2 = (
    "  - Generate a references section at the end of the response. Each reference document must directly support the facts presented in the response.\n"
    "  - Do not generate anything after the reference section.\n"
)
new2 = (
    "  - Use ONLY inline citations like [1] [2] in the running text, placed right after the sentence that cites the source. Do NOT use REF/REFxx/REF0/REF1 formats.\n"
    "  - Do NOT append a \"References\" section or any reference list at the end of the response (the front-end renders its own citation popovers).\n"
    "  - Do NOT include any thinking process, self-reflection, <think>/<thinking>/«think» blocks, or chain-of-thought in the output. Only output the final answer.\n"
    "  - Do NOT restate the user query or write openings like \"以下是回答\". Get straight to the point.\n"
    "  - Do not generate anything after the body (no References list, no footnotes).\n"
)

if old1 not in src and old2 not in src:
    print("Neither old block found — prompt.py may have been modified already or version differs.", file=sys.stderr)
    sys.exit(2)

out = src
n1 = n2 = 0
if old1 in out:
    out = out.replace(old1, new1, 1); n1 = 1
if old2 in out:
    out = out.replace(old2, new2, 1); n2 = 1

with open(P, "w", encoding="utf-8") as f:
    f.write(out)
print(f"patched prompt.py: block1={n1} block2={n2}, size={len(out)}")