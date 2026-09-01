#!/usr/bin/env python3
"""配信スケジュールの残りを確認する。

「今日の詰将棋」は TSUME_SCHEDULE を1日ずつ消化していく。尽きると
最後の問題を出し続けてしまい、同じ問題が何日も並ぶ。手前で気づけるよう、
残り日数を報告し、少なくなったら終了コード1で知らせる。

  python3 tools/tsume/check_stock.py            # 残り3日未満で失敗
  python3 tools/tsume/check_stock.py --min 7    # しきい値を変える
"""
import json, io, os, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
JST = datetime.timezone(datetime.timedelta(hours=9))
DAY1 = datetime.date(2026, 8, 27)          # 配信第1回（index.html の TSUME_DAY1 と同じ）


def main():
    argv = sys.argv[1:]
    threshold = int(argv[argv.index("--min") + 1]) if "--min" in argv else 3

    doc = json.load(io.open(os.path.join(HERE, "problems.json"), encoding="utf-8"))
    schedule = doc["schedule"]
    by_id = {p["id"]: p for p in doc["problems"]}

    today_no = (datetime.datetime.now(JST).date() - DAY1).days + 1
    remaining = len(schedule) - today_no          # 明日以降に配信できる日数
    last_date = DAY1 + datetime.timedelta(days=len(schedule) - 1)

    print(f"今日の出題番号: #{today_no}")
    print(f"スケジュール登録: {len(schedule)}回分（{last_date} まで）")
    print(f"明日以降の残り: {remaining}日分")

    if remaining >= 1:
        nxt = by_id.get(schedule[today_no], {})   # 0始まりなので today_no が「翌日」
        print(f"翌日の出題: {nxt.get('name', '不明')}")

    if remaining < threshold:
        print(f"::warning::詰将棋のストックが残り{remaining}日分です。"
              f"problems.json に問題を追加してください。")
        sys.exit(1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
