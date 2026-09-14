#!/usr/bin/env python3
"""既存の問題と実質同じ形でないかを調べる。

盤をそのまま何筋かずらしただけの問題は、目で見比べると気づきにくい。
実際に二度、ずらしただけの候補を採りかけている。玉の位置を原点にして
盤・持ち駒・手順を表すと、平行移動しただけの問題は同じ表現になる。

盤の駒が一枚違うだけで解く手順がそっくり同じ、という形も紛らわしい。
解く人にとっては同じ問題なので、手順だけを見た照合も行う。
"""
import json, io, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def signature(b, hand, answer):
    """玉を原点に取り直した「形」。平行移動しただけの問題は同じ値になる"""
    king = next((k for k, p in b.items() if p["t"] == "玉"), None)
    if king is None: return None
    kr, kc = map(int, king.split("-"))

    pieces = []
    for k, p in b.items():
        r, c = map(int, k.split("-"))
        pieces.append((p["t"], p["s"], bool(p.get("p")), r - kr, c - kc))
    moves = []
    for m in answer or []:
        if m.get("drop"):
            moves.append(("drop", m["s"], m["drop"], m["to"][0] - kr, m["to"][1] - kc))
        else:
            moves.append(("move", m["s"], m["from"][0] - kr, m["from"][1] - kc,
                          m["to"][0] - kr, m["to"][1] - kc, bool(m.get("promo"))))
    return (tuple(sorted(pieces)), tuple(sorted(hand)), tuple(moves))


def move_signature(b, answer):
    """手順だけを玉基準で表す。盤の飾りが違っても手順が同じなら同じ問題に感じられる"""
    king = next((k for k, p in b.items() if p["t"] == "玉"), None)
    if king is None: return None
    kr, kc = map(int, king.split("-"))
    out = []
    for m in answer or []:
        if m.get("drop"):
            out.append(("d", m["s"], m["drop"], m["to"][0] - kr, m["to"][1] - kc))
        else:
            out.append(("m", m["s"], m["from"][0] - kr, m["from"][1] - kc,
                        m["to"][0] - kr, m["to"][1] - kc, bool(m.get("promo"))))
    return tuple(out)


def existing_signatures(path=None):
    doc = json.load(io.open(path or os.path.join(HERE, "problems.json"), encoding="utf-8"))
    forms, moves = {}, {}
    for q in doc["problems"]:
        sig = signature(q["b"], q["hand"], q.get("answer"))
        if sig: forms[sig] = q["name"]
        ms = move_signature(q["b"], q.get("answer"))
        if ms: moves.setdefault(ms, []).append(q["name"])
    return forms, moves


def main():
    sys.path.insert(0, HERE)
    from usi2move import pv_to_answer
    cands = json.load(io.open(sys.argv[1], encoding="utf-8"))
    known, known_moves = existing_signatures()
    seen, seen_moves, ok = {}, {}, []
    for i, c in enumerate(cands):
        ans = pv_to_answer(c["pv"])
        sig = signature(c["q"]["b"], c["q"]["hand"], ans)
        ms = move_signature(c["q"]["b"], ans)
        if sig in known:
            print("%2d  除外: 既存と同じ形（%s）" % (i, known[sig]))
        elif ms in known_moves:
            print("%2d  除外: 既存と同じ手順（%s）" % (i, "／".join(known_moves[ms])))
        elif sig in seen:
            print("%2d  除外: 候補%d と同じ形" % (i, seen[sig]))
        elif ms in seen_moves:
            print("%2d  除外: 候補%d と同じ手順" % (i, seen_moves[ms]))
        else:
            seen[sig] = i; seen_moves[ms] = i; ok.append(i)
            print("%2d  採用できる" % i)
    print("\n使える候補: %s" % (", ".join(map(str, ok)) or "なし"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
