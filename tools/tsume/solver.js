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

  const sq = t => `${t[1]}${t[0]}`;                // [段,筋] → 表示用「筋段」
  const mvStr = m => m.drop ? `${sq(m.to)}${m.drop}打` : `${sq(m.to)}${sq(m.from)}${m.promo ? "成" : ""}`;

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
    const roots = atkMate(buildState(q), shortest, true);
    if(roots.length > 1) issues.push(`初手が${roots.length}通りある（余詰め）: ${roots.map(mvStr).join(" / ")}`);

    return {
      ok: issues.length === 0,
      shortest,
      firstMoves: roots.map(mvStr),
      nodes,
      ms: Math.round(performance.now() - t0),
      issues
    };
  };
})();
