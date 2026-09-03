#!/usr/bin/env node
/* 探索で見つけた候補から、problems.json に貼れるエントリの下書きを作る。
 *
 * 候補ファイル(search.js の出力)には手順が文字列でしか入っていない。
 * アプリの「手順を再生」は指し手オブジェクト(answer)を必要とするので、
 * ここで tsumeLine を使って起こし直す。name / hint / teaser は人が書く。
 *
 * 使い方:
 *   node tools/tsume/draft.js dist/candidates-3.json 0 p005   # 候補0番を id p005 として
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const MIME = {".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
              ".json":"application/json; charset=utf-8"};

function serve(){
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.join(ROOT, rel);
    if(!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, {"Content-Type": MIME[path.extname(file)] || "application/octet-stream",
                        "Cache-Control": "no-store"});
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r(server)));
}

async function main(){
  const [file, idxStr, id] = process.argv.slice(2);
  if(!file || idxStr == null){ console.error("使い方: draft.js <候補ファイル> <番号> [id]"); return 2; }
  const cands = JSON.parse(fs.readFileSync(path.resolve(file), "utf-8"));
  const c = cands[parseInt(idxStr, 10)];
  if(!c){ console.error("その番号の候補がありません"); return 2; }
  const len = c.pv.length;

  const server = await serve();
  const port = server.address().port;
  let browser;
  try{ browser = await chromium.launch({ channel: "chrome" }); }
  catch(e){ browser = await chromium.launch(); }
  const page = await browser.newPage();
  let answer, ok;
  try{
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
    await page.addScriptTag({ url: "/tools/tsume/solver.js" });
    ({ answer, ok } = await page.evaluate(({q, len}) => ({
      answer: tsumeLine(q, len),
      ok: tsumeVerify(q, len).ok
    }), { q: c.q, len }));
  } finally { await browser.close(); server.close(); }

  const entry = { id: id || "pXXX", name: "第N問 （名前）", len, b: c.q.b, hand: c.q.hand,
                  teaser: "（問題の説明）", hint: "（ヒント）", answer };
  console.log(`// 手順: ${c.pv.join(" ")}   検証: ${ok ? "ok" : "NG"}`);
  console.log(JSON.stringify(entry, null, 1));
  return ok ? 0 : 1;
}
main().then(c => process.exit(c), e => { console.error(e); process.exit(2); });
