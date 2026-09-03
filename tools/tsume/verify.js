#!/usr/bin/env node
/* 全問を検証器にかける。
 *
 * これまで検証はブラウザで手作業に頼っていて、そのせいで余詰めを2度見逃した
 * （初手しか見ていない版と、最終手を飛ばす版）。人が手で回す限り同じことが起きるので、
 * 機械が毎回まわせる形にしてある。CI からも呼ぶ。
 *
 * 使い方:
 *   node tools/tsume/verify.js              # 全問（人が確認するとき）
 *   node tools/tsume/verify.js --scheduled  # 配信予定に入っているものだけ
 *   node tools/tsume/verify.js --upcoming   # 明日以降に配信するものだけ（CI 用）
 *
 * --upcoming が CI の関門。配信済みの回はスケジュールを遡って書き換えない決まりなので、
 * そこに疵があっても直せない＝CI で落とす意味がない。まだ差し替えられる回だけを見る。
 *
 * 終了コード: 1問でも ok でなければ 1
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const MIME = {".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
              ".json":"application/json; charset=utf-8", ".png":"image/png"};

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
  const argv = process.argv.slice(2);
  const onlyScheduled = argv.includes("--scheduled");
  const onlyUpcoming  = argv.includes("--upcoming");

  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, "problems.json"), "utf-8"));
  // 検証は index.html の TSUME（＝実際に配信されるデータ）に対して行う。
  // problems.json を直接見ると publish 忘れのズレを見逃す。
  const scheduled = new Set(doc.schedule);
  // 出題番号は配信第1回(2026/8/27 JST)からの経過日数+1（index.html の todayTsumeNo と同じ）
  const jstDay = Math.floor((Date.now() + 9 * 3600000) / 86400000);
  const day1   = Math.floor((Date.UTC(2026, 7, 27) + 9 * 3600000) / 86400000);
  const todayNo = jstDay - day1 + 1;
  const upcoming = new Set(doc.schedule.slice(todayNo));   // 0始まりなので todayNo が「翌日」

  const server = await serve();
  const port = server.address().port;
  let browser;
  try{ browser = await chromium.launch({ channel: "chrome" }); }
  catch(e){ browser = await chromium.launch(); }
  const page = await browser.newPage();

  let results;
  try{
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
    await page.addScriptTag({ url: "/tools/tsume/solver.js" });
    results = await page.evaluate(() =>
      TSUME.map((q, i) => {
        const v = tsumeVerify(q, q.len || 1);
        return { no: i + 1, name: q.name, len: q.len || 1, ok: !!v.ok, issues: v.issues || [] };
      })
    );
  } finally {
    await browser.close();
    server.close();
  }

  // problems.json の並びと index.html の TSUME の並びは publish.py が一致させている
  const ids = doc.problems.map(p => p.id);

  let bad = 0;
  for(const r of results){
    const id = ids[r.no - 1] || "?";
    const inSchedule = scheduled.has(id);
    if(onlyScheduled && !inSchedule) continue;
    if(onlyUpcoming && !upcoming.has(id)) continue;
    const mark = r.ok ? "ok  " : "NG  ";
    const tag = inSchedule ? " [配信予定]" : "";
    console.log(`${mark}#${r.no} ${r.name}（${r.len}手 / ${id}）${tag}`);
    if(!r.ok){
      bad++;
      for(const s of r.issues) console.log(`      - ${s}`);
    }
  }
  console.log(bad ? `\n${bad}問が検証に通っていません。` : "\n全問 ok。");
  return bad ? 1 : 0;
}

main().then(c => process.exit(c), e => { console.error(e); process.exit(2); });
