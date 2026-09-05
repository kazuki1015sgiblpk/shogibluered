#!/usr/bin/env python3
"""KomoringHeights を使った第二の検証器。

tools/tsume/verify.js（アプリ本体の指し手生成を使う JS 版）とは
まったく別の実装で同じ問題を判定する。片方の実装の思い違いを、
もう片方が拾えるようにするのが狙い。実際、JS 版だけに頼っていた間に
余詰めを二度見逃している。

  攻方の手番(ORノード)ごとに MultiPV で「詰ませられる手」を全部挙げ、
  二つ以上あれば余詰め。玉方の応手は python-shogi で全部展開する。

使い方:
  tools/.venv/bin/python tools/tsume/verify_kh.py            # 全問
  tools/.venv/bin/python tools/tsume/verify_kh.py --upcoming # 明日以降の配信ぶんだけ

終了コード: 1問でも通らなければ 1
"""
import json, io, os, sys, subprocess, time, datetime
import shogi

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ENGINE = os.path.join(ROOT, "tools", "engines", "kh", "mac", "KomoringHeights",
                      "KomoringHeights-mac-clang++-14-normal-M1")
JST  = datetime.timezone(datetime.timedelta(hours=9))
DAY1 = datetime.date(2026, 8, 27)

PIECE = {"歩":"P","香":"L","桂":"N","銀":"S","金":"G","角":"B","飛":"R","玉":"K","王":"K"}
TOTAL = {"歩":18,"香":4,"桂":4,"銀":4,"金":4,"角":2,"飛":2}
ORDER = ["飛","角","金","銀","桂","香","歩"]


def def_hand(b, atk_hand):
    """玉方の持ち駒＝全駒から盤上と攻方の持ち駒を引いた残り（index.html の tsumeDefHand と同じ）"""
    rest = dict(TOTAL)
    for p in b.values():
        if p["t"] in rest: rest[p["t"]] -= 1
    for t in atk_hand:
        if t in rest: rest[t] -= 1
    return rest


def sfen(q):
    rows = []
    for r in range(1, 10):
        row, empty = "", 0
        for f in range(9, 0, -1):
            c = 10 - f                       # 盤面データの列は左から数える
            p = q["b"].get("%d-%d" % (r, c))
            if not p:
                empty += 1; continue
            if empty: row += str(empty); empty = 0
            s = PIECE[p["t"]]
            if p.get("p"): s = "+" + s
            row += s if p["s"] == "s" else s.lower()
        if empty: row += str(empty)
        rows.append(row)
    hands = ""
    for t in ORDER:                          # 攻方(大文字)
        n = q["hand"].count(t)
        if n: hands += ("" if n == 1 else str(n)) + PIECE[t]
    rest = def_hand(q["b"], q["hand"])
    for t in ORDER:                          # 玉方(小文字) = 残り全部
        n = rest[t]
        if n > 0: hands += ("" if n == 1 else str(n)) + PIECE[t].lower()
    return "/".join(rows) + " b " + (hands or "-") + " 1"


class Engine:
    """1プロセスを使い回す。局面ごとに起動すると起動時間で潰れる。"""
    def __init__(self, multipv=5, hash_mb=256):
        # 起動直後に落ちることがまれにあるので、生きているのを確かめてから話しかける
        for attempt in range(5):
            self.p = subprocess.Popen([ENGINE], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.DEVNULL, text=True, bufsize=1)
            time.sleep(0.3)
            if self.p.poll() is None: break
            time.sleep(1.0)
        else:
            raise RuntimeError("エンジンを起動できません: %s" % ENGINE)
        self._cmd("usi", "usiok")
        for o in ("setoption name USI_Hash value %d" % hash_mb,
                  "setoption name MultiPV value %d" % multipv,
                  "setoption name PostSearchLevel value MinLength",
                  "setoption name GenerateAllLegalMoves value true"):
            self.p.stdin.write(o + "\n")
        self._cmd("isready", "readyok")

    def _cmd(self, cmd, until, timeout=60):
        self.p.stdin.write(cmd + "\n"); self.p.stdin.flush()
        lines, t0 = [], time.time()
        while time.time() - t0 < timeout:
            line = self.p.stdout.readline()
            if not line: break
            lines.append(line.rstrip())
            if line.startswith(until): return lines
        raise RuntimeError("engine timeout: " + cmd)

    def mate(self, sfen_pos, moves=(), ms=8000):
        """詰み手順と、根で詰ませられる手を {手: 詰み手数} で返す"""
        self.p.stdin.write("usinewgame\n")
        pos = "position sfen " + sfen_pos + ((" moves " + " ".join(moves)) if moves else "")
        self.p.stdin.write(pos + "\n")
        lines = self._cmd("go mate %d" % ms, "checkmate", timeout=ms / 1000.0 + 60)
        best, roots = None, {}
        for l in lines:
            if l.startswith("checkmate"):
                rest = l.split(" ", 1)[1] if " " in l else "nomate"
                if rest.startswith("nomate") or rest.startswith("timeout"):
                    best = None
                else:
                    mv = rest.split()
                    # 手順として読めない応答（探索打ち切り時など）は「詰み無し」として扱う
                    best = mv if all(4 <= len(x) <= 5 for x in mv) else None
            elif l.startswith("info") and " pv " in l and " score mate " in l:
                sc = int(l.split(" score mate ")[1].split()[0])
                mv = l.split(" pv ")[1].split()[0]
                # MultiPV は「もっと長い手数でなら詰む手」も挙げてくる。
                # 何手で詰むかを持ち帰り、宣言手数以内かどうかは呼び出し側で判断する
                if sc > 0 and (mv not in roots or sc < roots[mv]): roots[mv] = sc
        return best, roots

    def close(self):
        try:
            self.p.stdin.write("quit\n"); self.p.stdin.flush(); self.p.wait(timeout=5)
        except Exception:
            self.p.kill()


def same_move(a, b):
    """成・不成の違いだけなら同じ手とみなす（詰将棋の慣例）"""
    return a.rstrip("+") == b.rstrip("+")


def check_problem(eng, q, want):
    """余詰め・早詰み・詰み無しを調べ、問題点の一覧を返す"""
    base = sfen(q)
    issues, seen = [], set()

    def walk(moves, n):
        key = tuple(moves)
        if key in seen or len(issues) >= 6: return
        seen.add(key)
        best, roots = eng.mate(base, moves)
        if best is None:
            issues.append("%d手目で詰まない（%s のあと）" % (want - n + 1, " ".join(moves) or "初形"))
            return
        # 余詰め＝「宣言手数以内で詰ませられる別の手」。長い手数でしか詰まない手は余詰めではない
        uniq = []
        for m, sc in roots.items():
            if sc > n: continue
            if not any(same_move(m, u) for u in uniq): uniq.append(m)
        if len(uniq) > 1:
            issues.append("%d手目に別解（%s のあと）: %s" %
                          (want - n + 1, " ".join(moves) or "初形", " / ".join(sorted(uniq))))
        if n <= 1: return
        board = shogi.Board(base)
        for m in moves + [best[0]]: board.push(shogi.Move.from_usi(m))
        for d in list(board.legal_moves):     # 玉方の応手を全部たどる
            walk(moves + [best[0], d.usi()], n - 2)

    best, _ = eng.mate(base)
    if best is None:
        return ["詰まない"]
    if len(best) < want:
        issues.append("宣言は%d手詰だが %d手で詰む（早詰み: %s）" % (want, len(best), " ".join(best)))
    elif len(best) > want:
        issues.append("%d手以内で詰まない（最短%d手: %s）" % (want, len(best), " ".join(best)))
    walk([], want)
    return issues


def main():
    argv = sys.argv[1:]
    only_upcoming = "--upcoming" in argv
    if not os.path.exists(ENGINE):
        print("エンジンが見つかりません: %s" % ENGINE); return 2

    doc = json.load(io.open(os.path.join(HERE, "problems.json"), encoding="utf-8"))
    today_no = (datetime.datetime.now(JST).date() - DAY1).days + 1
    upcoming = set(doc["schedule"][today_no:])

    eng = Engine()
    bad = 0
    try:
        for q in doc["problems"]:
            if only_upcoming and q["id"] not in upcoming: continue
            issues = check_problem(eng, q, q.get("len", 1))
            print(("ok  " if not issues else "NG  ") + "%s（%d手 / %s）" % (q["name"], q.get("len", 1), q["id"]))
            for s in issues: print("      - " + s)
            if issues: bad += 1
    finally:
        eng.close()
    print(("\n%d問が通っていません。" % bad) if bad else "\n全問 ok。")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
