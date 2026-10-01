const $ = (id) => document.getElementById(id);

const TRIP_LABEL = {
  round_trip: "來回",
  one_way: "單程",
  multi_city: "多城市",
};

let editingId = null;
let legsState = [];
let currentWatches = [];

function showAlert(message, kind = "error") {
  const box = $("alert-box");
  box.textContent = message;
  box.className = `alert-box alert-box--${kind}`;
  box.hidden = false;
}

function hideAlert() {
  $("alert-box").hidden = true;
}

function updateFieldVisibility() {
  const trip = $("f-trip").value;
  const dateMode = $("f-date-mode").value;
  const isMultiCity = trip === "multi_city";

  $("simple-fields").hidden = isMultiCity;
  $("multi-city-fields").hidden = !isMultiCity;

  $("date-fixed").hidden = dateMode !== "fixed";
  $("date-range").hidden = dateMode !== "range";
  $("date-month").hidden = dateMode !== "month";

  $("return-date-wrap").hidden = trip !== "round_trip" || dateMode !== "fixed";
  $("stay-length-wrap").hidden = !(trip === "round_trip" && dateMode !== "fixed");
}

function renderLegsList() {
  const container = $("legs-list");
  container.innerHTML = "";
  legsState.forEach((leg, i) => {
    const row = document.createElement("div");
    row.className = "leg-row";
    row.innerHTML = `
      <input type="text" maxlength="3" placeholder="出發機場" value="${leg.from || ""}" data-field="from" />
      <input type="text" maxlength="3" placeholder="抵達機場" value="${leg.to || ""}" data-field="to" />
      <input type="date" value="${leg.date || ""}" data-field="date" />
      <button type="button" class="btn-icon" title="刪除這段" ${legsState.length <= 2 ? "disabled" : ""}>✕</button>
    `;
    const [fromInput, toInput, dateInput] = row.querySelectorAll("input");
    fromInput.addEventListener("input", (e) => (leg.from = e.target.value.toUpperCase()));
    toInput.addEventListener("input", (e) => (leg.to = e.target.value.toUpperCase()));
    dateInput.addEventListener("input", (e) => (leg.date = e.target.value));
    row.querySelector("button").addEventListener("click", () => {
      legsState.splice(i, 1);
      renderLegsList();
    });
    container.appendChild(row);
  });
}

function resetForm() {
  editingId = null;
  $("form-title").textContent = "新增監控項目";
  $("cancel-edit-btn").hidden = true;
  $("watch-form").reset();
  $("f-id").disabled = false;
  legsState = [{}, {}];
  renderLegsList();
  updateFieldVisibility();
}

function populateForm(watch) {
  editingId = watch.id;
  $("form-title").textContent = `編輯:${watch.id}`;
  $("cancel-edit-btn").hidden = false;
  $("f-id").value = watch.id;
  $("f-id").disabled = true; // id 是識別碼,編輯時不給改
  $("f-trip").value = watch.trip;
  $("f-passengers").value = watch.passengers || 1;
  $("f-seat").value = watch.seat || "economy";
  $("f-abs-price").value = watch.alert?.absolute_price_twd ?? "";
  $("f-rel-pct").value = watch.alert?.relative_drop_pct ?? "";

  if (watch.trip === "multi_city") {
    legsState = (watch.legs || []).map((l) => ({ ...l }));
    if (legsState.length < 2) legsState.push({});
  } else {
    $("f-from").value = watch.from || "";
    $("f-to").value = watch.to || "";
    $("f-date-mode").value = watch.date_mode || "fixed";
    $("f-depart-date").value = watch.depart_date || "";
    $("f-return-date").value = watch.return_date || "";
    $("f-range-start").value = watch.depart_date_range?.[0] || "";
    $("f-range-end").value = watch.depart_date_range?.[1] || "";
    $("f-month").value = watch.month || "";
    $("f-stay-lengths").value = (watch.stay_length_days || []).join(",");
  }
  renderLegsList();
  updateFieldVisibility();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function collectFormData() {
  const trip = $("f-trip").value;
  const watch = {
    id: $("f-id").value.trim(),
    trip,
    passengers: Number($("f-passengers").value) || 1,
    seat: $("f-seat").value,
  };

  const absPrice = $("f-abs-price").value;
  const relPct = $("f-rel-pct").value;
  if (absPrice !== "" || relPct !== "") {
    watch.alert = {};
    if (absPrice !== "") watch.alert.absolute_price_twd = Number(absPrice);
    if (relPct !== "") watch.alert.relative_drop_pct = Number(relPct);
  }

  if (trip === "multi_city") {
    watch.legs = legsState.map((l) => ({
      from: (l.from || "").toUpperCase(),
      to: (l.to || "").toUpperCase(),
      date: l.date || "",
    }));
  } else {
    watch.from = $("f-from").value.toUpperCase();
    watch.to = $("f-to").value.toUpperCase();
    const dateMode = $("f-date-mode").value;
    watch.date_mode = dateMode;
    if (dateMode === "fixed") {
      watch.depart_date = $("f-depart-date").value;
      if (trip === "round_trip") watch.return_date = $("f-return-date").value;
    } else if (dateMode === "range") {
      watch.depart_date_range = [$("f-range-start").value, $("f-range-end").value];
      if (trip === "round_trip") watch.stay_length_days = parseStayLengths();
    } else if (dateMode === "month") {
      watch.month = $("f-month").value;
      if (trip === "round_trip") watch.stay_length_days = parseStayLengths();
    }
  }

  return watch;
}

function parseStayLengths() {
  return $("f-stay-lengths")
    .value.split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function renderWatchList(watches) {
  const listEl = $("watch-list");
  listEl.innerHTML = "";
  if (watches.length === 0) {
    listEl.innerHTML = '<div class="empty">目前沒有監控項目,用上面的表單新增一筆吧。</div>';
    return;
  }

  for (const watch of watches) {
    const row = document.createElement("div");
    row.className = "watch-row";

    const desc =
      watch.trip === "multi_city"
        ? (watch.legs || []).map((l) => `${l.from}→${l.to}(${l.date})`).join(" / ")
        : `${watch.from}→${watch.to}(${watch.date_mode})`;

    const alertDesc = [];
    if (watch.alert?.absolute_price_twd) alertDesc.push(`低於 ${watch.alert.absolute_price_twd}`);
    if (watch.alert?.relative_drop_pct) alertDesc.push(`歷史低 -${watch.alert.relative_drop_pct}%`);

    row.innerHTML = `
      <div class="watch-row-main">
        <strong>${watch.id}</strong>
        <span class="trip-badge">${TRIP_LABEL[watch.trip] || watch.trip}</span>
        <div class="meta">${desc}</div>
        <div class="meta">${alertDesc.join("、") || "尚未設定優惠門檻"}</div>
      </div>
      <div class="watch-row-actions">
        <button type="button" class="btn-secondary" data-action="edit">編輯</button>
        <button type="button" class="btn-danger" data-action="delete">刪除</button>
      </div>
    `;
    row.querySelector('[data-action="edit"]').addEventListener("click", () => populateForm(watch));
    row.querySelector('[data-action="delete"]').addEventListener("click", () => handleDelete(watch.id));
    listEl.appendChild(row);
  }
}

async function loadWatches() {
  const listEl = $("watch-list");
  listEl.innerHTML = '<div class="empty">載入中...</div>';
  try {
    const res = await fetch("/api/watches");
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    currentWatches = body;
    renderWatchList(currentWatches);
  } catch (err) {
    listEl.innerHTML = `<div class="empty">讀取監控清單失敗:${err.message}<br />這個功能要部署到 Cloudflare Pages 才能用(本機靜態伺服器沒有 /api)。</div>`;
  }
}

async function handleDelete(id) {
  if (!confirm(`確定要刪除「${id}」嗎?`)) return;
  try {
    const res = await fetch(`/api/watches/${encodeURIComponent(id)}`, { method: "DELETE" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    if (editingId === id) resetForm();
    await loadWatches();
  } catch (err) {
    showAlert(`刪除失敗:${err.message}`);
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  hideAlert();
  const watch = collectFormData();
  if (!watch.id) {
    showAlert("id 不能空白");
    return;
  }

  const saveBtn = $("save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "儲存中...(呼叫 GitHub API 約需 1-2 秒)";

  try {
    const url = editingId ? `/api/watches/${encodeURIComponent(editingId)}` : "/api/watches";
    const method = editingId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(watch),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    showAlert(editingId ? "已更新" : "已新增", "success");
    resetForm();
    await loadWatches();
  } catch (err) {
    showAlert(`儲存失敗:${err.message}`);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "儲存";
  }
}

function init() {
  $("f-trip").addEventListener("change", updateFieldVisibility);
  $("f-date-mode").addEventListener("change", updateFieldVisibility);
  $("add-leg-btn").addEventListener("click", () => {
    legsState.push({});
    renderLegsList();
  });
  $("watch-form").addEventListener("submit", handleSubmit);
  $("cancel-edit-btn").addEventListener("click", resetForm);

  resetForm();
  loadWatches();
}

init();
