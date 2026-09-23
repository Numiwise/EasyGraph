"""Test the new LightRAG prompt via /query/stream.

Prints the full response and checks:
  - No thinking block leaked
  - No "REFxx" placeholders
  - No trailing "### References" list
  - Inline [1][2]... citations are present
"""
import json
import urllib.request

req = urllib.request.Request(
    "http://127.0.0.1:9621/query/stream",
    data=json.dumps({
        "query": "涪州到长安",
        "mode": "mix",
        "include_references": True,
        "include_chunk_content": True,
        "top_k": 3,
        "chunk_top_k": 3,
    }).encode(),
    headers={"Content-Type": "application/json"},
)
out = urllib.request.urlopen(req, timeout=60).read().decode()

full = ""
refs = None
for line in out.split("\n"):
    line = line.strip()
    if not line:
        continue
    try:
        o = json.loads(line)
        if "response" in o:
            full += o["response"]
        if "references" in o:
            refs = o["references"]
    except Exception:
        pass

print("=== FULL RESPONSE ===")
print(full)
print()
print("=== CHECK ===")
print(f"  has <think>:    {'<think>' in full}")
print(f"  has <thinking>: {'<thinking>' in full}")
print(f"  has REFxx:     {(' REF' in full) or ('REF0' in full) or ('REF1' in full)}")
print(f"  has References heading: {'### References' in full}")
print(f"  has [1] style:  {'[1]' in full}")
print(f"  ref count: {len(refs) if refs else 0}")