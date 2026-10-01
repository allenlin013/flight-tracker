#!/usr/bin/env python3
"""讀取 watches.json,查詢 Google Flights 價格,寫入歷史紀錄,並在有優惠時發 Discord 通知。"""
from __future__ import annotations

import calendar
import json
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from fast_flights import FlightQuery, Passengers, create_query

from price_logic import can_notify, evaluate_deal, mark_notified, utcnow
from notify import send_discord_alert
from _resilient_flights import resilient_get_flights

ROOT = Path(__file__).resolve().parent.parent
# watches.json 是這個工具的「資料庫」:GitHub Actions 排程讀它來查價,
# docs/manage.html 透過 Cloudflare Pages Functions 呼叫 GitHub API 改它。
CONFIG_PATH = ROOT / "config" / "watches.json"
# 資料放在 docs/data 底下,這樣 Cloudflare Pages 把 docs/ 當建置輸出目錄時,
# 資料檔會跟著網頁一起部署,面板才抓得到。
DATA_DIR = ROOT / "docs" / "data"
STATE_PATH = DATA_DIR / "state.json"
SUMMARY_PATH = DATA_DIR / "summary.json"

TRIP_MAP = {"round_trip": "round-trip", "one_way": "one-way", "multi_city": "multi-city"}


@dataclass
class QueryInstance:
    """展開日期後,單次要送出的查詢。"""

    legs: list[dict]  # [{from, to, date}, ...]
    desc: str  # 給歷史紀錄/通知看的可讀字串


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def load_json(path: Path, default):
    if not path.exists():
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def month_bounds(month_str: str) -> tuple[date, date]:
    year, month = (int(x) for x in month_str.split("-"))
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


def expand_instances(watch: dict) -> list[QueryInstance]:
    """把 watch 設定展開成一組或多組要查詢的日期組合。"""
    trip = watch["trip"]

    if trip == "multi_city":
        legs = watch["legs"]
        desc = " → ".join(f"{leg['from']}-{leg['to']}({leg['date']})" for leg in legs)
        return [QueryInstance(legs=legs, desc=desc)]

    origin, dest = watch["from"], watch["to"]
    date_mode = watch.get("date_mode", "fixed")

    if date_mode == "fixed":
        depart_dates = [watch["depart_date"]]
        stay_lengths = None
        return_date_fixed = watch.get("return_date")
    elif date_mode == "range":
        start, end = watch["depart_date_range"]
        depart_dates = [
            d.isoformat()
            for d in daterange(date.fromisoformat(start), date.fromisoformat(end))
        ]
        stay_lengths = watch.get("stay_length_days")
        return_date_fixed = None
    elif date_mode == "month":
        start, end = month_bounds(watch["month"])
        depart_dates = [d.isoformat() for d in daterange(start, end)]
        stay_lengths = watch.get("stay_length_days")
        return_date_fixed = None
    else:
        raise ValueError(f"unknown date_mode: {date_mode}")

    instances: list[QueryInstance] = []
    if trip == "one_way":
        for dep in depart_dates:
            legs = [{"from": origin, "to": dest, "date": dep}]
            instances.append(QueryInstance(legs=legs, desc=f"{origin}-{dest}({dep})"))
    elif trip == "round_trip":
        if return_date_fixed:
            legs = [
                {"from": origin, "to": dest, "date": depart_dates[0]},
                {"from": dest, "to": origin, "date": return_date_fixed},
            ]
            instances.append(
                QueryInstance(
                    legs=legs,
                    desc=f"{origin}-{dest}({depart_dates[0]}) / {dest}-{origin}({return_date_fixed})",
                )
            )
        else:
            for dep in depart_dates:
                for stay in stay_lengths or [7]:
                    ret = (date.fromisoformat(dep) + timedelta(days=stay)).isoformat()
                    legs = [
                        {"from": origin, "to": dest, "date": dep},
                        {"from": dest, "to": origin, "date": ret},
                    ]
                    instances.append(
                        QueryInstance(
                            legs=legs,
                            desc=f"{origin}-{dest}({dep}) / {dest}-{origin}({ret}, 住{stay}天)",
                        )
                    )
    else:
        raise ValueError(f"unknown trip type: {trip}")

    return instances


def select_run_batch(
    watch_id: str, instances: list[QueryInstance], max_per_run: int, rotation_state: dict
) -> list[QueryInstance]:
    """若展開後的候選組合太多,依輪替 offset 取一批,下次執行接著取下一批。"""
    if len(instances) <= max_per_run:
        return instances

    offset = rotation_state.get(watch_id, 0) % len(instances)
    batch = [instances[(offset + i) % len(instances)] for i in range(max_per_run)]
    rotation_state[watch_id] = (offset + max_per_run) % len(instances)
    return batch


def run_query(watch: dict, flights: list[FlightQuery], trip: str):
    query = create_query(
        flights=flights,
        trip=trip,
        seat=watch.get("seat", "economy"),
        passengers=Passengers(adults=watch.get("passengers", 1)),
        currency="TWD",
    )
    return resilient_get_flights(query)


def pick_cheapest(result_list) -> Optional[object]:
    if not result_list:
        return None
    return min(result_list, key=lambda f: f.price)


# fast-flights 目前的解析器在 3 段以上的 multi-city 查詢會壞掉(payload 結構跟
# 2 段以下不同,是套件本身的 bug)。3 段以上時改成每段各自查單程價格再相加,
# 標記為估計價(不是真實的聯程票價,但實務上足以拿來追蹤趨勢)。
MULTI_CITY_NATIVE_LEG_LIMIT = 2


def fetch_instance_record(watch: dict, instance: QueryInstance) -> Optional[dict]:
    trip = watch["trip"]

    if trip == "multi_city" and len(instance.legs) > MULTI_CITY_NATIVE_LEG_LIMIT:
        total_price = 0
        all_airlines: list[str] = []
        for leg in instance.legs:
            fq = [FlightQuery(date=leg["date"], from_airport=leg["from"], to_airport=leg["to"])]
            try:
                result = run_query(watch, fq, "one-way")
            except Exception as exc:  # noqa: BLE001
                print(
                    f"[warn] leg query failed for {watch['id']} ({leg['from']}-{leg['to']} {leg['date']}): {exc}",
                    file=sys.stderr,
                )
                return None
            cheapest = pick_cheapest(result)
            if cheapest is None:
                return None
            total_price += cheapest.price
            all_airlines.extend(cheapest.airlines)
        return {
            "price": total_price,
            "currency": "TWD",
            "airlines": sorted(set(all_airlines)),
            "query_desc": f"{instance.desc}(估計:分段單程相加,非聯程票價)",
        }

    flights = [
        FlightQuery(date=leg["date"], from_airport=leg["from"], to_airport=leg["to"])
        for leg in instance.legs
    ]
    try:
        result = run_query(watch, flights, TRIP_MAP[trip])
    except Exception as exc:  # noqa: BLE001 - 個別查詢失敗不應中斷整個排程
        print(f"[warn] query failed for {watch['id']} ({instance.desc}): {exc}", file=sys.stderr)
        return None
    cheapest = pick_cheapest(result)
    if cheapest is None:
        return None
    return {
        "price": cheapest.price,
        "currency": "TWD",
        "airlines": cheapest.airlines,
        "query_desc": instance.desc,
    }


def append_history(watch_id: str, record: dict) -> None:
    path = DATA_DIR / f"{watch_id}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def read_history(watch_id: str) -> list[dict]:
    path = DATA_DIR / f"{watch_id}.jsonl"
    if not path.exists():
        return []
    with open(path, "r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def main() -> None:
    config = load_config()
    watches = config["watches"]
    max_per_run = config.get("max_candidates_per_run", 8)
    cooldown_hours = config.get("notify_cooldown_hours", 24)

    state = load_json(STATE_PATH, {})
    rotation_state = state.setdefault("_rotation", {})
    notify_state = state.setdefault("_notify", {})

    webhook_url = os.environ.get("DISCORD_WEBHOOK_URL")
    now = utcnow()
    summary = {"generated_at": now.isoformat(), "watches": []}

    for watch in watches:
        watch_id = watch["id"]
        print(f"[info] processing {watch_id}")

        instances = expand_instances(watch)
        batch = select_run_batch(watch_id, instances, max_per_run, rotation_state)

        best_this_run = None
        for instance in batch:
            fetched = fetch_instance_record(watch, instance)
            if fetched is None:
                continue

            record = {"timestamp": now.isoformat(), **fetched}
            append_history(watch_id, record)

            if best_this_run is None or record["price"] < best_this_run["price"]:
                best_this_run = record

        history = read_history(watch_id)
        history_prices = [h["price"] for h in history]
        alert_cfg = watch.get("alert", {})

        is_deal, reason = (False, "")
        if best_this_run is not None:
            is_deal, reason = evaluate_deal(
                current_price=best_this_run["price"],
                history_prices=history_prices[:-1],  # 跟「這次以前」的歷史比較
                absolute_price=alert_cfg.get("absolute_price_twd"),
                relative_drop_pct=alert_cfg.get("relative_drop_pct"),
            )
            if is_deal and webhook_url and can_notify(watch_id, notify_state, now, cooldown_hours):
                send_discord_alert(
                    webhook_url=webhook_url,
                    watch_id=watch_id,
                    route_desc=best_this_run["query_desc"],
                    price=best_this_run["price"],
                    currency=best_this_run["currency"],
                    reason=reason,
                    airlines=best_this_run["airlines"],
                )
                mark_notified(notify_state, watch_id, now)
                print(f"[info] sent discord alert for {watch_id}: {reason}")
            elif is_deal and not webhook_url:
                print(f"[warn] {watch_id} is a deal ({reason}) but DISCORD_WEBHOOK_URL not set")

        summary["watches"].append(
            {
                "id": watch_id,
                "trip": watch["trip"],
                "current_cheapest": best_this_run,
                "historical_min": min(history_prices) if history_prices else None,
                "history": [{"timestamp": h["timestamp"], "price": h["price"]} for h in history],
                "alert": alert_cfg,
                "is_deal": is_deal,
                "deal_reason": reason,
            }
        )

    save_json(SUMMARY_PATH, summary)
    save_json(STATE_PATH, state)


if __name__ == "__main__":
    main()
