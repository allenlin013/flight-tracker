"""優惠判斷與通知節流邏輯。"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional


def evaluate_deal(
    current_price: int,
    history_prices: list[int],
    absolute_price: Optional[int],
    relative_drop_pct: Optional[float],
) -> tuple[bool, str]:
    """回傳 (是否為優惠, 觸發原因說明)。"""
    reasons = []

    if absolute_price is not None and current_price <= absolute_price:
        reasons.append(f"低於絕對門檻 {absolute_price}")

    if relative_drop_pct is not None and history_prices:
        historical_min = min(history_prices)
        threshold = historical_min * (1 - relative_drop_pct / 100)
        if current_price <= threshold:
            reasons.append(
                f"比歷史最低價 {historical_min} 再低 {relative_drop_pct}% 以上"
            )

    return (len(reasons) > 0, "; ".join(reasons))


def can_notify(
    watch_id: str,
    state: dict,
    now: datetime,
    cooldown_hours: int,
) -> bool:
    """檢查是否已過冷卻時間,避免同一個 watch 短時間內重複通知。"""
    last = state.get(watch_id, {}).get("last_notified")
    if not last:
        return True
    last_dt = datetime.fromisoformat(last)
    return (now - last_dt) >= timedelta(hours=cooldown_hours)


def mark_notified(state: dict, watch_id: str, now: datetime) -> None:
    state.setdefault(watch_id, {})["last_notified"] = now.isoformat()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
