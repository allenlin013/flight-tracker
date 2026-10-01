// 部署到 Vercel 之後,把下面兩個值換成你自己的。
const SEARCH_API_URL = "https://flight-tracker-three-eta.vercel.app/api/search";
const SEARCH_API_KEY = "836e1b7db71c13cbe2416536d462cc75";

const $ = (id) => document.getElementById(id);

function showAlert(message, kind = "error") {
  const box = $("alert-box");
  box.textContent = message;
  box.className = `alert-box alert-box--${kind}`;
  box.hidden = false;
}

function hideAlert() {
  $("alert-box").hidden = true;
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}小時${m}分`;
}

function buildWatchId(payload) {
  return `${payload.from}-${payload.to}-${payload.depart_date}`.toLowerCase();
}

async function addToWatchlist(payload, btn) {
  btn.disabled = true;
  btn.textContent = "加入中...";
  try {
    const watch = {
      id: buildWatchId(payload),
      trip: payload.trip,
      from: payload.from,
      to: payload.to,
      date_mode: "fixed",
      depart_date: payload.depart_date,
      passengers: payload.passengers,
      seat: payload.seat,
      alert: {},
    };
    if (payload.trip === "round_trip") watch.return_date = payload.return_date;

    const res = await fetch("/api/watches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(watch),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    showAlert(`已加入追蹤清單(${watch.id}),之後排程會持續幫你注意這條航線的價格變化。`, "success");
  } catch (err) {
    showAlert(`加入追蹤清單失敗:${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "➕ 加入追蹤清單";
  }
}

function renderResults(payload, data) {
  const resultsEl = $("results");
  resultsEl.innerHTML = "";

  if (!data.results || data.results.length === 0) {
    resultsEl.innerHTML = '<div class="empty">查不到航班,換個日期或機場試試。</div>';
    return;
  }

  for (const r of data.results) {
    const card = document.createElement("div");
    card.className = "card result-card";
    const first = r.legs[0];
    const last = r.legs[r.legs.length - 1];
    card.innerHTML = `
      <div class="card-header">
        <div class="card-title-group">
          <div class="price-now">${r.price.toLocaleString("zh-TW")}<span class="currency">TWD</span></div>
          <span class="trip-badge">${r.airlines.join("、")}</span>
        </div>
      </div>
      <div class="meta">
        ${first.from} ${first.departure} → ${last.to} ${last.arrival} · ${formatDuration(r.duration_minutes)} ·
        ${r.stops === 0 ? "直飛" : `轉機 ${r.stops} 次`}
      </div>
    `;
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn-secondary";
    addBtn.textContent = "➕ 加入追蹤清單";
    addBtn.addEventListener("click", () => addToWatchlist(payload, addBtn));
    card.appendChild(addBtn);
    resultsEl.appendChild(card);
  }
}

function updateReturnVisibility() {
  $("s-return-wrap").hidden = $("s-trip").value !== "round_trip";
}

async function handleSubmit(e) {
  e.preventDefault();
  hideAlert();

  const payload = {
    trip: $("s-trip").value,
    from: $("s-from").value.toUpperCase(),
    to: $("s-to").value.toUpperCase(),
    depart_date: $("s-depart-date").value,
    passengers: Number($("s-passengers").value) || 1,
    seat: $("s-seat").value,
  };
  if (payload.trip === "round_trip") payload.return_date = $("s-return-date").value;

  const btn = $("search-btn");
  btn.disabled = true;
  btn.textContent = "搜尋中...(約幾秒)";
  $("results").innerHTML = '<div class="empty">查詢中...</div>';

  try {
    const res = await fetch(SEARCH_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": SEARCH_API_KEY },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderResults(payload, data);
  } catch (err) {
    $("results").innerHTML = "";
    showAlert(`查詢失敗:${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔍 搜尋";
  }
}

function init() {
  $("s-trip").addEventListener("change", updateReturnVisibility);
  $("search-form").addEventListener("submit", handleSubmit);
  updateReturnVisibility();
}

init();
