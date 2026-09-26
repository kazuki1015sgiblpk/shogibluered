#!/usr/bin/env python3
"""詰将棋の難易度を機械的に見積もる。

人が解くときに難しく感じる要素を数え、点数にする。
  - 王手の選択肢の多さ … 攻方の各手番で、王手になる手が何通りあるか。
                          多いほど正解を探す手間が増える（log2 で足し合わせる）
  - 捨て駒             … 攻方の駒を玉方に取らせる手。発想しにくい
  - 合駒               … 玉方が駒を打って受ける変化。玉方の手まで読む必要がある
  - 不成               … 成れるのに成らない手が正解。見落としやすい
  - 離れた打ち込み     … 玉から離れたマスへの打ち駒。筋が見えにくい
  - 玉方の応手の多さ   … 確かめる変化の多さ

使い方:
  tools/.venv/bin/python tools/tsume/difficulty.py          # 全問の内訳を表示
  tools/.venv/bin/python tools/tsume/difficulty.py --write  # 星(level)を problems.json に書き込む

星はこのアプリの問題どうしを比べた相対的な難しさ。★1 は一手詰のために空けてある。
境目は固定にしてある（問題を足すたびに既存の問題の星が変わらないように）。
"""
import json, io, os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verify_kh import sfen
import shogi

HERE = os.path.dirname(os.path.abspath(__file__))
RANKS = "abcdefghi"
LETTER = {"歩":"P","香":"L","桂":"N","銀":"S","金":"G","角":"B","飛":"R"}


def to_usi(m):
    """アプリの指し手形式を USI に直す（列は 10-筋）"""
    t = "%d%s" % (10 - m["to"][1], RANKS[m["to"][0] - 1])
    if m.get("drop"):
        return "%s*%s" % (LETTER[m["drop"]], t)
    f = "%d%s" % (10 - m["from"][1], RANKS[m["from"][0] - 1])
    return f + t + ("+" if m.get("promo") else "")


def king_square(board):
    for sq in range(81):
        p = board.piece_at(sq)
        if p and p.piece_type == shogi.KING and p.color == shogi.WHITE:
            return sq
    return None


def metrics(q):
    b = shogi.Board(sfen(q))
    line = [to_usi(m) for m in q.get("answer") or []]
    checks, replies = [], []
    sac = aigoma = funari = far = 0
    for ply, u in enumerate(line):
        mv = shogi.Move.from_usi(u)
        if ply % 2 == 0:                               # 攻方の手番
            n = 0
            for m in b.legal_moves:
                b.push(m)
                if b.is_check(): n += 1
                b.pop()
            checks.append(max(n, 1))
            # 成れるのに成らない手が正解か
            if not u.endswith("+") and "*" not in u:
                if shogi.Move.from_usi(u + "+") in b.legal_moves: funari += 1
            # 玉から離れたマスへの打ち駒か
            if "*" in u:
                ks = king_square(b)
                if ks is not None:
                    # python-shogi のマス番号は 9 マスごとに段が変わる
                    dx = abs(ks % 9 - mv.to_square % 9)
                    dy = abs(ks // 9 - mv.to_square // 9)
                    if max(dx, dy) > 1: far += 1
        else:                                          # 玉方の手番
            reps = list(b.legal_moves)
            replies.append(len(reps))
            if any(r.drop_piece_type for r in reps): aigoma += 1
            # 直前の攻方の駒を取る手が読み筋なら捨て駒
            if b.piece_at(mv.to_square) is not None: sac += 1
        b.push(mv)
    bits = sum(math.log2(n) for n in checks)
    extra = sum(r - 1 for r in replies)
    # 捨て駒は初心者がいちばん思いつきにくい手なので重くする（1.5 → 3.0）
    score = bits + 3.0 * sac + 1.0 * aigoma + 1.5 * funari + 0.5 * far + 0.3 * extra
    return {"checks": checks, "replies": replies, "sac": sac, "aigoma": aigoma,
            "funari": funari, "far": far, "score": round(score, 2)}


CUTS = [5, 8.5, 10, 12]          # ★2・★3・★4・★5 に上がる点数


def stars_for(score, cuts=CUTS):
    """点数を星に直す。cuts は★2〜★5に上がる境目"""
    return 1 + sum(score >= c for c in cuts)


def main():
    path = os.path.join(HERE, "problems.json")
    doc = json.load(io.open(path, encoding="utf-8"))
    rows = [(q, metrics(q)) for q in doc["problems"]]
    if "--write" in sys.argv[1:]:
        for q, m in rows: q["level"] = stars_for(m["score"])
        io.open(path, "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
        print("星を %d問に書き込みました。publish.py で index.html に反映してください。" % len(rows))
        return
    print("%-6s %-26s %-12s %-6s 捨 合 不 離  点数  星" % ("id", "問題", "王手の数", "応手"))
    for q, m in rows:
        print("%-6s %-24s %-12s %-6s %d  %d  %d  %d  %5.2f  %s" % (
            q["id"], q["name"][:22], m["checks"], m["replies"],
            m["sac"], m["aigoma"], m["funari"], m["far"], m["score"], "★" * stars_for(m["score"])))


if __name__ == "__main__":
    main()
