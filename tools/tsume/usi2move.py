#!/usr/bin/env python3
"""USI の指し手を、アプリ（index.html / problems.json）の指し手形式に直す。

USI の筋は右から数える(9筋が左端)が、盤面データの列は左から数えるので 10-筋 にする。
アプリ本体の表示処理 FWD[10-c] と同じ換算。
"""
FILES = "123456789"
RANKS = "abcdefghi"
DROP = {"P":"歩","L":"香","N":"桂","S":"銀","G":"金","B":"角","R":"飛"}


def usi_to_move(u, side):
    promo = u.endswith("+")
    if promo: u = u[:-1]
    if u[1] == "*":
        f, r = int(u[2]), RANKS.index(u[3]) + 1
        return {"s": side, "drop": DROP[u[0]], "to": [r, 10 - f]}
    f1, r1, f2, r2 = int(u[0]), RANKS.index(u[1]) + 1, int(u[2]), RANKS.index(u[3]) + 1
    m = {"s": side, "from": [r1, 10 - f1], "to": [r2, 10 - f2]}
    if promo: m["promo"] = True
    return m


def pv_to_answer(pv):
    """読み筋(USI)を、攻方=先手 / 玉方=後手 として交互に変換する"""
    return [usi_to_move(u, "s" if i % 2 == 0 else "g") for i, u in enumerate(pv)]
