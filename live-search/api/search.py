"""Vercel Python Function:即時查詢單一組 one_way / round_trip 航班價格。

跟 scripts/fetch_prices.py 是兩套獨立的查詢邏輯 —— 這支是給「馬上查一次看現在
價格」用的,部署在 Vercel(不是 GitHub Actions),所以沒有共用程式碼模組。
"""
import os
import re
from datetime import date

from flask import Flask, jsonify, request
from fast_flights import FlightQuery, Passengers, create_query

from _resilient_flights import resilient_get_flights

app = Flask(__name__)

AIRPORT_RE = re.compile(r"^[A-Za-z]{3}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TRIP_MAP = {"one_way": "one-way", "round_trip": "round-trip"}

ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
SEARCH_API_KEY = os.environ.get("SEARCH_API_KEY")


def _cors_headers():
    return {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    }


def _json_response(body, status=200):
    resp = jsonify(body)
    resp.status_code = status
    for k, v in _cors_headers().items():
        resp.headers[k] = v
    return resp


def _validate_payload(payload):
    trip = payload.get("trip")
    if trip not in TRIP_MAP:
        return "trip 必須是 one_way 或 round_trip(即時查詢暫不支援 multi_city,請到管理清單用排程追蹤)"

    if not AIRPORT_RE.match(payload.get("from", "")) or not AIRPORT_RE.match(payload.get("to", "")):
        return "from/to 要填 3 碼機場代碼"

    if not DATE_RE.match(payload.get("depart_date", "")):
        return "depart_date 格式要是 YYYY-MM-DD"

    if trip == "round_trip" and not DATE_RE.match(payload.get("return_date", "")):
        return "round_trip 需要 return_date(YYYY-MM-DD)"

    return None


def _build_flights(payload):
    trip = payload["trip"]
    origin = payload["from"].upper()
    dest = payload["to"].upper()
    depart_date = payload["depart_date"]

    flights = [FlightQuery(date=depart_date, from_airport=origin, to_airport=dest)]
    if trip == "round_trip":
        flights.append(FlightQuery(date=payload["return_date"], from_airport=dest, to_airport=origin))
    return flights


def _serialize_result(f):
    legs = [
        {
            "from": leg.from_airport.code,
            "to": leg.to_airport.code,
            "departure": f"{leg.departure.date[0]:04d}-{leg.departure.date[1]:02d}-{leg.departure.date[2]:02d} {leg.departure.time[0]:02d}:{leg.departure.time[1]:02d}",
            "arrival": f"{leg.arrival.date[0]:04d}-{leg.arrival.date[1]:02d}-{leg.arrival.date[2]:02d} {leg.arrival.time[0]:02d}:{leg.arrival.time[1]:02d}",
            "duration_minutes": leg.duration,
            "plane_type": leg.plane_type,
        }
        for leg in f.flights
    ]
    return {
        "price": f.price,
        "currency": "TWD",
        "airlines": f.airlines,
        "stops": max(len(f.flights) - 1, 0),
        "duration_minutes": sum(leg.duration for leg in f.flights),
        "legs": legs,
    }


def handle_search():
    if SEARCH_API_KEY and request.headers.get("X-API-Key") != SEARCH_API_KEY:
        return _json_response({"error": "unauthorized"}, 401)

    payload = request.get_json(silent=True) or {}
    error = _validate_payload(payload)
    if error:
        return _json_response({"error": error}, 400)

    flights = _build_flights(payload)
    query = create_query(
        flights=flights,
        trip=TRIP_MAP[payload["trip"]],
        seat=payload.get("seat", "economy"),
        passengers=Passengers(adults=int(payload.get("passengers", 1))),
        currency="TWD",
    )

    try:
        results = resilient_get_flights(query)
    except Exception as exc:  # noqa: BLE001
        return _json_response(
            {
                "error": (
                    f"查詢失敗:{exc}。有些特定航線 fast-flights 套件本身的解析器會壞掉"
                    "(不是沒航班),可以換個機場或日期試試。"
                )
            },
            502,
        )

    sorted_results = sorted(results, key=lambda f: f.price)[:20]
    return _json_response(
        {
            "query_desc": f"{payload['from'].upper()}-{payload['to'].upper()}",
            "results": [_serialize_result(f) for f in sorted_results],
        }
    )


@app.route("/", methods=["POST", "OPTIONS"])
@app.route("/api/search", methods=["POST", "OPTIONS"])
def search_route():
    if request.method == "OPTIONS":
        resp = app.make_default_options_response()
        for k, v in _cors_headers().items():
            resp.headers[k] = v
        return resp
    return handle_search()
