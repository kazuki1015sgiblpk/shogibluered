#!/usr/bin/env node
/* 作問候補をヘッドレスで探す。
 *
 * これまではブラウザのコンソールに tsumeSearch を打ち込んで探していたが、
 * ページを閉じると結果が消えるうえ、探索中は他の作業ができなかった。
 *
 * 使い方:
 *   node tools/tsume/search.js --len 5 --want 3            # 5手詰を3問見つかるまで
 *   node tools/tsume/search.js --len 3 --want 2 --max 8000 # 打ち切り試行数を指定
 *
 * 見つかった候補は候補ファイル(dist/candidates-<len>.json)に追記する。
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const MIME = {".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
              ".json":"application/json; charset=utf-8"};

function arg(name, def){
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

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
  const len  = parseInt(arg("len", "5"), 10);
  const want = parseInt(arg("want", "3"), 10);
  const max  = parseInt(arg("max", "40000"), 10);
  const CHUNK = 400;                       // 1回の evaluate で回す試行数（長すぎると応答が返らない）

  const server = await serve();
  const port = server.address().port;
  let browser;
  try{ browser = await chromium.launch({ channel: "chrome" }); }
  catch(e){ browser = await chromium.launch(); }
  const page = await browser.newPage();

  const found = [];
  try{
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
    await page.addScriptTag({ url: "/tools/tsume/solver.js" });
    await page.addScriptTag({ url: "/tools/tsume/generate.js" });

    let tried = 0;
    while(found.length < want && tried < max){
      // tsumeSearch は {found, tried, ms} を返す（found の各要素は {q, first, pv, ...}）
      const got = await page.evaluate(
        ({trials, len}) => tsumeSearch({ trials, len }),
        { trials: CHUNK, len }
      );
      tried += CHUNK;
      for(const c of got.found) if(found.length < want) found.push(c);
      console.log(`  ${tried}試行 / 候補 ${found.length}件`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  const out = path.join(ROOT, "dist", `candidates-${len}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf-8")) : [];
  fs.writeFileSync(out, JSON.stringify(prev.concat(found), null, 2), "utf-8");
  console.log(`${found.length}件を ${path.relative(ROOT, out)} に書き出しました。`);
  return found.length ? 0 : 1;
}

main().then(c => process.exit(c), e => { console.error(e); process.exit(2); });
