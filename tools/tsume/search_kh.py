#!/usr/bin/env python3
"""KomoringHeights で作問候補を探す。

玉方に持ち駒を持たせる（合駒を読む）ようにしてから、JS の探索器では
1問見つけるのに何十分もかかるようになった。詰み判定を C++ の
KomoringHeights に任せると桁違いに速い。

盤面の作り方は generate.js と揃えてある（玉は端寄り、駒は玉の周辺）。

使い方:
  tools/.venv/bin/python tools/tsume/search_kh.py --len 5 --want 10
"""
import json, io, os, sys, random, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verify_kh import Engine, sfen, check_problem, defender_in_check
import shogi

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

ATK_BOARD = ["金", "銀", "桂", "香", "歩", "飛", "角"]
ATK_HAND  = ["金", "銀", "桂", "歩", "飛", "角", "香"]
DEF_BOARD = ["歩", "香", "桂", "銀", "金"]


def placeable(t, side, r):
    """行き所のない駒を置かない"""
    if t in ("歩", "香"): return r >= 2 if side == "s" else r <= 8
    if t == "桂":         return r >= 3 if side == "s" else r <= 7
    return True


def random_problem(atk=(1, 2), dfn=(0, 1), hand=(1, 2)):
    b = {}
    kr, kc = random.randint(1, 3), random.randint(1, 4)      # 玉は端寄りに
    b["%d-%d" % (kr, kc)] = {"t": "玉", "s": "g"}

    def put(t, side):
        for _ in range(12):
            r = max(1, min(9, kr + random.randint(0, 4) - 1))  # 玉の周辺へ寄せる
            c = max(1, min(9, kc + random.randint(0, 5) - 2))
            if ("%d-%d" % (r, c)) in b or not placeable(t, side, r): continue
            b["%d-%d" % (r, c)] = {"t": t, "s": side}
            return

    for _ in range(random.randint(*atk)): put(random.choice(ATK_BOARD), "s")
    for _ in range(random.randint(*dfn)): put(random.choice(DEF_BOARD), "g")
    return {"b": b, "hand": [random.choice(ATK_HAND) for _ in range(random.randint(*hand))]}


def hand_all_used(q, pv):
    """持ち駒を全部使う手順か。使わない駒があるなら、その駒は問題に要らない"""
    drops = {m[0] for m in pv[::2] if "*" in m}
    letters = {"歩": "P", "香": "L", "桂": "N", "銀": "S", "金": "G", "角": "B", "飛": "R"}
    return all(letters[t] in drops for t in set(q["hand"]))


def main():
    a = sys.argv[1:]
    want_len = int(a[a.index("--len") + 1]) if "--len" in a else 5
    want_n   = int(a[a.index("--want") + 1]) if "--want" in a else 10
    max_try  = int(a[a.index("--max") + 1]) if "--max" in a else 200000

    eng = Engine(multipv=6)
    found, tried = [], 0
    try:
        while len(found) < want_n and tried < max_try:
            tried += 1
            q = random_problem()
            try:
                if defender_in_check(q): continue   # 初形で玉方に王手はかかっていてはいけない
            except Exception:
                continue
            best, _ = eng.mate(sfen(q), ms=1500)
            if best is None or len(best) != want_len: continue
            if not hand_all_used(q, best): continue
            issues = check_problem(eng, q, want_len)
            if issues: continue
            found.append({"q": q, "pv": best})
            print("  %d試行 / 候補 %d件  %s" % (tried, len(found), " ".join(best)))
            sys.stdout.flush()
    finally:
        eng.close()

    out = os.path.join(ROOT, "dist", "kh-candidates-%d.json" % want_len)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    prev = json.load(io.open(out, encoding="utf-8")) if os.path.exists(out) else []
    io.open(out, "w", encoding="utf-8").write(json.dumps(prev + found, ensure_ascii=False, indent=1))
    print("%d試行で %d件。%s に書き出しました。" % (tried, len(found), os.path.relpath(out, ROOT)))
    return 0 if found else 1


if __name__ == "__main__":
    sys.exit(main())
