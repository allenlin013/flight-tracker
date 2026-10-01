"""發送 Discord Webhook 通知。"""
from __future__ import annotations

import requests


def send_discord_alert(
    webhook_url: str,
    watch_id: str,
    route_desc: str,
    price: int,
    currency: str,
    reason: str,
    airlines: list[str],
) -> None:
    airlines_str = "、".join(airlines) if airlines else "未知航空公司"
    content = (
        f"✈️ **優惠通知:{watch_id}**\n"
        f"航線:{route_desc}\n"
        f"目前價格:{price} {currency}({airlines_str})\n"
        f"觸發原因:{reason}"
    )
    resp = requests.post(webhook_url, json={"content": content}, timeout=15)
    resp.raise_for_status()
