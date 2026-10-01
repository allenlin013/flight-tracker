const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const TRIP_LABEL = {
  round_trip: "來回",
  one_way: "單程",
  multi_city: "多城市",
};

const RANGES = [
  { key: "30d", label: "30 天", days: 30 },
  { key: "90d", label: "90 天", days: 90 },
  { key: "all", label: "全部", days: null },
];

let allWatches = [];
const chartInstances = new Map();

function formatTime(iso, opts) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(
    "zh-TW",
    opts || { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
  );
}

function filterHistoryByRange(history, days) {
  if (!days) return history;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return history.filter((h) => new Date(h.timestamp).getTime() >= cutoff);
}

function buildChart(canvas, history) {
  return new Chart(canvas, {
    type: "line",
    data: {
      labels: history.map((h) => formatTime(h.timestamp)),
      datasets: [
        {
          label: "價格 (TWD)",
          data: history.map((h) => h.price),
          borderColor: cssVar("--series-1"),
          backgroundColor: cssVar("--series-1-soft"),
          borderWidth: 2,
          pointRadius: history.length > 40 ? 0 : 3,
          pointHitRadius: 10,
          pointBackgroundColor: cssVar("--series-1"),
          tension: 0,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            label: (ctx) => `${ctx.parsed.y.toLocaleString("zh-TW")} TWD`,
          },
        },
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          grid: { color: cssVar("--gridline") },
          ticks: { color: cssVar("--text-muted"), maxTicksLimit: 6 },
        },
        y: {
          grid: { color: cssVar("--gridline") },
          ticks: {
            color: cssVar("--text-muted"),
            callback: (v) => v.toLocaleString("zh-TW"),
          },
        },
      },
    },
  });
}

function renderCard(watch) {
  const card = document.createElement("div");
  card.className = "card" + (watch.is_deal ? " is-deal" : "");

  const header = document.createElement("div");
  header.className = "card-header";

  const titleGroup = document.createElement("div");
  titleGroup.className = "card-title-group";
  const title = document.createElement("h2");
  title.textContent = watch.id;
  titleGroup.appendChild(title);
  const tripBadge = document.createElement("span");
  tripBadge.className = "trip-badge";
  tripBadge.textContent = TRIP_LABEL[watch.trip] || watch.trip;
  titleGroup.appendChild(tripBadge);
  header.appendChild(titleGroup);

  const priceBlock = document.createElement("div");
  priceBlock.className = "price-block";
  const priceNow = document.createElement("div");
  priceNow.className = "price-now";
  if (watch.current_cheapest) {
    priceNow.innerHTML = `${watch.current_cheapest.price.toLocaleString("zh-TW")}<span class="currency">TWD</span>`;
  } else {
    priceNow.textContent = "尚無資料";
  }
  priceBlock.appendChild(priceNow);
  if (watch.is_deal) {
    const badge = document.createElement("div");
    badge.className = "deal-badge";
    badge.textContent = "🔥 優惠中";
    priceBlock.appendChild(badge);
  }
  header.appendChild(priceBlock);
  card.appendChild(header);

  if (watch.historical_min != null) {
    const min = document.createElement("div");
    min.className = "price-min";
    min.textContent = `追蹤以來最低價:${watch.historical_min.toLocaleString("zh-TW")} TWD`;
    card.appendChild(min);
  }

  if (watch.current_cheapest) {
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${watch.current_cheapest.query_desc} · ${(
      watch.current_cheapest.airlines || []
    ).join("、")}`;
    card.appendChild(meta);
  }

  if (watch.history && watch.history.length > 0) {
    const rangeToggle = document.createElement("div");
    rangeToggle.className = "range-toggle";
    const chartWrap = document.createElement("div");
    chartWrap.className = "chart-wrap";
    const canvas = document.createElement("canvas");
    chartWrap.appendChild(canvas);

    const defaultRange = RANGES[0];
    RANGES.forEach((r) => {
      const btn = document.createElement("button");
      btn.textContent = r.label;
      btn.className = r.key === defaultRange.key ? "active" : "";
      btn.addEventListener("click", () => {
        rangeToggle.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const filtered = filterHistoryByRange(watch.history, r.days);
        const existing = chartInstances.get(canvas);
        if (existing) existing.destroy();
        chartInstances.set(canvas, buildChart(canvas, filtered));
      });
      rangeToggle.appendChild(btn);
    });

    card.appendChild(rangeToggle);
    card.appendChild(chartWrap);
    chartInstances.set(canvas, buildChart(canvas, filterHistoryByRange(watch.history, defaultRange.days)));

    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `原始紀錄(${watch.history.length} 筆)`;
    details.appendChild(summary);

    const table = document.createElement("table");
    table.innerHTML = `<thead><tr><th>時間</th><th>價格 (TWD)</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    for (const h of [...watch.history].reverse()) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${formatTime(h.timestamp)}</td><td>${h.price.toLocaleString("zh-TW")}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    details.appendChild(table);
    card.appendChild(details);
  } else {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "還沒有歷史資料,等排程跑過幾次後就會出現圖表。";
    card.appendChild(empty);
  }

  return card;
}

function applyFilterAndSort(watches) {
  const query = (document.getElementById("search-input").value || "").toLowerCase();
  const sortKey = document.getElementById("sort-select").value;

  let list = watches.filter((w) => {
    if (!query) return true;
    const haystack = `${w.id} ${w.current_cheapest ? w.current_cheapest.query_desc : ""}`.toLowerCase();
    return haystack.includes(query);
  });

  const priceOf = (w) => (w.current_cheapest ? w.current_cheapest.price : Infinity);

  list.sort((a, b) => {
    switch (sortKey) {
      case "price-asc":
        return priceOf(a) - priceOf(b);
      case "price-desc":
        return priceOf(b) - priceOf(a);
      case "id":
        return a.id.localeCompare(b.id);
      case "deal":
      default:
        if (a.is_deal !== b.is_deal) return a.is_deal ? -1 : 1;
        return priceOf(a) - priceOf(b);
    }
  });

  return list;
}

function renderStats(watches) {
  const totalPoints = watches.reduce((sum, w) => sum + (w.history ? w.history.length : 0), 0);
  const deals = watches.filter((w) => w.is_deal).length;
  document.getElementById("stat-total").textContent = watches.length;
  document.getElementById("stat-deals").textContent = deals;
  document.getElementById("stat-points").textContent = totalPoints;
  document.getElementById("stat-row").hidden = watches.length === 0;
}

function renderList() {
  const cardsEl = document.getElementById("cards");
  chartInstances.forEach((chart) => chart.destroy());
  chartInstances.clear();
  cardsEl.innerHTML = "";

  const list = applyFilterAndSort(allWatches);
  if (list.length === 0) {
    cardsEl.innerHTML = '<div class="empty">沒有符合條件的監控項目。</div>';
    return;
  }
  for (const watch of list) {
    cardsEl.appendChild(renderCard(watch));
  }
}

async function main() {
  const cardsEl = document.getElementById("cards");
  const updatedAtEl = document.getElementById("updated-at");
  try {
    const res = await fetch("data/summary.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const summary = await res.json();

    updatedAtEl.textContent = summary.generated_at
      ? `最後更新:${formatTime(summary.generated_at, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : "尚未執行過排程";

    allWatches = summary.watches || [];

    if (allWatches.length === 0) {
      cardsEl.innerHTML = '<div class="empty">目前沒有監控中的行程。</div>';
      return;
    }

    renderStats(allWatches);
    document.getElementById("toolbar").hidden = false;
    document.getElementById("search-input").addEventListener("input", renderList);
    document.getElementById("sort-select").addEventListener("change", renderList);
    renderList();
  } catch (err) {
    updatedAtEl.textContent = "";
    cardsEl.innerHTML = `<div class="empty">讀取資料失敗:${err.message}<br />可能是排程還沒執行過第一次。</div>`;
  }
}

main();
