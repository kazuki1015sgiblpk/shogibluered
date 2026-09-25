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
from verify_kh import (Engine, EngineStuck, sfen, check_problem,
                       defender_in_check, piece_overflow)
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


TOTAL = {"歩": 18, "香": 4, "桂": 4, "銀": 4, "金": 4, "角": 2, "飛": 2}


def random_problem(atk=(1, 2), dfn=(0, 1), hand=(1, 2)):
    used = {}                                   # 将棋にある枚数を超えないよう数える

    def take(choices):
        """まだ残っている駒種から選ぶ。角3枚のような局面を作らないため"""
        avail = [t for t in choices if used.get(t, 0) < TOTAL[t]]
        if not avail: return None
        t = random.choice(avail)
        used[t] = used.get(t, 0) + 1
        return t

    b = {}
    kr, kc = random.randint(1, 3), random.randint(1, 4)      # 玉は端寄りに
    b["%d-%d" % (kr, kc)] = {"t": "玉", "s": "g"}

    def put(t, side):
        if t is None: return
        for _ in range(12):
            r = max(1, min(9, kr + random.randint(0, 4) - 1))  # 玉の周辺へ寄せる
            c = max(1, min(9, kc + random.randint(0, 5) - 2))
            if ("%d-%d" % (r, c)) in b or not placeable(t, side, r): continue
            b["%d-%d" % (r, c)] = {"t": t, "s": side}
            return

    for _ in range(random.randint(*atk)): put(take(ATK_BOARD), "s")
    for _ in range(random.randint(*dfn)): put(take(DEF_BOARD), "g")
    hands = [t for t in (take(ATK_HAND) for _ in range(random.randint(*hand))) if t]
    return {"b": b, "hand": hands}


def hand_all_used(q, pv):
    """持ち駒を全部使う手順か。使わない駒があるなら、その駒は問題に要らない"""
    drops = {m[0] for m in pv[::2] if "*" in m}
    letters = {"歩": "P", "香": "L", "桂": "N", "銀": "S", "金": "G", "角": "B", "飛": "R"}
    return all(letters[t] in drops for t in set(q["hand"]))


def save(found, want_len):
    """見つかるたびに書き出す。最後にまとめて書くと、途中で止めた時に全部失う。

    この実行で見つけたぶんだけを書く（＝前回の内容は上書きされる）。
    前回の候補を残したいときは、走らせる前にファイルを退避しておくこと。
    """
    out = os.path.join(ROOT, "dist", "kh-candidates-%d.json" % want_len)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    io.open(out, "w", encoding="utf-8").write(json.dumps(found, ensure_ascii=False, indent=1))
    return out


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
            if not q["hand"]: continue             # 持ち駒なしは対象外
            if piece_overflow(q["b"], q["hand"]): continue   # 念のための二重の歯止め
            try:
                if defender_in_check(q): continue   # 初形で玉方に王手はかかっていてはいけない
            except Exception:
                continue
            # まれにエンジンが固まる。その局面は捨てて、起動し直して探索を続ける
            # （以前はここで例外が飛んで探索全体が止まっていた）
            try:
                best, _ = eng.mate(sfen(q), ms=1500)
                if best is None or len(best) != want_len: continue
                if not hand_all_used(q, best): continue
                issues = check_problem(eng, q, want_len)
            except EngineStuck as e:
                print("  %d試行 エンジンを再起動します（%s）" % (tried, e)); sys.stdout.flush()
                eng.restart(); continue
            if issues: continue
            found.append({"q": q, "pv": best})
            save(found, want_len)                  # 途中で止めても残るように都度書き出す
            print("  %d試行 / 候補 %d件  %s" % (tried, len(found), " ".join(best)))
            sys.stdout.flush()
    finally:
        eng.close()

    out = save(found, want_len)
    print("%d試行で %d件。%s に書き出しました。" % (tried, len(found), os.path.relpath(out, ROOT)))
    return 0 if found else 1


if __name__ == "__main__":
    sys.exit(main())
