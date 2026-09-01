/* 詰将棋の候補を探す（作問の下ごしらえ）
 *
 * ランダムに配置した局面を solver.js の tsumeVerify にかけ、
 * 「ちょうどN手で詰み・初手が一意」のものだけを拾う。
 * 拾った候補から人が選び、名前とヒントを付けて problems.json に入れる。
 *
 * 使い方（index.html を開いたページで solver.js を読み込んだ後）:
 *   tsumeSearch({trials: 300, len: 5})
 */
(function(){
  const rnd = n => Math.floor(Math.random() * n);
  const pick = a => a[rnd(a.length)];

  const ATK_BOARD = ["金", "銀", "桂", "香", "歩", "飛", "角"];
  const ATK_HAND  = ["金", "銀", "桂", "歩", "飛", "角", "香"];
  const DEF_BOARD = ["歩", "香", "桂", "銀", "金"];

  // 行き所のない駒を置かない（先手は上へ、後手は下へ進む）
  function placeable(t, side, r){
    if(t === "歩" || t === "香") return side === "s" ? r >= 2 : r <= 8;
    if(t === "桂") return side === "s" ? r >= 3 : r <= 7;
    return true;
  }

  // 駒数の範囲は opts で調整する。駒を減らすほど「無駄な駒なし」を通りやすい。
  function randomProblem(o){
    const atkN = o.atkMin + rnd(o.atkMax - o.atkMin + 1);
    const defN = o.defMin + rnd(o.defMax - o.defMin + 1);
    const handN = o.handMin + rnd(o.handMax - o.handMin + 1);
    const b = {};
    const kr = 1 + rnd(3), kc = 1 + rnd(4);          // 玉は端寄りに置く（詰将棋らしい形になりやすい）
    b[`${kr}-${kc}`] = {t:"玉", s:"g"};

    const put = (t, side) => {
      for(let tryCnt = 0; tryCnt < 12; tryCnt++){
        const r = Math.max(1, Math.min(9, kr + rnd(5) - 1));   // 玉の周辺に寄せる
        const c = Math.max(1, Math.min(9, kc + rnd(6) - 2));
        if(b[`${r}-${c}`] || !placeable(t, side, r)) continue;
        b[`${r}-${c}`] = {t, s:side};
        return true;
      }
      return false;
    };

    for(let i = 0; i < atkN; i++) put(pick(o.atkSet || ATK_BOARD), "s");
    for(let i = 0; i < defN; i++) put(pick(o.defSet || DEF_BOARD), "g");

    const hand = [];
    for(let i = 0; i < handN; i++) hand.push(pick(o.handSet || ATK_HAND));
    return {b, hand};
  }

  // 攻方が動く前から王手がかかっている局面は詰将棋として成立しない
  function alreadyCheck(q){
    const st = {b:{}, hands:{s:[...q.hand], g:[]}};
    for(const k in q.b) st.b[k] = {...q.b[k]};
    return inCheckP(st, "g");
  }

  /* 作品としての締まりを機械的に検査する。
   *  - 無駄な駒: 1枚取り除いても同じ手数・初手一意で成立するなら、その駒は働いていない
   *  - 余る持ち駒: 読み筋の中で打たれない持ち駒があるなら、持たせる必要がない        */
  window.tsumeIsClean = function(q, len){
    const reasons = [];
    for(const k in q.b){
      if(q.b[k].t === "玉") continue;
      const b2 = {...q.b}; delete b2[k];
      const r = tsumeVerify({b:b2, hand:[...q.hand]}, len);
      if(r.ok && r.shortest === len) reasons.push(`${k}の${q.b[k].t}は無くても成立する`);
    }
    const dropped = tsumePV(q, len).filter(m => m.includes("打")).map(m => m.slice(-2, -1));
    const rest = [...q.hand];
    dropped.forEach(t => { const i = rest.indexOf(t); if(i >= 0) rest.splice(i, 1); });
    if(rest.length) reasons.push(`持ち駒の${rest.join("")}を使わない`);
    return {clean: reasons.length === 0, reasons};
  };

  window.tsumeSearch = function(opts){
    const o = opts || {};
    const trials = o.trials || 200, len = o.len || 5, maxPieces = o.maxPieces || 5;
    o.atkMin = o.atkMin || 1; o.atkMax = o.atkMax || 2;
    o.defMin = o.defMin || 0; o.defMax = o.defMax || 1;
    o.handMin = o.handMin || 1; o.handMax = o.handMax || 2;
    const t0 = performance.now(), found = [];
    let tried = 0;
    for(let i = 0; i < trials; i++){
      const q = randomProblem(o);
      if(Object.keys(q.b).length > maxPieces) continue;
      if(alreadyCheck(q)) continue;
      tried++;
      const r = tsumeVerify(q, len);
      if(!(r.ok && r.shortest === len)) continue;
      const c = window.tsumeIsClean(q, len);
      if(o.strict !== false && !c.clean) continue;      // 無駄な駒・余る持ち駒があるものは捨てる
      found.push({q, first:r.firstMoves[0], pv:tsumePV(q, len), clean:c.clean, reasons:c.reasons});
    }
    return {found, tried, ms:Math.round(performance.now() - t0)};
  };
})();
