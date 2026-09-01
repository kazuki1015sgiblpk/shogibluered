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
const KANSU = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

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

/* SNS向けの見た目に整える（撮影時だけ被せるもので、アプリ本体は変更しない）。
 * ヘッダー・タブバー・シークバー等を隠し、盤と持ち駒だけを残して、
 * 上下に見出し帯（日付・手数・アプリのURL）と指し手の字幕を足す。 */
async function applySnsLayout(page, head, sub){
  await page.evaluate(({head, sub}) => {
    if(!document.getElementById("sns-style")){
      const st = document.createElement("style");
      st.id = "sns-style";
      st.textContent = `
        header, .modetabs, .seek, .transport, .meter, #movestrip, #telop,
        #kifu-credit, .pieceinfo, #playbar, .tsume-count, .matchinfo2,
        #toast, #koma-zukan { display:none !important }
        body{ background:#101216 !important }
        .wrap{
          max-width:none !important;
          min-height:100vh; display:flex; flex-direction:column;
          justify-content:center; gap:14px; padding:0 12px;
        }
        .tray{ height:52px !important; padding:0 6px }
        .tray .nm{ font-size:15px }
        .hand .koma{ width:38px !important; height:45px !important }
        #sns-top{ text-align:center; padding:6px 0 2px }
        #sns-top .d{ font-size:27px; font-weight:700; letter-spacing:.02em; color:#F0E9D8 }
        #sns-top .s{ font-size:15px; color:#E8B93E; letter-spacing:.16em; margin-top:4px }
        #sns-cap{
          text-align:center; font-size:30px; font-weight:700; min-height:44px;
          letter-spacing:.04em; font-variant-numeric:tabular-nums;
        }
        #sns-cap .n{ color:#6f7681; font-size:19px; margin-right:10px }
        #sns-bottom{
          text-align:center; font-size:16px; color:#8b929c; letter-spacing:.1em;
          padding-bottom:6px;
        }`;
      document.head.appendChild(st);
    }
    const wrap = document.querySelector(".wrap");
    // 目印の要素は .wrap の直接の子とは限らないので、直系の子まで辿ってから挿入する
    const topChild = el => { while(el && el.parentElement !== wrap) el = el.parentElement; return el; };
    const mk = (id, html, before) => {
      let el = document.getElementById(id);
      if(!el){ el = document.createElement("div"); el.id = id; wrap.insertBefore(el, before || null); }
      el.innerHTML = html;
      return el;
    };
    const gote = topChild(document.querySelector(".tray.gote"));
    const sente = topChild(document.querySelector(".tray:not(.gote)"));
    mk("sns-top", `<div class="d">${head}</div><div class="s">${sub}</div>`, gote);
    mk("sns-cap", "", sente ? sente.nextSibling : null);
    mk("sns-bottom", "shogi-bluered.com", null);
  }, {head, sub});
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

// 指定の手数まで進め、字幕を差し替える
async function setPly(page, s){
  await page.evaluate((n) => {
    step = n; render();
    const cap = document.getElementById("sns-cap");
    if(!cap) return;
    if(n === 0){ cap.innerHTML = "▲攻方の手番"; cap.style.color = "#e8776a"; return; }
    const m = MOVES[n - 1];
    cap.innerHTML = `<span class="n">${n}手目</span>${m.label}`;
    cap.style.color = m.s === "s" ? "#e8776a" : "#8fb6e8";
  }, s);
  await page.waitForTimeout(220);                         // 描画とアニメーションの落ち着きを待つ
}

// 問題編: 初形だけの画像
async function shootProblem(page, out){
  await setPly(page, 0);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
}

// 解答編: 1手ずつ撮る
async function shoot(page, dir, plies){
  const frames = [];
  for(let s = 0; s <= plies; s++){
    await setPly(page, s);
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

const SITE_URL = "https://shogi-bluered.com/";
const HASHTAGS = "#毎日詰将棋 #詰将棋 #将棋";
const SEP = "ーーーーーーーーーーーーーーーーーーーーーー";

/* X投稿の下書きを書き出す（投稿はしない）。
 * 本編＝問題図の画像つき、ぶら下がり＝解答動画つき。
 * 説明文は problems.json の teaser を使う（hint は答えに触れるため使わない）。 */
function writePost(out, t, prob, pngName, mp4Name){
  const teaser = prob.teaser
    || `${KANSU[prob.len] || prob.len}手詰です。持ち駒は${prob.hand.join("と")}。ぜひ挑戦してみてください。`;
  const md = t.date.replace(/の詰将棋$/, "");
  const text = [
    `【毎日詰将棋】${md}`,
    teaser,
    "",
    "こちらのURLから実際に詰将棋を解けます！",
    SITE_URL,
    HASHTAGS,
    `※画像を添付: ${pngName}`,
    "",
    SEP,
    "以下ぶら下がりポスト",
    "",
    "【解答編】",
    "こちらが正解の動画になります↓",
    `※動画を添付: ${mp4Name}`,
    ""
  ].join("\n");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
}

(async () => {
  const argv = process.argv.slice(2);
  const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const outDir = path.resolve(ROOT, arg("--out", "dist/movie"));
  const onlyNo = arg("--no", null);

  // 投稿文の紹介文は problems.json から読む（配信物の index.html には載せていないため）
  const STOCK = JSON.parse(fs.readFileSync(path.join(__dirname, "problems.json"), "utf-8"));

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
      const kai = `${KANSU[plies] || plies}手詰`;
      const tag = String(t.no).padStart(3, "0");
      const png = path.join(outDir, `tsume-${tag}-q.png`);    // 問題編（画像）
      const mp4 = path.join(outDir, `tsume-${tag}-a.mp4`);    // 解答編（動画）

      // 問題編は狙いが割れないよう問題名を伏せる
      await applySnsLayout(page, t.date, kai);
      await shootProblem(page, png);
      // 解答編は問題名も出す
      await applySnsLayout(page, t.date, `${kai}　${t.name.replace(/^第\d+問\s*/, "")}`);
      encode(await shoot(page, tmp, plies), mp4);
      fs.rmSync(tmp, { recursive: true, force: true });

      const txt = path.join(outDir, `tsume-${tag}-post.txt`);   // X投稿の下書き
      writePost(txt, t, STOCK.problems[t.idx], path.basename(png), path.basename(mp4));

      const sec = (HOLD_FIRST + HOLD_MOVE * (plies - 1) + HOLD_LAST).toFixed(1);
      console.log(`#${t.no} ${t.date} ${t.name}`);
      console.log(`   問題図 ${path.relative(ROOT, png)}`);
      console.log(`   解答編 ${path.relative(ROOT, mp4)} (${plies}手 / ${sec}秒)`);
      console.log(`   投稿文 ${path.relative(ROOT, txt)}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
})();
