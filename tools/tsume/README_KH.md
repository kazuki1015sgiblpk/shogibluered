# 第二の検証器（KomoringHeights）

`verify.js` はアプリ本体の指し手生成をそのまま使う。アプリとのズレは起きないが、
その実装自体が間違っていると誰も気づけない。実際、余詰めを二度見逃している。

そこで、まったく別実装の [KomoringHeights](https://github.com/komori-n/KomoringHeights)
（やねうら王ベースの詰将棋エンジン、GPLv3）で同じ問題を判定する。
両方が ok と言った問題だけを配信する。

## 準備（手元）

    # エンジン（リポジトリには含めない。tools/engines/ は .gitignore 済み）
    mkdir -p tools/engines && cd tools/engines
    curl -LO https://github.com/komori-n/KomoringHeights/releases/download/kh-v1.1.0/KomoringHeights-kh-v1.1.0-mac.zip
    unzip -o KomoringHeights-kh-v1.1.0-mac.zip -d kh

    # Python 側
    python3 -m venv tools/.venv
    tools/.venv/bin/pip install -r tools/requirements.txt

## 使い方

    tools/.venv/bin/python tools/tsume/verify_kh.py              # 全問
    tools/.venv/bin/python tools/tsume/verify_kh.py --upcoming   # 明日以降の配信ぶん
    tools/.venv/bin/python tools/tsume/search_kh.py --len 5 --want 10   # 作問候補を探す

## ライセンスについて

KomoringHeights は GPLv3 だが、**別プロセスとして呼ぶだけ**なので、
このリポジトリや配信するアプリに GPL の義務は及ばない。
エンジンのバイナリはリポジトリに含めず、各自がダウンロードする。

## 判定のしかた

攻方の手番（ORノード）ごとに MultiPV で「詰ませられる手」を挙げ、
**宣言手数以内で詰む手が二つ以上あれば余詰め**とする。
MultiPV はもっと長い手数でしか詰まない手も挙げてくるので、
`score mate` の値を見て宣言手数以内かどうかを必ず確かめること。
玉方の応手は python-shogi で全部展開する。
