import json
import sys

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    r = json.loads(line)
    if r.get("done"):
        print("DONE", r["at"])
        continue
    u = r.get("usage") or {}
    out = u.get("completion_tokens")
    rt = (u.get("completion_tokens_details") or {}).get("reasoning_tokens")
    ttft = r.get("ttft_any_ms") or 0
    gen = (r["total_ms"] - ttft) / 1000
    tps = round(out / gen) if out and gen > 0 else None
    bpt = round(r["bytes"] / out) if out else None
    print(
        f"{r['lane']:8} {r['model']:26} max={r['max_tokens']:5} http={r['http']} out={out} reason={rt} "
        f"ttft={r['ttft_any_ms']}ms content_at={r['ttft_content_ms']} total={round(r['total_ms'] / 1000)}s "
        f"gen_tps={tps} finish={r['finish']} chunks={r['chunks']} B/token={bpt} maxgap={r['max_gap_ms']}ms err={r['error']}"
    )
