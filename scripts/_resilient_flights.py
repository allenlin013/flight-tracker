"""比官方 fast_flights.get_flights() 更耐操的查詢函式。

官方解析器(fast_flights.parser.parse_js)遇到任何一筆航班資料缺少價格欄位
(Google 對某些非熱門航線/廉航班機會回傳「需另外查價」的資料,沒有 price 欄
位)就會直接拋 IndexError、整批查詢失敗,連其他正常有價格的航班都拿不到。

這支函式重新實作同一套解析邏輯,但每筆航班資料各自包在 try/except 裡,缺資料
的那筆跳過,其他正常的照樣回傳 —— 用公開的 fetch_flights_html() 自己抓 HTML
再解析,不用改到安裝好的套件本身。
"""
from __future__ import annotations

import json

from fast_flights import fetch_flights_html
from fast_flights.exceptions import FlightsNotFound
from fast_flights.model import (
    Airline,
    Airport,
    Alliance,
    CarbonEmission,
    Flights,
    JsMetadata,
    SimpleDatetime,
    SingleFlight,
)
from fast_flights.parser import ResultList, _parse_time
from selectolax.lexbor import LexborHTMLParser


def resilient_get_flights(query) -> ResultList:
    html = fetch_flights_html(query)
    return _resilient_parse(html)


def _resilient_parse(html: str) -> ResultList:
    parser = LexborHTMLParser(html)
    script = parser.css_first(r"script.ds\:1")
    js = script.text()
    data = js.split("data:", 1)[1].rsplit(",", 1)[0]

    if data.endswith("errorHasStatus: true"):
        raise FlightsNotFound("no flights found; received error")

    payload = json.loads(data)

    alliances, airlines_meta = [], []
    try:
        alliances_data, airlines_data = payload[7][1][0], payload[7][1][1]
        for code, name in alliances_data:
            alliances.append(Alliance(code=code, name=name))
        for code, name in airlines_data:
            airlines_meta.append(Airline(code=code, name=name))
    except (IndexError, TypeError):
        # 某些查詢(例如 3 段以上的多城市行程)metadata 區塊結構不一樣,
        # 這份 metadata 我們實際上沒在用,拿不到就放空,不影響航班結果本身。
        pass
    meta = JsMetadata(alliances=alliances, airlines=airlines_meta)

    flights = ResultList()
    entries = payload[3][0] if isinstance(payload[3], list) else None
    if not entries:
        # 某些查詢(例如 3 段以上的多城市行程)結果放在完全不同的位置,這支函式
        # 目前不處理那種格式,直接回傳空結果而不是整個拋錯。
        flights.metadata = meta
        return flights

    for k in entries:
        try:
            flight = k[0]
            price = k[1][0][1]
            typ = flight[0]
            airlines = flight[1]

            sg_flights = []
            for single_flight in flight[2]:
                from_airport = Airport(code=single_flight[3], name=single_flight[4])
                to_airport = Airport(code=single_flight[6], name=single_flight[5])
                departure = SimpleDatetime(
                    date=tuple(single_flight[20]), time=_parse_time(single_flight[8])
                )
                arrival = SimpleDatetime(
                    date=tuple(single_flight[21]), time=_parse_time(single_flight[10])
                )
                sg_flights.append(
                    SingleFlight(
                        from_airport=from_airport,
                        to_airport=to_airport,
                        departure=departure,
                        arrival=arrival,
                        duration=single_flight[11],
                        plane_type=single_flight[17],
                    )
                )

            extras = flight[22]
            flights.append(
                Flights(
                    type=typ,
                    price=price,
                    airlines=airlines,
                    flights=sg_flights,
                    carbon=CarbonEmission(
                        typical_on_route=extras[8], emission=extras[7]
                    ),
                )
            )
        except (IndexError, TypeError):
            # 這筆資料缺價格或形狀不對(例如需要另外查價的航班),跳過繼續處理下一筆。
            continue

    flights.metadata = meta
    return flights
