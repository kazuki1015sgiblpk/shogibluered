#!/usr/bin/env python3
"""解答画面に出す「変化」を、検証用の詰将棋エンジンで求めて problems.json に書き込む。

変化 = 正解手順の玉方の手番で、玉方がほかの受けをしたときの詰ませ方。
アプリの中で読むと時間がかかるうえ、端末によって読み切れないことがあるので、
問題を足すときに一度だけ計算してデータとして持たせる。

  tools/.venv/bin/python tools/tsume/variations.py          # 内容を表示するだけ
  tools/.venv/bin/python tools/tsume/variations.py --write  # problems.json に書き込む

書き込んだら publish.py で index.html に反映する。

形式: "variations": [{"at": 2, "line": [指し手…], "alt": ["歩", "香", …]}]
  at   … 正解手順の何手目（玉方の手）のかわりか（1始まり）
  line … その受けから詰みまで。先頭が玉方のかわりの手
  alt  … 同じマスへの合駒で、駒の種類が違っても詰ませ方が同じものは1つにまとめ、
         その駒の種類を並べる（2種類以上のときだけ）
変化がない問題も [] を書いておく（計算済みの印）。
"""
import json, io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shogi
from verify_kh import Engine, sfen
from difficulty import to_usi
from usi2move import pv_to_answer, DROP

HERE = os.path.dirname(os.path.abspath(__file__))
PIECE_ORDER = "歩香桂銀金角飛"


def variations(eng, q):
    base = sfen(q)
    line = [to_usi(m) for m in q.get("answer") or []]
    out = []
    for k in range(1, len(line), 2):                 # 玉方の手番（2手目、4手目…）
        b = shogi.Board(base)
        for u in line[:k]: b.push(shogi.Move.from_usi(u))
        groups = {}                                  # 合駒をまとめる: (マス, 以降の手順) -> 駒の種類
        for mv in b.legal_moves:
            u = mv.usi()
            if u == line[k]: continue
            pv, _ = eng.mate(base, line[:k] + [u])
            if pv is None:
                raise SystemExit("%s: %d手目の %s のあと詰みが見つかりません（問題の検証をやり直してください）"
                                 % (q["name"], k + 1, u))
            key = (u[1:] if "*" in u else u, tuple(pv))  # 打ち駒は駒の種類を除いたマスで束ねる
            groups.setdefault(key, []).append(u)
        for (_, pv), us in groups.items():
            moves = pv_to_answer([us[0]] + list(pv))
            for m in moves: m["s"] = "g" if m["s"] == "s" else "s"   # 玉方の手から始まるので先後を入れ替える
            v = {"at": k + 1, "line": moves}
            if len(us) > 1:
                v["alt"] = sorted((DROP[u[0]] for u in us), key=PIECE_ORDER.index)
                v["line"][0]["drop"] = v["alt"][0]
            out.append(v)
    # 手番ごとに、長い（読みごたえのある）変化から並べる。合駒は後ろへ
    out.sort(key=lambda v: (v["at"], "drop" in v["line"][0], -len(v["line"])))
    return out


def main():
    path = os.path.join(HERE, "problems.json")
    doc = json.load(io.open(path, encoding="utf-8"))
    eng = Engine()
    for q in doc["problems"]:
        if q.get("len", 1) == 1 or not q.get("answer"):
            continue
        q["variations"] = variations(eng, q)
        print("%-6s %-28s 変化%d" % (q["id"], q["name"], len(q["variations"])))
    if "--write" in sys.argv[1:]:
        io.open(path, "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
        print("problems.json に書き込みました。publish.py で index.html に反映してください。")


if __name__ == "__main__":
    main()
