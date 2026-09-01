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
  function principalVariation(st, n){
    const line = [];
    let depth = n;
    while(depth > 0){
      const best = atkMate(st, depth, false)[0];
      if(!best) break;
      line.push(mvStr(st, best));
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
      doMoveP(st, pick);
      depth -= 2;
    }
    return line;
  }
  window.tsumePV = function(q, len){
    const st = buildState(q);
    return principalVariation(st, len || 1);
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

    // 最短手数での初手が一意か（一意でなければ余詰め）
    const rootSt = buildState(q);
    const roots = atkMate(rootSt, shortest, true);
    if(roots.length > 1) issues.push(`初手が${roots.length}通りある（余詰め）: ${roots.map(m => mvStr(rootSt, m)).join(" / ")}`);

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
