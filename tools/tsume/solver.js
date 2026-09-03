/* 詰将棋 検証器（アプリ本体の合法手生成をそのまま利用する）
 *
 * 設計意図:
 *   ルールの解釈がアプリとズレると「ソルバでは詰むがアプリでは詰まない」問題を
 *   配信してしまう。そのため独自の指し手生成は書かず、index.html 内の
 *   legalAllP / inCheckP / doMoveP / undoMoveP を呼ぶ。
 *   → このファイルは必ず index.html を読み込んだページ上で eval して使う。
 *
 * 攻方 = 先手 "s" / 玉方 = 後手 "g"
 * 攻方は毎手王手が義務。玉方は合法手すべて。
 */
(function(){
  const ATK = "s", DEF = "g";
  let nodes = 0;

  function buildState(q){
    const b = {};
    for(const k in q.b) b[k] = {...q.b[k]};
    // 玉方の持ち駒はアプリの対局開始時と同じく空にする（アプリの挙動に合わせる）
    return {b, hands:{s:[...q.hand], g:[]}};
  }

  // 攻方の手番。n手以内（nは奇数）に詰むなら、その初手の配列を返す
  function atkMate(st, n, collectAll){
    if(n <= 0) return [];
    const found = [];
    for(const m of legalAllP(st, ATK, true)){
      nodes++;
      const u = doMoveP(st, m);
      let ok = false;
      if(inCheckP(st, DEF)){                       // 王手になっている手だけが候補
        const replies = legalAllP(st, DEF, true);
        if(replies.length === 0){
          ok = (m.drop !== "歩");                  // 打ち歩詰めは反則なので詰みとしない
        }else if(n >= 3){
          ok = replies.every(d => {                // 玉方のどの応手に対しても詰ませられるか
            const u2 = doMoveP(st, d);
            const sub = atkMate(st, n - 2, false);
            undoMoveP(st, u2);
            return sub.length > 0;
          });
        }
      }
      undoMoveP(st, u);
      if(ok){
        found.push(m);
        if(!collectAll) return found;              // 存在確認だけなら即打ち切り
      }
    }
    return found;
  }

  const KAN = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  // 盤面データの c は「左から数えた列」なので、表記に出すときは 10 - c で本来の筋に直す
  // (アプリ本体も指し手ラベル生成で同じ変換をしている: FWD[10 - c])
  const sq = t => `${10 - t[1]}${KAN[t[0]]}`;    // [段,列] → 「6二」のような正しい表記
  const PROMO_NAME = {"歩":"と", "香":"成香", "桂":"成桂", "銀":"成銀", "角":"馬", "飛":"竜"};
  function mvStr(st, m){                          // 指す前の局面で呼ぶこと
    if(m.drop) return `${m.s === ATK ? "▲" : "△"}${sq(m.to)}${m.drop}打`;
    const p = st.b[`${m.from[0]}-${m.from[1]}`];
    const name = p.p ? (PROMO_NAME[p.t] || p.t) : p.t;
    return `${m.s === ATK ? "▲" : "△"}${sq(m.to)}${name}${m.promo ? "成" : ""}`;
  }

  /* 詰み手順(読み筋)を1本取り出す。玉方は「最も長く粘る応手」を選ぶ。
   * ヒント文を書くときに、実際の手順を確かめるために使う。 */
  function principalVariation(st, n, objs){
    const line = [];
    let depth = n;
    while(depth > 0){
      const best = atkMate(st, depth, false)[0];
      if(!best) break;
      line.push(mvStr(st, best));
      if(objs) objs.push(JSON.parse(JSON.stringify(best)));
      doMoveP(st, best);
      const replies = legalAllP(st, DEF, true);
      if(!replies.length) break;                  // 詰み上がり
      // 玉方は最も長く粘る応手を選ぶ。応手ごとに「あと何手で詰むか」を測り、最大のものを採る。
      // (単に玉を動かす手を選ぶと、劣った受けを拾って手順が途中で終わってしまう)
      let pick = null, pickCost = -1;
      for(const d of replies){
        const u = doMoveP(st, d);
        let cost = Infinity;                      // Infinity は「詰まない」= 本来ありえない
        for(let k = 1; k <= depth - 2; k += 2){
          if(atkMate(st, k, false).length){ cost = k; break; }
        }
        undoMoveP(st, u);
        if(cost > pickCost){ pickCost = cost; pick = d; }
      }
      line.push(mvStr(st, pick));
      if(objs) objs.push(JSON.parse(JSON.stringify(pick)));
      doMoveP(st, pick);
      depth -= 2;
    }
    return line;
  }
  window.tsumePV = function(q, len){
    const st = buildState(q);
    return principalVariation(st, len || 1);
  };
  /* 詰み手順を対局エンジンの指し手形式で返す。
   * 観戦モード(シークバー付きの再生画面)に載せて動画にするために使う。 */
  window.tsumeLine = function(q, len){
    const objs = [];
    principalVariation(buildState(q), len || 1, objs);
    return objs;
  };

  // 成・不成の違いだけなら同じ手とみなす（最終手などでは慣例的に許容される）
  function sameMove(a, b){
    if(!!a.drop !== !!b.drop) return false;
    if((a.drop || "") !== (b.drop || "")) return false;
    if(a.to[0] !== b.to[0] || a.to[1] !== b.to[1]) return false;
    if(a.from && b.from) return a.from[0] === b.from[0] && a.from[1] === b.from[1];
    return true;
  }

  /* 全ての変化について、攻方の手が一手に決まっているかを調べる。
   * 詰将棋は玉方がどう受けても攻方の手が一意でなければならない。
   * 初手だけを見ていると、途中の変化に別解（余詰め）が残る。 */
  function branchIssues(q, want){
    const st = buildState(q);
    const issues = [];
    (function walk(n, path){
      const cands = atkMate(st, n, true);
      if(!cands.length) return;
      const uniq = [];
      cands.forEach(m => { if(!uniq.some(x => sameMove(x, m))) uniq.push(m); });
      // 最終手も検査する。成/不成の違いだけは uniq の時点で1手に畳んであるので、
      // ここで残るのは「駒の違う別の詰ませ方」＝本物の余詰め。
      if(uniq.length > 1){
        issues.push(`${want - n + 1}手目に別解（${path.join(" ") || "初手"}のあと）: ` +
                    cands.map(m => mvStr(st, m)).join(" / "));
      }
      if(n <= 1) return;
      const m = cands[0], ml = mvStr(st, m);
      const u = doMoveP(st, m);
      for(const d of legalAllP(st, DEF, true)){
        const dl = mvStr(st, d);
        const u2 = doMoveP(st, d);
        walk(n - 2, path.concat([ml, dl]));
        undoMoveP(st, u2);
      }
      undoMoveP(st, u);
    })(want, []);
    return issues;
  }

  /* 攻方の各手について「その局面から残り手数で詰ませられる手」を全部挙げる。
   * 初手だけでなく途中の手にも別解（余詰め）がないかを見るために使う。
   * 玉方の応手は読み筋どおりに進める（枝ごとに全部見るとキリがないため）。 */
  window.tsumeAltMoves = function(q, len){
    const want = len || 1;
    const st = buildState(q);
    const line = [];
    principalVariation(buildState(q), want, line);
    const out = [];
    for(let i = 0; i < line.length; i++){
      const m = line[i];
      if(m.s === ATK){
        const left = want - i;                       // この手を含む残り手数
        const cands = atkMate(st, left, true);       // 残り手数で詰ませられる攻方の手を全部
        out.push({ply: i + 1, best: mvStr(st, m), alts: cands.map(c => mvStr(st, c))});
      }
      doMoveP(st, m);
    }
    return out;
  };

  /* 1問を検証する。
   * declaredLen: 問題が名乗っている手数（TSUME[i].len、既定1）
   * 戻り値の ok が true のときだけ配信してよい。 */
  window.tsumeVerify = function(q, declaredLen){
    const want = declaredLen || 1;
    nodes = 0;
    const t0 = performance.now();
    const issues = [];

    // 宣言手数より短い詰みがないか（早詰み）を先に潰す
    let shortest = null;
    for(let n = 1; n <= want; n += 2){
      if(atkMate(buildState(q), n, false).length > 0){ shortest = n; break; }
    }

    if(shortest === null){
      issues.push(`${want}手以内で詰まない（詰み無し）`);
      return {ok:false, shortest:null, firstMoves:[], nodes, ms:Math.round(performance.now()-t0), issues};
    }
    if(shortest < want) issues.push(`${shortest}手で詰む（宣言は${want}手詰＝早詰み）`);

    // 全ての変化で攻方の手が一意か（初手だけでなく途中の手も見る）
    branchIssues(q, shortest).forEach(x => issues.push(x));

    // 最短手数での初手が一意か（一意でなければ余詰め）
    const rootSt = buildState(q);
    const roots = atkMate(rootSt, shortest, true);
    if(roots.length > 1) issues.push(`初手が${roots.length}通りある（余詰め）: ${roots.map(m => mvStr(rootSt, m)).join(" / ")}`);

    // アプリは「成れるときは自動で成る」ため、不成が正解の手は選べないことがある。
    // 成っても王手になる手だと、アプリは成を選び、正解手に到達できず問題が解けなくなる。
    // (成ると王手にならない場合だけ、アプリ側が不成にフォールバックする)
    const walk = buildState(q);
    const lineObjs = [];
    principalVariation(buildState(q), shortest, lineObjs);
    for(const m of lineObjs){
      if(m.s === ATK && m.from && m.promo === false){
        const canPromote = legalAllP(walk, ATK, true).some(x => x.from &&
          x.from[0] === m.from[0] && x.from[1] === m.from[1] &&
          x.to[0] === m.to[0] && x.to[1] === m.to[1] && x.promo);
        if(canPromote){
          const u = doMoveP(walk, {...m, promo: true});
          const stillCheck = inCheckP(walk, DEF);
          undoMoveP(walk, u);
          if(stillCheck) issues.push(`${mvStr(walk, m)}は不成が正解だが、アプリは自動で成るため指せない`);
        }
      }
      doMoveP(walk, m);
    }

    return {
      ok: issues.length === 0,
      shortest,
      firstMoves: roots.map(m => mvStr(rootSt, m)),
      nodes,
      ms: Math.round(performance.now() - t0),
      issues
    };
  };
})();
