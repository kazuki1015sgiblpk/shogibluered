#!/usr/bin/env python3
"""problems.json から index.html の TSUME / TSUME_SCHEDULE を生成する。

index.html の該当箇所は手で編集しない。問題の追加・配信予定の変更は
problems.json 側で行い、このスクリプトを実行して反映する。

  python3 tools/tsume/publish.py          # 反映する
  python3 tools/tsume/publish.py --check  # 一致しているかだけ確認（書き込まない）
"""
import json, io, os, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HTML = os.path.join(ROOT, "index.html")
JSON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "problems.json")

BEGIN_T, END_T = "  /* <<TSUME:problems>> */\n", "  /* <</TSUME:problems>> */\n"
BEGIN_S, END_S = "  /* <<TSUME:schedule>> */\n", "  /* <</TSUME:schedule>> */\n"

js = lambda s: json.dumps(s, ensure_ascii=False)          # JSON文字列はJSリテラルとしてそのまま使える


def build_problems(problems):
    out = ["  const TSUME = [\n"]
    for i, p in enumerate(problems):
        head = "    {name:%s," % js(p["name"])
        if p.get("len", 1) != 1: head += " len:%d," % p["len"]     # 1手詰は既定値なので書かない
        if p.get("orig"): head += " orig:true,"
        cells = ", ".join('%s:{t:%s,s:%s}' % (js(k), js(v["t"]), js(v["s"])) for k, v in p["b"].items())
        hand = ",".join(js(h) for h in p["hand"])
        tail = "," if i < len(problems) - 1 else ""
        out += [head + "\n",
                "     b:{%s},\n" % cells,
                "     hand:[%s],\n" % hand]
        if p.get("answer"):                      # 「手順を再生」で使う正解手順
            mv = []
            for m in p["answer"]:
                parts = ["s:%s" % js(m["s"])]
                if "drop" in m: parts.append("drop:%s" % js(m["drop"]))
                else: parts.append("from:[%d,%d]" % tuple(m["from"]))
                parts.append("to:[%d,%d]" % tuple(m["to"]))
                if m.get("promo"): parts.append("promo:true")
                mv.append("{%s}" % ",".join(parts))
            out.append("     answer:[%s],\n" % ", ".join(mv))
        out.append("     hint:%s}%s\n" % (js(p["hint"]), tail))
    out.append("  ];\n")
    return "".join(out)


def build_schedule(problems, schedule):
    idx = {p["id"]: i for i, p in enumerate(problems)}
    missing = [pid for pid in schedule if pid not in idx]
    if missing:
        sys.exit("schedule に存在しない問題idがあります: %s" % ", ".join(sorted(set(missing))))
    body = ", ".join(str(idx[pid]) for pid in schedule)
    return ("  // 出題番号(#1, #2, …) -> TSUME の添字。problems.json の schedule から生成。\n"
            "  // ★末尾に追加していくこと。既存要素を書き換えると配信済みの回の問題が遡って変わる。\n"
            "  const TSUME_SCHEDULE = [%s];\n" % body)


def splice(src, begin, end, body, label):
    i, j = src.find(begin), src.find(end)
    if i < 0 or j < 0:
        sys.exit("index.html に %s の目印が見つかりません" % label)
    return src[:i + len(begin)] + body + src[j:]


def main():
    doc = json.load(io.open(JSON_PATH, encoding="utf-8"), object_pairs_hook=collections.OrderedDict)
    problems, schedule = doc["problems"], doc["schedule"]

    ids = [p["id"] for p in problems]
    if len(set(ids)) != len(ids):
        sys.exit("problems.json に重複したidがあります")

    src = io.open(HTML, encoding="utf-8").read()
    out = splice(src, BEGIN_T, END_T, build_problems(problems), "TSUME:problems")
    out = splice(out, BEGIN_S, END_S, build_schedule(problems, schedule), "TSUME:schedule")

    if out == src:
        print("変更なし（index.html は problems.json と一致しています）")
        return
    if "--check" in sys.argv:
        sys.exit("index.html が problems.json と一致していません（publish.py を実行してください）")
    io.open(HTML, "w", encoding="utf-8").write(out)
    print("index.html を更新しました: %d問 / 配信%d回分" % (len(problems), len(schedule)))


if __name__ == "__main__":
    main()
