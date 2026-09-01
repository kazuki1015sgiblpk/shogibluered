# 詰将棋の作問・配信のしくみ

`index.html` の `TSUME`（問題データ）と `TSUME_SCHEDULE`（配信予定）は
**`problems.json` から生成される**。index.html の該当箇所は直接編集しないこと。

## ファイル

| ファイル | 役割 |
| --- | --- |
| `problems.json` | 問題ストックと配信スケジュール。ここだけを編集する |
| `solver.js` | 検証器。余詰め・早詰み・詰み無しを検出する |
| `publish.py` | `problems.json` → `index.html` の生成 |
| `generate.js` | 作問候補のランダム探索（下ごしらえ用） |

## 問題を追加する手順

1. `problems.json` の `problems` に**末尾追加**する（id は `p008`, `p009`, … と連番）
2. 検証器にかけて `ok: true` を確認する（下記）
3. `schedule` の**末尾に**その id を足す＝翌日以降の出題になる
4. `python3 tools/tsume/publish.py` を実行して `index.html` に反映
5. コミットして push（Cloudflare が自動デプロイ）

## 検証のしかた

ローカルサーバーを立て、ブラウザで `index.html` を開いた状態で実行する。
検証器は独自のルール実装を持たず、アプリ本体の `legalAllP` / `inCheckP` を
そのまま呼ぶ。別実装にすると「ソルバでは詰むがアプリでは詰まない」ズレが起きるため。

```js
var x=new XMLHttpRequest(); x.open('GET','/tools/tsume/solver.js',false); x.send(); (0,eval)(x.responseText);
TSUME.map((q,i) => ({no:i+1, ...tsumeVerify(q, q.len||1)}));
```

`ok: true` 以外の問題は配信してはいけない。

## 作問候補を探す

手作業で作ると余詰めが入りやすいので、候補を機械的に探してから人が選ぶ。

```js
tsumeSearch({trials: 500, len: 5})        // 5手詰の候補を探す
tsumeSearch({trials: 500, len: 5, handSet: ["金","銀","桂","香"]})   // 飛角を使わない問題
```

`tsumeSearch` は検証を通ったうえで `tsumeIsClean`（無駄な駒がない・持ち駒を
使い切る）も満たすものだけを返す。発見率は500試行あたり1〜2問程度なので、
ページ内で分割実行して貯める。拾った候補から人が選び、名前とヒントを付ける。

## 守るべき決まり

- **`schedule` は末尾追加のみ。** 既存要素を書き換えると、配信済みの回の問題が
  遡って別の問題にすり替わり、「過去の詰将棋」の中身が変わってしまう
- **`problems` も末尾追加のみ**（`publish.py` が id → 添字を解決するため、
  並べ替えても壊れはしないが、履歴が追いにくくなる）
- **「今日の詰将棋」は五手詰を基本とする**（`policy.dailyLen`）
- 玉方の持ち駒は空として検証している。アプリの対局開始処理
  (`PLAY.st.hands.g = []`) に合わせたもので、合駒による受けは考慮していない。
  アプリ側を規約準拠に変えるなら検証器も同時に変えること
