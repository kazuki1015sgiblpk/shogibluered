#!/usr/bin/env node
/* 詰将棋の解答手順を再生した動画(mp4)を作る。
 *
 * アプリ本体をヘッドレスChromeで開き、観戦モード(シークバー付きの再生画面)に
 * 解答手順を載せて1手ずつ撮影する。盤の描画を別途実装せず本物を撮るので、
 * アプリの見た目を変えても動画は自動で追従する。
 *
 * 使い方:
 *   node tools/tsume/render_video.js            # 明日以降の配信予定を全部作る
 *   node tools/tsume/render_video.js --no 7     # 出題番号を指定
 *   node tools/tsume/render_video.js --out dist/movie
 *
 * 出力: <out>/tsume-<出題番号>.mp4
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const MIME = {".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
              ".json":"application/json; charset=utf-8", ".png":"image/png"};

// 1コマあたりの表示秒数。初形は問題を読む時間、詰み上がりは余韻をとる。
const HOLD_FIRST = 3.0, HOLD_MOVE = 1.6, HOLD_LAST = 3.4;
const FPS = 30;
const VIEW = { width: 540, height: 960, scale: 2 };   // 撮影は1080x1920(縦動画)

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

/* 観戦モードに解答手順を載せる。アプリの replayTsume() と同じ手順を踏む
 * (あちらは人が解いた棋譜を使うが、こちらは検証器が出した正解手順を使う)。 */
async function loadSolution(page, idx){
  return page.evaluate((i) => {
    const q = TSUME[i];
    const moves = tsumeLine(q, q.len || 1);
    const b = {};
    for(const k in q.b) b[k] = {...q.b[k]};
    const basePos = {forView: true, b, hands: {s: [...q.hand], g: []}};
    const mvs = moves.map(m => m.drop
      ? {s:m.s, drop:m.drop, to:[...m.to]}
      : {s:m.s, from:[...m.from], to:[...m.to], promo:m.promo});
    if(typeof exitPlay === "function") exitPlay();
    BASE_POS = basePos;
    const parsed = decorateAndFinish(mvs, {event:q.name, sente:"攻方", gote:"玉方"},
                                     "詰み", `まで${mvs.length}手で詰み`);
    parsed.basePos = basePos;
    applyLoaded(parsed);
    document.querySelectorAll(".panelbox, .tabpanel").forEach(el => { el.hidden = true; });
    return mvs.length;
  }, idx);
}

async function shoot(page, dir, plies){
  const frames = [];
  for(let s = 0; s <= plies; s++){
    await page.evaluate((n) => { step = n; render(); }, s);
    await page.waitForTimeout(220);                       // 描画とアニメーションの落ち着きを待つ
    const file = path.join(dir, `f${String(s).padStart(2, "0")}.png`);
    await page.screenshot({ path: file });
    frames.push({ file, hold: s === 0 ? HOLD_FIRST : (s === plies ? HOLD_LAST : HOLD_MOVE) });
  }
  return frames;
}

function encode(frames, out){
  // concat デマルチプレクサで、コマごとに表示時間を変えて1本の動画にする
  const listFile = path.join(path.dirname(frames[0].file), "frames.txt");
  const lines = [];
  for(const f of frames){
    lines.push(`file '${f.file}'`, `duration ${f.hold}`);
  }
  lines.push(`file '${frames[frames.length - 1].file}'`);   // 最後の1枚は宣言が要る
  fs.writeFileSync(listFile, lines.join("\n") + "\n");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // 最後のコマは宣言の重複で表示時間が二重に効くため、-t で全体の長さを確定させる
  const total = frames.reduce((a, f) => a + f.hold, 0);
  execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile,
    "-t", total.toFixed(2),
    "-vf", `fps=${FPS},format=yuv420p`, "-c:v", "libx264", "-preset", "medium",
    "-crf", "20", "-movflags", "+faststart", out], { stdio: ["ignore", "ignore", "pipe"] });
}

(async () => {
  const argv = process.argv.slice(2);
  const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const outDir = path.resolve(ROOT, arg("--out", "dist/movie"));
  const onlyNo = arg("--no", null);

  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({
    viewport: { width: VIEW.width, height: VIEW.height },
    deviceScaleFactor: VIEW.scale,
    colorScheme: "dark",
  });

  try{
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
    await page.addScriptTag({ url: "/tools/tsume/solver.js" });

    // 対象の出題番号: 指定がなければ「今日より後」の配信予定すべて
    const targets = await page.evaluate((only) => {
      const list = [];
      for(let n = 1; n <= TSUME_SCHEDULE.length; n++){
        if(only ? n === +only : n > todayTsumeNo()){
          list.push({no:n, idx:tsumeIndexForNo(n), name:TSUME[tsumeIndexForNo(n)].name,
                     date:tsumeDateLabel(n)});
        }
      }
      return list;
    }, onlyNo);

    if(!targets.length){ console.log("対象の出題がありません"); return; }

    for(const t of targets){
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tsume-"));
      const plies = await loadSolution(page, t.idx);
      const frames = await shoot(page, tmp, plies);
      const out = path.join(outDir, `tsume-${String(t.no).padStart(3, "0")}.mp4`);
      encode(frames, out);
      fs.rmSync(tmp, { recursive: true, force: true });
      const sec = (HOLD_FIRST + HOLD_MOVE * (plies - 1) + HOLD_LAST).toFixed(1);
      console.log(`#${t.no} ${t.date} ${t.name} → ${path.relative(ROOT, out)} (${plies}手 / 約${sec}秒)`);
    }
  } finally {
    await browser.close();
    server.close();
  }
})();
