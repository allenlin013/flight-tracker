// 驗證規則跟 scripts/fetch_prices.py 的 expand_instances() 對齊,擋掉會讓排程掛掉的設定。
// 回傳 null 代表合法;否則回傳錯誤訊息字串。

const VALID_TRIPS = new Set(["round_trip", "one_way", "multi_city"]);
const VALID_DATE_MODES = new Set(["fixed", "range", "month"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const AIRPORT_RE = /^[A-Za-z]{3}$/;

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

export function validateWatch(watch, { requireId = true } = {}) {
  if (typeof watch !== "object" || watch === null) return "watch 必須是物件";

  if (requireId && !isNonEmptyString(watch.id)) return "id 不能空白";

  if (!VALID_TRIPS.has(watch.trip)) {
    return `trip 必須是 round_trip / one_way / multi_city 其中之一`;
  }

  if (watch.trip === "multi_city") {
    if (!Array.isArray(watch.legs) || watch.legs.length < 2) {
      return "multi_city 至少要有 2 段(legs)";
    }
    for (const [i, leg] of watch.legs.entries()) {
      if (!AIRPORT_RE.test(leg.from || "") || !AIRPORT_RE.test(leg.to || "")) {
        return `第 ${i + 1} 段的 from/to 要填 3 碼機場代碼`;
      }
      if (!DATE_RE.test(leg.date || "")) {
        return `第 ${i + 1} 段的日期格式要是 YYYY-MM-DD`;
      }
    }
  } else {
    if (!AIRPORT_RE.test(watch.from || "") || !AIRPORT_RE.test(watch.to || "")) {
      return "from/to 要填 3 碼機場代碼";
    }
    if (!VALID_DATE_MODES.has(watch.date_mode)) {
      return "date_mode 必須是 fixed / range / month 其中之一";
    }
    if (watch.date_mode === "fixed") {
      if (!DATE_RE.test(watch.depart_date || "")) return "depart_date 格式要是 YYYY-MM-DD";
      if (watch.trip === "round_trip" && !DATE_RE.test(watch.return_date || "")) {
        return "round_trip + fixed 需要 return_date(YYYY-MM-DD)";
      }
    } else if (watch.date_mode === "range") {
      const range = watch.depart_date_range;
      if (!Array.isArray(range) || range.length !== 2 || !DATE_RE.test(range[0]) || !DATE_RE.test(range[1])) {
        return "depart_date_range 要是 [開始日期, 結束日期],格式 YYYY-MM-DD";
      }
      if (watch.trip === "round_trip" && !hasStayLengths(watch)) {
        return "round_trip + range 需要 stay_length_days(非空數字陣列)";
      }
    } else if (watch.date_mode === "month") {
      if (!MONTH_RE.test(watch.month || "")) return "month 格式要是 YYYY-MM";
      if (watch.trip === "round_trip" && !hasStayLengths(watch)) {
        return "round_trip + month 需要 stay_length_days(非空數字陣列)";
      }
    }
  }

  if (watch.alert) {
    const { absolute_price_twd, relative_drop_pct } = watch.alert;
    if (absolute_price_twd != null && typeof absolute_price_twd !== "number") {
      return "alert.absolute_price_twd 要是數字";
    }
    if (relative_drop_pct != null && typeof relative_drop_pct !== "number") {
      return "alert.relative_drop_pct 要是數字";
    }
  }

  return null;
}

function hasStayLengths(watch) {
  return Array.isArray(watch.stay_length_days) && watch.stay_length_days.length > 0;
}
