#!/usr/bin/env bash
# KomoringHeights（第二の検証器）を用意し、実行ファイルのパスを標準出力に出す。
#
# Linux 版のバイナリは配布されていないので、CI ではソースからビルドする。
# 手元の Mac には公式のリリースがあるので、そちらを取ってくる。
# エンジンはリポジトリに含めない（GPLv3。別プロセスとして呼ぶだけ）。
#
# 標準出力に出すのはパスだけ。ビルドの進捗は標準エラーへ流す
# （呼び出し側が $(setup_engine.sh) でパスを受け取るため）。
set -euo pipefail

VER="kh-v1.1.0"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/tools/engines"
mkdir -p "$DEST"

case "$(uname -s)" in
  Darwin)
    BIN="$DEST/kh/mac/KomoringHeights/KomoringHeights-mac-clang++-14-normal-M1"
    if [ ! -x "$BIN" ]; then
      curl -sL -o "$DEST/kh.zip" \
        "https://github.com/komori-n/KomoringHeights/releases/download/$VER/KomoringHeights-$VER-mac.zip" >&2
      unzip -q -o "$DEST/kh.zip" -d "$DEST/kh" >&2
    fi
    ;;
  Linux)
    BIN="$DEST/KomoringHeights"
    if [ ! -x "$BIN" ]; then
      rm -rf "$DEST/src"
      git clone --depth 1 --branch "$VER" \
        https://github.com/komori-n/KomoringHeights.git "$DEST/src" >&2
      # ランナーの CPU に合わせる。github-hosted は AVX2 が使える
      make -C "$DEST/src/source" -j"$(nproc)" normal TARGET_CPU=AVX2 COMPILER=clang++ >&2
      # 実行ファイル名はエンジン名から決まる（KomoringHeights-by-gcc）。
      # 決め打ちにすると上流で名前が変わったときに気づけないので探す
      BUILT="$(find "$DEST/src/source" -maxdepth 1 -name '*-by-gcc' -type f | head -1)"
      [ -n "$BUILT" ] || { echo "ビルド結果が見つかりません" >&2; exit 1; }
      cp "$BUILT" "$BIN"
      chmod +x "$BIN"
      rm -rf "$DEST/src"
    fi
    ;;
  *)
    echo "未対応の OS: $(uname -s)" >&2; exit 1 ;;
esac

[ -x "$BIN" ] || { echo "エンジンを用意できませんでした: $BIN" >&2; exit 1; }
echo "$BIN"
