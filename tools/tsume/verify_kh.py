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
# エンジンの場所。CI では Linux 版をビルドして置くので、環境変数で差し替えられるようにする
ENGINE = os.environ.get("KH_ENGINE") or os.path.join(
    ROOT, "tools", "engines", "kh", "mac", "KomoringHeights",
    "KomoringHeights-mac-clang++-14-normal-M1")
JST  = datetime.timezone(datetime.timedelta(hours=9))
DAY1 = datetime.date(2026, 8, 27)

PIECE = {"歩":"P","香":"L","桂":"N","銀":"S","金":"G","角":"B","飛":"R","玉":"K","王":"K"}
TOTAL = {"歩":18,"香":4,"桂":4,"銀":4,"金":4,"角":2,"飛":2}
ORDER = ["飛","角","金","銀","桂","香","歩"]


def piece_overflow(b, hand):
    """将棋にある枚数を超えて駒を使っていないかを調べ、超過分を返す。

    盤上と攻方の持ち駒を別々に選んで作問していたため、角3枚・飛3枚といった
    あり得ない局面ができていた。玉方の持ち駒を「残り」で計算する式が負の数を
    0 として扱っていたので、SFEN 上は正常に見えて両方の検証器を素通りしていた。
    """
    cnt = {}
    for p in b.values(): cnt[p["t"]] = cnt.get(p["t"], 0) + 1
    for t in hand:      cnt[t] = cnt.get(t, 0) + 1
    limit = dict(TOTAL); limit["玉"] = 2
    return {t: (n, limit[t]) for t, n in cnt.items() if t in limit and n > limit[t]}


def def_hand(b, atk_hand):
    """玉方の持ち駒＝全駒から盤上と攻方の持ち駒を引いた残り（index.html の tsumeDefHand と同じ）"""
    rest = dict(TOTAL)
    for p in b.values():
        if p["t"] in rest: rest[p["t"]] -= 1
    for t in atk_hand:
        if t in rest: rest[t] -= 1
    return rest


def defender_in_check(q):
    """初形で玉方に王手がかかっていないか。かかっていれば詰将棋として成立しない。

    python-shogi の is_check() は手番側を見る。詰将棋では手番が攻方（玉を持たない）
    なので、そのまま呼んでも玉方の王手は拾えない。手番を玉方にした局面で調べる。
    """
    return shogi.Board(sfen(q).replace(" b ", " w ", 1)).is_check()


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


def pv_is_mate(sfen_pos, moves, pv):
    """moves のあとに pv を指して、すべて合法手で、最後に詰みになっているか"""
    try:
        b = shogi.Board(sfen_pos)
        for u in list(moves) + list(pv):
            mv = shogi.Move.from_usi(u)
            if mv not in b.legal_moves: return False
            b.push(mv)
        return b.is_check() and not list(b.legal_moves)
    except Exception:
        return False


class EngineStuck(RuntimeError):
    """エンジンが応答しなくなった。局面によってはまれに固まる"""


class Engine:
    """1プロセスを使い回す。局面ごとに起動すると起動時間で潰れる。"""
    def __init__(self, multipv=5, hash_mb=256, threads=None):
        self._multipv, self._hash_mb, self._threads = multipv, hash_mb, threads
        self.rejected = []          # 盤で確かめて詰みにならなかったエンジンの答え（原因調査用）
        self._boot()

    def restart(self):
        """固まったエンジンを捨てて起動し直す"""
        try:
            self.p.kill(); self.p.wait(timeout=5)
        except Exception:
            pass
        self._boot()

    def _boot(self):
        multipv, hash_mb = self._multipv, self._hash_mb
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
        for o in (# 既定の4スレッドだと探索の打ち切り位置が毎回変わり、MultiPV の結果が揺れる。
                  # 同じ問題を「余詰めあり」と言ったり言わなかったりして関門に使えないため、
                  # 再現するように1スレッドに固定する
                  "setoption name Threads value 1",
                  "setoption name USI_Hash value %d" % hash_mb,
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
        raise EngineStuck("応答なし: " + cmd)

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
        # エンジンの答えを鵜呑みにしない。返ってきた手順を実際に盤で指し、
        # 合法手だけで進んで最後が詰みになっているかを確かめる。GitHub 上（Linux）の
        # エンジンが、手元では19手かかる詰みを「5手以内」と答えたことがあった（第66問）
        if best is not None and not pv_is_mate(sfen_pos, list(moves), best):
            self.rejected.append((list(moves), best))
            best = None
        return best, roots

    def close(self):
        try:
            self.p.stdin.write("quit\n"); self.p.stdin.flush(); self.p.wait(timeout=5)
        except Exception:
            self.p.kill()


def same_move(a, b):
    """成・不成の違いだけなら同じ手とみなす（詰将棋の慣例）"""
    return a.rstrip("+") == b.rstrip("+")


def idle_pieces(eng, q, want):
    """取り除いても同じ手数で成立する駒（＝働いていない駒）を返す。

    乱数で駒を置いて作問しているため、詰みに関係しない駒が紛れ込むことがある。
    解く人は「この駒の意図は何か」と考えてしまうので、作品としては疵になる。
    KomoringHeights に作問を切り替えたとき、この検査を入れ忘れていて、
    実際に5問が働いていない駒を抱えたまま配信された。
    """
    out = []
    # 限定打のために置いた駒（problems.json の blockers）は外さない。
    # 手数を数える規約では無くても成立してしまうが、香などの打ち場所を一つに決める役目がある
    blockers = set(q.get("blockers") or [])
    for k, p in q["b"].items():
        if p["t"] == "玉" or k in blockers: continue
        q2 = {"b": {kk: v for kk, v in q["b"].items() if kk != k}, "hand": q["hand"]}
        if not check_problem(eng, q2, want, check_idle=False, stop_early=True):
            r, c = map(int, k.split("-"))
            out.append("%s%d%s%s" % ("▲" if p["s"] == "s" else "△", 10 - c,
                                     "一二三四五六七八九"[r - 1], p["t"]))
    return out


def mating_moves(eng, base, moves, n):
    """この局面（攻方の手番）で、n手以内に詰ませられる攻方の手をすべて返す。

    以前は KomoringHeights の MultiPV（候補手を複数挙げる機能）に任せていたが、
    直前にどの局面を読んだかによって、詰む手を挙げ漏らすことがあった
    （例: 第46問の最終手 ▲9二桂成。単独で聞くと返るのに、探索の途中では返らない）。
    そこで王手になる手は python-shogi で全部挙げ、1手ずつ確かめる。
      - 最後の1手は、指したあと玉方に合法手がなければ詰み（エンジン不要・厳密）
      - それより前は、指したあとの局面（玉方の手番）をエンジンに聞き、
        残り手数以内に詰むかを確かめる
    """
    board = shogi.Board(base)
    for m in moves: board.push(shogi.Move.from_usi(m))
    out = []
    for m in list(board.legal_moves):
        board.push(m)
        if board.is_check():
            if not list(board.legal_moves):
                out.append(m.usi())                       # その場で詰み
            elif n >= 3:
                best, _ = eng.mate(base, list(moves) + [m.usi()])
                if best is not None and 1 + len(best) <= n:
                    out.append(m.usi())
        board.pop()
    return out


def hand_left(sfen_pos, moves):
    """moves を指したあとの攻方の持ち駒の枚数"""
    b = shogi.Board(sfen_pos)
    for u in moves: b.push(shogi.Move.from_usi(u))
    return sum(b.pieces_in_hand[shogi.BLACK].values())


def spare_line(eng, base, moves, n):
    """攻方の手番から、玉方が最善に受けたときの手順と、詰め上がりで駒が余るかを返す。

    玉方は最も長く粘る受けを選び、同じ手数の受けが複数あれば攻方の駒が余らない
    受けを選ぶ（詰将棋の約束）。それでも余るなら作品として「駒余り」の疵になる。
    戻り値: (手順, 余るか)
    """
    cands = mating_moves(eng, base, moves, n)
    if not cands: return [], True
    # 攻方の手は一意（成・不成の違いだけ）。両方あるときは、見せ方として自然な「成る」ほうを使う
    m = sorted(cands, key=lambda u: not u.endswith("+"))[0]
    board = shogi.Board(base)
    for u in list(moves) + [m]: board.push(shogi.Move.from_usi(u))
    replies = [r.usi() for r in board.legal_moves]
    if not replies:
        return [m], hand_left(base, list(moves) + [m]) > 0
    lens = {}
    for r in replies:
        pv, _ = eng.mate(base, list(moves) + [m, r])
        lens[r] = len(pv) if pv else 99
    longest = max(lens.values())
    first = None
    for r in replies:
        if lens[r] != longest: continue
        sub, spare = spare_line(eng, base, list(moves) + [m, r], longest)
        if not spare: return [m, r] + sub, False
        if first is None: first = [m, r] + sub
    return first, True


def check_problem(eng, q, want, check_idle=True, stop_early=False):
    """余詰め・早詰み・詰み無し・働いていない駒を調べ、問題点の一覧を返す。

    stop_early=True は作問用。合否さえ分かればよいので、最初の問題点で打ち切る。
    以前は報告用に問題点を6個まで集めており、不合格が決まったあとも残りの変化を
    調べ続けて、探索時間の大半をそこに使っていた。
    """
    base = sfen(q)
    issues, seen = [], set()
    limit = 1 if stop_early else 6

    def walk(moves, n):
        key = tuple(moves)
        if key in seen or len(issues) >= limit: return
        seen.add(key)
        best, _ = eng.mate(base, moves)
        if best is None:
            issues.append("%d手目で詰まない（%s のあと）" % (want - n + 1, " ".join(moves) or "初形"))
            return
        # 余詰め＝「宣言手数以内で詰ませられる別の手」。長い手数でしか詰まない手は余詰めではない。
        # 候補はエンジンの MultiPV に頼らず、王手を全部挙げて確かめる（挙げ漏らしがあるため）
        uniq = []
        for m in mating_moves(eng, base, moves, n):
            if not any(same_move(m, u) for u in uniq): uniq.append(m)
        if len(uniq) > 1:
            detail = []
            for m in sorted(uniq):
                pv, _ = eng.mate(base, list(moves) + [m])
                detail.append("%s→%s" % (m, " ".join(pv) if pv else "（その場で詰み）"))
            issues.append("%d手目に別解（%s のあと）: %s" %
                          (want - n + 1, " ".join(moves) or "初形", " / ".join(detail)))
        if n <= 1: return
        board = shogi.Board(base)
        for m in moves + [best[0]]: board.push(shogi.Move.from_usi(m))
        for d in list(board.legal_moves):     # 玉方の応手を全部たどる
            walk(moves + [best[0], d.usi()], n - 2)

    over = piece_overflow(q["b"], q["hand"])
    if over:
        return ["駒数が合わない: " + "、".join(
            "%sが%d枚（実際は%d枚）" % (t, n, mx) for t, (n, mx) in sorted(over.items()))]
    if defender_in_check(q):
        return ["初形で玉方に王手がかかっている（詰将棋として成立しない）"]
    best, _ = eng.mate(base)
    if best is None:
        return ["詰まない"]
    if len(best) < want:
        issues.append("宣言は%d手詰だが %d手で詰む（早詰み: %s）" % (want, len(best), " ".join(best)))
    elif len(best) > want:
        issues.append("%d手以内で詰まない（最短%d手: %s）" % (want, len(best), " ".join(best)))
    if stop_early and issues: return issues
    walk([], want)
    if check_idle and not issues:
        idle = idle_pieces(eng, q, want)
        if idle: issues.append("働いていない駒がある（外しても成立する）: " + "、".join(idle))
    # 駒余り: 詰め上がりで攻方の持ち駒が余らないこと。配信済みで差し替えないと決めた問題は
    # problems.json の waive に「駒余り」と書いて検査を外す
    if check_idle and not issues and "駒余り" not in (q.get("waive") or []):
        line, spare = spare_line(eng, base, [], want)
        if spare:
            issues.append("駒余り（どう受けても詰め上がりに攻方の持ち駒が余る）: " + " ".join(line))
        elif q.get("answer"):
            from difficulty import to_usi
            ans = [to_usi(m) for m in q["answer"]]
            if hand_left(base, ans) > 0:
                issues.append("登録した正解手順が駒余り（駒が余らない受けがある）: " + " ".join(line))
    return issues


def main():
    argv = sys.argv[1:]
    only_upcoming = "--upcoming" in argv
    if not os.path.exists(ENGINE):
        print("エンジンが見つかりません: %s" % ENGINE)
        print("tools/tsume/setup_engine.sh で用意してください")
        return 2

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
