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
const HOLD_FIRST = 3.0, HOLD_MOVE = 1.6, HOLD_LAST = 3.0, HOLD_CTA = 2.0;
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
async function applySnsLayout(page, o){
  await page.evaluate((o) => {
    if(!document.getElementById("sns-style")){
      const st = document.createElement("style");
      st.id = "sns-style";
      st.textContent = `
        header, .modetabs, .seek, .transport, .meter, #movestrip, #telop,
        #kifu-credit, .pieceinfo, #playbar, .tsume-count, .matchinfo2,
        #toast, #koma-zukan { display:none !important }
        /* 真っ黒だと素っ気ないので、和紙のような淡い地を敷く */
        body{
          background:
            radial-gradient(120% 80% at 50% 0%, #1b1d22 0%, #101216 60%),
            repeating-linear-gradient(105deg, rgba(255,255,255,.014) 0 2px, transparent 2px 5px)
            !important;
        }
        .wrap{
          max-width:none !important;
          min-height:100vh; display:flex; flex-direction:column;
          justify-content:center; gap:10px; padding:0 12px;
        }
        /* 持ち駒は詰将棋の核心なので大きく見せる */
        .tray{ height:58px !important; padding:0 8px }
        .tray .nm{ font-size:16px }
        .hand .koma{ width:42px !important; height:50px !important }

        #sns-top{ text-align:center; padding:2px 0 0 }
        #sns-top .no{
          display:inline-block; font-size:13px; letter-spacing:.14em; color:#E8B93E;
          border:1px solid rgba(232,185,62,.55); border-radius:999px; padding:1px 12px;
        }
        #sns-top .d{ font-size:28px; font-weight:700; color:#F0E9D8; margin-top:6px }
        #sns-top .s{ font-size:15px; color:#c9b98a; letter-spacing:.1em; margin-top:3px }
        #sns-top .star{ color:#E8B93E; letter-spacing:.18em; margin-left:8px }
        #sns-cap{
          text-align:center; font-size:30px; font-weight:700; min-height:44px;
          letter-spacing:.03em; font-variant-numeric:tabular-nums;
        }
        #sns-cap .n{ color:#6f7681; font-size:19px; margin-right:10px }
        #sns-cap .mate{
          display:inline-block; margin-left:12px; font-size:20px; color:#101216;
          background:#E8B93E; border-radius:6px; padding:2px 12px; vertical-align:middle;
        }
        #sns-note{ text-align:center; font-size:17px; color:#E8B93E; font-weight:700; min-height:24px }
        #sns-bottom{ text-align:center; padding-bottom:6px; line-height:1.5 }
        #sns-bottom .brand{ font-size:15px; color:#cfc6b4; letter-spacing:.08em }
        #sns-bottom .url{ font-size:15px; color:#8b929c; letter-spacing:.08em }

        /* 末尾の誘導画面 */
        #sns-cta{
          position:fixed; inset:0; z-index:200; display:none;
          flex-direction:column; align-items:center; justify-content:center; gap:14px;
          background:radial-gradient(120% 80% at 50% 40%, #1d2027 0%, #0e1014 70%);
        }
        #sns-cta.on{ display:flex }
        #sns-cta .b{ font-size:34px; font-weight:700; color:#F0E9D8; letter-spacing:.04em }
        #sns-cta .m{ font-size:21px; color:#E8B93E; letter-spacing:.14em }
        #sns-cta .u{ font-size:19px; color:#a8afb9; letter-spacing:.06em; margin-top:6px }`;
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
    mk("sns-top",
       `<div class="no">第${o.no}回</div><div class="d">${o.date}</div>` +
       `<div class="s">${o.sub}<span class="star">${o.stars}</span></div>`, gote);
    mk("sns-cap", "", sente ? sente.nextSibling : null);
    mk("sns-note", "", document.getElementById("sns-cap").nextSibling);
    mk("sns-bottom", `<div class="brand">盤上勢力一目瞭然</div><div class="url">shogi-bluered.com</div>`, null);

    let cta = document.getElementById("sns-cta");
    if(!cta){
      cta = document.createElement("div");
      cta.id = "sns-cta";
      cta.innerHTML = `<div class="b">盤上勢力一目瞭然</div>` +
                      `<div class="m">毎日 詰将棋を更新中</div>` +
                      `<div class="u">shogi-bluered.com/#tsume</div>`;
      document.body.appendChild(cta);
    }
  }, o);
}

/* 観戦モードに解答手順を載せる。アプリの replayTsume() と同じ手順を踏む
 * (あちらは人が解いた棋譜を使うが、こちらは検証器が出した正解手順を使う)。 */
async function loadSolution(page, idx){
  return page.evaluate((i) => {
    const q = TSUME[i];
    const moves = tsumeLine(q, q.len || 1);
    const b = {};
    for(const k in q.b) b[k] = {...q.b[k]};
    // 玉方の持ち駒は詰将棋の慣例どおり「残り全部」。restHandG を立てると
    // トレーには一枚ずつ並べず「残り全部」とだけ出る（アプリ本体と同じ扱い）
    const basePos = {forView: true, b, restHandG: true,
                     hands: {s: [...q.hand], g: tsumeDefHand(b, q.hand)}};
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
    const mate = n === MOVES.length ? `<span class="mate">詰み！</span>` : "";
    cap.innerHTML = `<span class="n">${n}/${MOVES.length}</span>${m.label}${mate}`;
    cap.style.color = m.s === "s" ? "#e8776a" : "#8fb6e8";
  }, s);
  await page.waitForTimeout(220);                         // 描画とアニメーションの落ち着きを待つ
}

/* 問題編: 盤と持ち駒だけを切り出した画像。
 * 見出し帯・字幕・URLは入れない（画像では盤面が主役であるべきなので）。
 * 持ち駒は詰将棋を解くのに必須なので残す。 */
async function shootProblem(page, out){
  await setPly(page, 0);
  const clip = await page.evaluate(() => {
    ["sns-top", "sns-cap", "sns-note", "sns-bottom"].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.style.display = "none";
    });
    const gote = document.querySelector(".tray.gote");
    const sente = document.querySelector(".tray:not(.gote)");
    const board = document.getElementById("board");
    const rects = [gote, board, sente].filter(Boolean).map(e => e.getBoundingClientRect());
    const pad = 16;
    const left = Math.min(...rects.map(r => r.left)) - pad;
    const top = Math.min(...rects.map(r => r.top)) - pad;
    const right = Math.max(...rects.map(r => r.right)) + pad;
    const bottom = Math.max(...rects.map(r => r.bottom)) + pad;
    return {x: Math.max(0, left), y: Math.max(0, top),
            width: right - Math.max(0, left), height: bottom - Math.max(0, top)};
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, clip });
  await page.evaluate(() => {
    ["sns-top", "sns-cap", "sns-note", "sns-bottom"].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.style.display = "";
    });
  });
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
  // 末尾に「毎日更新中」の誘導画面を足す
  await page.evaluate(() => document.getElementById("sns-cta").classList.add("on"));
  const cta = path.join(dir, "cta.png");
  await page.waitForTimeout(120);
  await page.screenshot({ path: cta });
  await page.evaluate(() => document.getElementById("sns-cta").classList.remove("on"));
  frames.push({ file: cta, hold: HOLD_CTA });
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
  // 中身はほぼ静止画。既定の設定だと245kbps程度まで削られ、駒の文字や罫線が滲む。
  // tune=stillimage と低いcrfで、細い線と文字のエッジを残す。
  // SNSは投稿時に再エンコードするため、元が甘いと二重に劣化する。
  execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile,
    "-t", total.toFixed(2),
    "-vf", `fps=${FPS},format=yuv420p`, "-c:v", "libx264", "-preset", "slow",
    "-tune", "stillimage", "-crf", "14", "-movflags", "+faststart", out],
    { stdio: ["ignore", "ignore", "pipe"] });
}

const SITE_URL = "https://shogi-bluered.com/#tsume";   // 開くと「今日の詰将棋」に直行する
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
    `※このフォルダの「${pngName}」を添付`,
    "",
    SEP,
    "以下ぶら下がりポスト",
    "",
    "【解答編】",
    "こちらが正解の動画になります↓",
    `※このフォルダの「${mp4Name}」を添付`,
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
  const tomorrow = argv.includes("--tomorrow");

  // 投稿文の紹介文は problems.json から読む（配信物の index.html には載せていないため）
  const STOCK = JSON.parse(fs.readFileSync(path.join(__dirname, "problems.json"), "utf-8"));

  const server = await serve();
  const port = server.address().port;
  // 手元では既存のChromeを使い、無ければ(CIなど)Playwright同梱のChromiumで起動する
  let browser;
  try{ browser = await chromium.launch({ channel: "chrome" }); }
  catch(e){ browser = await chromium.launch(); }
  const page = await browser.newPage({
    viewport: { width: VIEW.width, height: VIEW.height },
    deviceScaleFactor: VIEW.scale,
    colorScheme: "dark",
  });

  try{
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
    await page.addScriptTag({ url: "/tools/tsume/solver.js" });

    // 対象の出題番号: 指定がなければ「今日より後」の配信予定すべて
    const targets = await page.evaluate(({only, tomorrow}) => {
      const want = tomorrow ? todayTsumeNo() + 1 : (only ? +only : null);
      const list = [];
      for(let n = 1; n <= TSUME_SCHEDULE.length; n++){
        if(want ? n === want : n > todayTsumeNo()){
          const d = tsumeDateOfNo(n);      // 9時間ずらした軸なので UTC の日付が日本時間の日付
          const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
          list.push({no:n, idx:tsumeIndexForNo(n), name:TSUME[tsumeIndexForNo(n)].name,
                     date:tsumeDateLabel(n), iso});
        }
      }
      return list;
    }, {only: onlyNo, tomorrow});

    if(!targets.length){ console.log("対象の出題がありません"); return; }

    for(const t of targets){
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tsume-"));
      const plies = await loadSolution(page, t.idx);
      const kai = `${KANSU[plies] || plies}手詰`;
      // 「今日どれを投稿すればよいか」が一目で分かるよう、配信日のフォルダに入れる
      const dayDir = path.join(outDir, t.iso);
      const png = path.join(dayDir, "問題.png");        // 本編に添付する画像
      const mp4 = path.join(dayDir, "解答動画.mp4");    // ぶら下がりに添付する動画

      // 難易度は手数から決める（1手=★1、3手=★2、5手=★3…）
      const stars = "★".repeat(Math.min(5, (plies + 1) / 2)) + "☆".repeat(Math.max(0, 5 - (plies + 1) / 2));
      const base = {date: t.date.replace(/の詰将棋$/, ""), no: t.no, stars};

      // 問題編は狙いが割れないよう問題名を伏せる
      await applySnsLayout(page, {...base, sub: kai});
      await shootProblem(page, png);
      // 解答編は問題名も出す
      await applySnsLayout(page, {...base, sub: `${kai}　${t.name.replace(/^第\d+問\s*/, "")}`});
      encode(await shoot(page, tmp, plies), mp4);
      fs.rmSync(tmp, { recursive: true, force: true });

      const txt = path.join(dayDir, "投稿文.txt");   // X投稿の下書き
      writePost(txt, t, STOCK.problems[t.idx], path.basename(png), path.basename(mp4));

      const sec = (HOLD_FIRST + HOLD_MOVE * (plies - 1) + HOLD_LAST + HOLD_CTA).toFixed(1);
      console.log(`${t.iso}（#${t.no}） ${t.name}`);
      console.log(`   → ${path.relative(ROOT, dayDir)}/  問題.png / 解答動画.mp4 (${plies}手 ${sec}秒) / 投稿文.txt`);
    }
  } finally {
    await browser.close();
    server.close();
  }
})();
