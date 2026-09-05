#!/usr/bin/env bash
# KomoringHeights（第二の検証器）を用意する。
#
# Linux 版のバイナリは配布されていないので、CI ではソースからビルドする。
# 手元の Mac には公式のリリースがあるので、そちらを取ってくる。
# エンジンはリポジトリに含めない（GPLv3。別プロセスとして呼ぶだけ）。
set -euo pipefail

VER="kh-v1.1.0"
DEST="$(cd "$(dirname "$0")/../engines" 2>/dev/null || (mkdir -p "$(dirname "$0")/../engines" && cd "$(dirname "$0")/../engines"); pwd)"

case "$(uname -s)" in
  Darwin)
    if [ ! -d "$DEST/kh" ]; then
      curl -sL -o "$DEST/kh.zip" \
        "https://github.com/komori-n/KomoringHeights/releases/download/$VER/KomoringHeights-$VER-mac.zip"
      unzip -q -o "$DEST/kh.zip" -d "$DEST/kh"
    fi
    echo "$DEST/kh/mac/KomoringHeights/KomoringHeights-mac-clang++-14-normal-M1"
    ;;
  Linux)
    if [ ! -x "$DEST/KomoringHeights" ]; then
      rm -rf "$DEST/src"
      git clone --depth 1 --branch "$VER" \
        https://github.com/komori-n/KomoringHeights.git "$DEST/src"
      # ランナーの CPU に合わせる。github-hosted は AVX2 が使える
      make -C "$DEST/src/source" -j"$(nproc)" normal TARGET_CPU=AVX2 COMPILER=clang++
      cp "$DEST/src/source/YaneuraOu-by-gcc" "$DEST/KomoringHeights"
      rm -rf "$DEST/src"
    fi
    echo "$DEST/KomoringHeights"
    ;;
  *)
    echo "未対応の OS: $(uname -s)" >&2; exit 1 ;;
esac
