#!/usr/bin/env node
/* 画面をタップして正解手順を指し、アプリで解けるかを確かめる。
 *
 * 検証器（verify.js）はアプリの指し手生成を直接呼ぶので、画面の操作で起きる不具合は
 * 見つけられない。実際に第68問で、持ち駒の桂を押すと銀が選ばれ、正解の▲8三桂が
 * 打てなかった（内部の持ち駒の並びと表示の並びがずれていた）。
 * ここでは利用者と同じように、駒やマスの位置をクリックして指す。
 *
 * 使い方:
 *   node tools/tsume/taptest.js            # 明日以降に配信する問題
 *   node tools/tsume/taptest.js --all      # 全問
 *
 * 確かめること: 正解手順がすべて指せる・玉方の応手が登録手順どおり・
 * 最後に「正解」と出る・持ち駒が余らない。
 * 終了コード: 1問でも通らなければ 1
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");

function serve(){
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.join(ROOT, rel);
    if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, {"Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream"});
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r(server)));
}

async function main(){
  const all = process.argv.includes("--all");
  // 配信済みで差し替えないと決めた駒余りの問題（waive）は、持ち駒の余りを問わない。
  // problems.json の並びは index.html の TSUME と同じ（publish.py がそろえている）
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, "problems.json"), "utf-8"));
  const server = await serve();
  let browser;
  try{ browser = await chromium.launch({ channel: "chrome" }); }
  catch(e){ browser = await chromium.launch(); }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let bad = 0;
  try{
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: "load" });
    // 対象: 明日以降の配信予定（同じ問題は1度だけ）
    const idxs = await page.evaluate(all => {
      if(all) return TSUME.map((_, i) => i);
      const out = [];
      for(let n = todayTsumeNo() + 1; n <= TSUME_SCHEDULE.length; n++){
        const i = tsumeIndexForNo(n);
        if(!out.includes(i)) out.push(i);
      }
      return out;
    }, all);

    // 画面上の要素の中心座標
    const center = expr => page.evaluate(s => {
      const r = (0, eval)(s).getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    }, expr);
    const tap = async expr => page.mouse.click(...await center(expr));
    const state = () => page.evaluate(() => ({
      n: PLAY.moves.length, over: PLAY.over, thinking: PLAY.thinking,
      hand: PLAY.st.hands.s.join(""),
      toast: (document.querySelector("#toast") || {}).textContent || ""}));

    for(const i of idxs){
      await page.evaluate(i => startTsume(i), i);
      await page.waitForTimeout(300);
      const ans = await page.evaluate(i => TSUME[i].answer || [], i);
      const issues = [];
      for(let k = 0; k < ans.length && !issues.length; k += 2){
        const a = ans[k];
        if(a.drop) await tap(`[...(FLIPPED ? handG : handS).children].find(e => e.dataset.t === ${JSON.stringify(a.drop)})`);
        else       await tap(`boardEl.children[sqIndex(${a.from[0]}, ${a.from[1]})]`);
        await tap(`boardEl.children[sqIndex(${a.to[0]}, ${a.to[1]})]`);
        // 玉方の応手（最終手なら終局）を待つ
        let st;
        for(let t = 0; t < 100; t++){
          st = await state();
          if(!st.thinking && (st.over || st.n >= k + 2)) break;
          await page.waitForTimeout(100);
        }
        if(st.n < k + 1){ issues.push(`${k + 1}手目が指せない（${st.toast.trim()}）`); break; }
        if(k + 1 < ans.length){
          const same = await page.evaluate(([k, e]) => {
            const r = PLAY.moves[k + 1];
            return !!r && r.to[0] === e.to[0] && r.to[1] === e.to[1] && (e.drop ? r.drop === e.drop : !r.drop);
          }, [k, ans[k + 1]]);
          if(!same) issues.push(`${k + 2}手目の応手が登録手順と違う`);
        }
      }
      const end = await state();
      if(!issues.length){
        if(!end.over || !/正解/.test(end.toast)) issues.push(`正解にならない（${end.toast.trim()}）`);
        else if(end.hand && !(doc.problems[i].waive || []).includes("駒余り"))
          issues.push(`持ち駒が余る（${end.hand}）`);
      }
      const name = await page.evaluate(i => TSUME[i].name, i);
      console.log(`${issues.length ? "NG  " : "ok  "}${name}${issues.length ? "\n      - " + issues.join("\n      - ") : ""}`);
      if(issues.length) bad++;
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(bad ? `\n${bad}問が画面の操作で解けませんでした。` : "\n全問 ok。");
  return bad ? 1 : 0;
}

main().then(c => process.exit(c), e => { console.error(e); process.exit(2); });
