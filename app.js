const STORAGE_KEY = "newspaper-delivery-map-v1";
const KEY_STORAGE = "newspaper-delivery-google-key";
const LABEL_STORAGE = "newspaper-delivery-show-labels";
const PANEL_HEIGHT_STORAGE = "newspaper-delivery-mobile-panel-height";
const PUBLIC_URL = "https://ob198-cpu.github.io/sinbun/";

const DEFAULT_AREA_ID = "area-default";

const STATUS = {
  planned: { label: "配達予定", color: "#146c94" },
  delivered: { label: "配達完了", color: "#22835f" },
  missed: { label: "未配", color: "#b36b00" },
  wrong: { label: "誤配", color: "#bd3d32" },
  hold: { label: "保留", color: "#6a5acd" }
};

const SAMPLE_STOPS = [
  {
    areaId: DEFAULT_AREA_ID,
    orderNo: 1,
    customerName: "北一条ハイツ 101",
    address: "札幌市中央区北1条西2丁目",
    plannedTime: "03:45",
    copies: 1,
    status: "planned",
    note: "集合ポスト左上"
  },
  {
    areaId: DEFAULT_AREA_ID,
    orderNo: 2,
    customerName: "佐藤様",
    address: "札幌市中央区大通西3丁目",
    plannedTime: "03:50",
    copies: 1,
    status: "delivered",
    note: "玄関横ポスト"
  },
  {
    areaId: "area-south",
    orderNo: 3,
    customerName: "南二条マンション 502",
    address: "札幌市中央区南2条西4丁目",
    plannedTime: "04:05",
    copies: 2,
    status: "missed",
    note: "管理人室へ確認"
  }
];

const SAMPLE_AREAS = [
  { id: DEFAULT_AREA_ID, name: "中央北コース", color: "#146c94" },
  { id: "area-south", name: "中央南コース", color: "#bd3d32" }
];

let stops = [];
let areas = [];
let roster = [];
let selectedRosterId = "";
let pendingPlaceStopId = "";
let expandedRegisteredId = "";
let currentFilter = "all";
let currentAreaId = "all";
let showNameLabels = localStorage.getItem(LABEL_STORAGE) !== "false";
let drawLineMode = false;
let drawLineType = "curve";
let areaAssignMode = false;
let areaSelectionStart = null;
let isSelectingArea = false;
let areaSelectionPreview = null;
let areaRectangles = [];
let map;
let geocoder;
let bounds;
let mapProjection;
let markers = new Map();
let drawnLines = [];
let drawnLineOverlays = [];
let drawingLinePath = [];
let drawingLineStart = null;
let drawingLineOverlay = null;
let isDrawingLine = false;
let mapGesturesLocked = false;
let openInfoWindow;

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function loadState() {
  const params = new URLSearchParams(location.search);
  const shared = params.get("data");
  if (shared) {
    try {
      applyLoadedState(JSON.parse(decodeURIComponent(escape(atob(shared)))));
      saveState();
      history.replaceState(null, "", location.pathname);
      return;
    } catch {
      console.warn("共有データを読み込めませんでした。");
    }
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      applyInitialSampleState();
      saveState();
      return;
    }
    applyLoadedState(JSON.parse(saved));
  } catch {
    applyInitialSampleState();
    saveState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ stops, areas, roster, drawnLines }));
}

function applyLoadedState(value) {
  if (Array.isArray(value)) {
    stops = value.map(stop => ({ ...stop, areaId: stop.areaId || DEFAULT_AREA_ID }));
    areas = defaultAreas();
    roster = [];
    drawnLines = [];
    return;
  }
  stops = (value?.stops || []).map(stop => ({ ...stop, areaId: stop.areaId || DEFAULT_AREA_ID }));
  areas = value?.areas?.length ? value.areas : defaultAreas();
  roster = (value?.roster || []).map(item => ({ ...item, id: item.id || crypto.randomUUID() }));
  drawnLines = value?.drawnLines || [];
}

function applyInitialSampleState() {
  areas = SAMPLE_AREAS.map(area => ({ ...area, bounds: area.bounds || null }));
  stops = SAMPLE_STOPS.map(item => normalizeStop({ ...item, id: crypto.randomUUID() }));
  roster = sampleRosterItems();
  drawnLines = [];
}

function sampleRosterItems() {
  return SAMPLE_STOPS.map(stop => {
    const area = SAMPLE_AREAS.find(item => item.id === stop.areaId) || SAMPLE_AREAS[0];
    return {
      id: crypto.randomUUID(),
      name: stop.customerName,
      address: stop.address,
      areaName: area.name,
      areaId: area.id,
      copies: stop.copies || 1,
      note: stop.note || ""
    };
  });
}

function defaultAreas() {
  return [{ id: DEFAULT_AREA_ID, name: "基本エリア", color: "#146c94", bounds: null }];
}

function currentAreaStops(source = stops) {
  if (currentAreaId === "all") return source;
  return source.filter(stop => stop.areaId === currentAreaId);
}

function ensureAreaByName(name) {
  const cleaned = String(name || "").trim();
  if (!cleaned) return areas[0]?.id || DEFAULT_AREA_ID;
  const found = areas.find(area => area.name === cleaned);
  if (found) return found.id;
  const area = { id: crypto.randomUUID(), name: cleaned, color: randomAreaColor(), bounds: null };
  areas.push(area);
  return area.id;
}

function randomAreaColor() {
  const colors = ["#146c94", "#22835f", "#bd3d32", "#6a5acd", "#b36b00", "#2b6cb0", "#7c3aed"];
  return colors[areas.length % colors.length];
}

function areaById(id) {
  return areas.find(area => area.id === id) || areas[0] || defaultAreas()[0];
}

function nextOrder() {
  return stops.length ? Math.max(...stops.map(stop => Number(stop.orderNo) || 0)) + 1 : 1;
}

function normalizeStop(formData) {
  return {
    id: formData.id || crypto.randomUUID(),
    orderNo: Number(formData.orderNo) || nextOrder(),
    customerName: formData.customerName.trim(),
    address: formData.address.trim(),
    plannedTime: formData.plannedTime,
    copies: Number(formData.copies) || 1,
    status: formData.status,
    areaId: formData.areaId || DEFAULT_AREA_ID,
    note: formData.note.trim(),
    lat: formData.lat || null,
    lng: formData.lng || null,
    updatedAt: new Date().toISOString()
  };
}

function collectForm() {
  return normalizeStop({
    id: $("#stopId").value,
    orderNo: $("#orderNo").value,
    customerName: $("#customerName").value,
    address: $("#address").value,
    areaId: $("#areaSelect").value,
    plannedTime: $("#plannedTime").value,
    copies: 1,
    status: $("#status").value,
    note: $("#note").value
  });
}

function stopFromRoster(item, position = {}) {
  return normalizeStop({
    id: "",
    orderNo: nextOrder(),
    customerName: item.name,
    address: item.address,
    areaId: item.areaId || ensureAreaByName(item.areaName),
    plannedTime: "",
    copies: item.copies || 1,
    status: "planned",
    note: item.note || "",
    lat: position.lat || item.lat || null,
    lng: position.lng || item.lng || null
  });
}

function importRosterItems(items) {
  roster = items;
  items.forEach(item => {
    const existing = stops.find(stop => stop.customerName === item.name && stop.address === item.address);
    const stop = stopFromRoster(item);
    if (existing) {
      stop.id = existing.id;
      stop.orderNo = existing.orderNo;
      stop.lat = existing.lat;
      stop.lng = existing.lng;
      stop.status = existing.status || stop.status;
    }
    upsertStop(stop);
  });
  selectedRosterId = "";
}

function clearForm() {
  $("#stopForm").reset();
  $("#stopId").value = "";
  $("#status").value = "planned";
  $("#orderNo").value = nextOrder();
  $("#areaSelect").value = currentAreaId === "all" ? (areas[0]?.id || DEFAULT_AREA_ID) : currentAreaId;
}

function upsertStop(stop) {
  const index = stops.findIndex(item => item.id === stop.id);
  if (index >= 0) {
    const previous = stops[index];
    if (previous.address === stop.address) {
      stop.lat = previous.lat;
      stop.lng = previous.lng;
    }
    stops[index] = stop;
  } else {
    stops.push(stop);
  }
  stops.sort((a, b) => Number(a.orderNo) - Number(b.orderNo));
  saveState();
  geocodeStop(stop);
  render();
}

function editStop(id) {
  const stop = stops.find(item => item.id === id);
  if (!stop) return;
  $("#stopId").value = stop.id;
  $("#orderNo").value = stop.orderNo;
  $("#customerName").value = stop.customerName;
  $("#address").value = stop.address;
  $("#areaSelect").value = stop.areaId || DEFAULT_AREA_ID;
  $("#plannedTime").value = stop.plannedTime || "";
  $("#status").value = stop.status;
  $("#note").value = stop.note || "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function deleteStop(id) {
  stops = stops.filter(item => item.id !== id);
  saveState();
  render();
  syncMap();
}

function setStatus(id, status) {
  const stop = stops.find(item => item.id === id);
  if (!stop) return;
  stop.status = status;
  stop.updatedAt = new Date().toISOString();
  saveState();
  render();
  syncMap();
}

function setStopPosition(id, latLng) {
  const stop = stops.find(item => item.id === id);
  if (!stop) return;
  stop.lat = latLng.lat();
  stop.lng = latLng.lng();
  stop.updatedAt = new Date().toISOString();
  pendingPlaceStopId = "";
  saveState();
  render();
  syncMap();
}

function saveAreaBounds(name, boundsValue) {
  const area = {
    id: crypto.randomUUID(),
    name,
    color: randomAreaColor(),
    bounds: boundsValue
  };
  areas.push(area);
  currentAreaId = area.id;
  areaAssignMode = false;
  areaSelectionStart = null;
  isSelectingArea = false;
  clearAreaSelectionPreview();
  unlockMapGestures();
  $("#areaAssignBtn")?.classList.remove("active");
  updateMapModeHint("");
  saveState();
  render();
  syncMap({ fit: false });
  jumpToArea(area.id);
}

function moveStopPosition(id, latLng) {
  const stop = stops.find(item => item.id === id);
  if (!stop) return;
  stop.lat = latLng.lat();
  stop.lng = latLng.lng();
  stop.updatedAt = new Date().toISOString();
  saveState();
  render();
  syncMap({ fit: false });
}

function filteredStops() {
  const areaStops = currentAreaStops();
  if (currentFilter === "all") return areaStops;
  if (currentFilter === "pending") return areaStops.filter(stop => ["planned", "missed", "wrong", "hold"].includes(stop.status));
  return areaStops.filter(stop => stop.status === currentFilter);
}

function renderStats() {
  $("#statPlanned").textContent = stops.filter(stop => stop.status === "planned").length;
  $("#statDelivered").textContent = stops.filter(stop => stop.status === "delivered").length;
  $("#statMissed").textContent = stops.filter(stop => stop.status === "missed").length;
  $("#statWrong").textContent = stops.filter(stop => stop.status === "wrong").length;
}

function renderList() {
  const list = $("#stopList");
  list.innerHTML = "";
  const items = filteredStops();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "表示する配達先がありません。";
    list.appendChild(empty);
    return;
  }

  const template = $("#stopTemplate");
  items.forEach(stop => {
    const node = template.content.firstElementChild.cloneNode(true);
    const statusInfo = STATUS[stop.status] || STATUS.planned;
    const area = areaById(stop.areaId);
    node.querySelector(".stop-order").textContent = stop.orderNo;
    node.querySelector("h3").textContent = stop.customerName;
    node.querySelector(".address-line").textContent = stop.address;
    node.querySelector(".meta-line").textContent =
      `${area.name} / ${stop.plannedTime || "--:--"} / 更新 ${formatDateTime(stop.updatedAt)}`;
    node.querySelector(".note-line").textContent = stop.note || "メモなし";
    const pill = node.querySelector(".status-pill");
    pill.textContent = statusInfo.label;
    pill.classList.add(`status-${stop.status}`);
    const placeButton = document.createElement("button");
    placeButton.type = "button";
    placeButton.dataset.action = "place";
    placeButton.textContent = pendingPlaceStopId === stop.id ? "ピン追加中" : "ピン追加";
    const moveButton = document.createElement("button");
    moveButton.type = "button";
    moveButton.dataset.action = "move";
    moveButton.textContent = "移動";
    const editButton = node.querySelector("[data-action='edit']");
    node.querySelector(".card-actions").insertBefore(placeButton, editButton);
    node.querySelector(".card-actions").insertBefore(moveButton, editButton);

    node.querySelectorAll("button").forEach(button => {
      button.addEventListener("click", () => {
        const action = button.dataset.action;
        if (action === "edit") editStop(stop.id);
        if (action === "delete") deleteStop(stop.id);
        if (action === "place") {
          pendingPlaceStopId = stop.id;
          selectedRosterId = "";
          render();
        }
        if (action === "move") jumpToStop(stop.id);
        if (["delivered", "missed", "wrong"].includes(action)) setStatus(stop.id, action);
      });
    });
    list.appendChild(node);
  });
}

function render() {
  renderAreaControls();
  renderRosterList();
  renderRegisteredList();
  renderStats();
  renderList();
}

function renderAreaControls() {
  const select = $("#areaSelect");
  const previous = select.value || DEFAULT_AREA_ID;
  select.innerHTML = areas.map(area => `<option value="${escapeHtml(area.id)}">${escapeHtml(area.name)}</option>`).join("");
  select.value = areas.some(area => area.id === previous) ? previous : (areas[0]?.id || DEFAULT_AREA_ID);

  const tabs = $("#areaTabs");
  tabs.innerHTML = "";
  const allTab = document.createElement("button");
  allTab.type = "button";
  allTab.className = `area-tab ${currentAreaId === "all" ? "active" : ""}`;
  allTab.textContent = "全エリア";
  allTab.dataset.areaId = "all";
  tabs.appendChild(allTab);
  areas.forEach(area => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `area-tab ${currentAreaId === area.id ? "active" : ""}`;
    tab.dataset.areaId = area.id;
    tab.style.setProperty("--tab-color", area.color);
    tab.innerHTML = `<span>${escapeHtml(area.name)} (${stops.filter(stop => stop.areaId === area.id).length})</span><span class="area-tab-delete" data-area-tab-delete="${escapeHtml(area.id)}">×</span>`;
    tabs.appendChild(tab);
  });

  const manageList = $("#areaManageList");
  manageList.innerHTML = "";
  areas.forEach(area => {
    const item = document.createElement("div");
    item.className = "area-manage-item";
    item.innerHTML = `
      <span class="area-swatch" style="background:${escapeHtml(area.color)}"></span>
      <strong>${escapeHtml(area.name)}</strong>
      <button type="button" data-area-edit="${escapeHtml(area.id)}">編集</button>
      <button type="button" class="danger" data-area-delete="${escapeHtml(area.id)}">削除</button>
    `;
    manageList.appendChild(item);
  });
}

function renderRosterList() {
  const list = $("#rosterList");
  if (!list) return;
  const query = ($("#rosterSearch")?.value || "").trim().toLowerCase();
  const items = roster.filter(item => !query || `${item.name} ${item.address} ${item.areaName || ""}`.toLowerCase().includes(query));
  list.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "名簿候補がありません。";
    list.appendChild(empty);
    return;
  }
  items.forEach(item => {
    const node = document.createElement("div");
    const isActive = selectedRosterId === item.id;
    node.className = `roster-item ${isActive ? "active" : ""}`;
    node.draggable = true;
    node.dataset.rosterDragId = item.id;
    node.dataset.rosterId = item.id;
    node.innerHTML = `
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.address)}${item.areaName ? ` / ${escapeHtml(item.areaName)}` : ""}</span>
      </div>
      <button type="button" data-roster-id="${escapeHtml(item.id)}">${isActive ? "選択中" : "選択"}</button>
    `;
    node.addEventListener("pointerdown", () => {
      selectRosterItem(item.id);
    });
    node.addEventListener("click", () => {
      selectRosterItem(item.id);
    });
    node.addEventListener("dragstart", event => {
      selectedRosterId = item.id;
      event.dataTransfer.setData("text/plain", item.id);
      event.dataTransfer.effectAllowed = "copy";
      renderRosterList();
    });
    list.appendChild(node);
  });
}

function renderRegisteredList() {
  const list = $("#registeredList");
  if (!list) return;
  const query = ($("#registeredSearch")?.value || "").trim().toLowerCase();
  const items = stops
    .filter(stop => !query || `${stop.customerName} ${stop.address} ${areaById(stop.areaId).name}`.toLowerCase().includes(query))
    .sort((a, b) => Number(a.orderNo) - Number(b.orderNo));
  list.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "登録済みの名簿がありません。";
    list.appendChild(empty);
    return;
  }

  items.forEach(stop => {
    const statusInfo = STATUS[stop.status] || STATUS.planned;
    const expanded = expandedRegisteredId === stop.id;
    const row = document.createElement("article");
    row.className = `registered-row ${expanded ? "expanded" : ""}`;
    row.innerHTML = `
      <div class="registered-main">
        <div class="registered-title">
          <strong>${escapeHtml(stop.customerName)}</strong>
          <div class="registered-quick-actions">
            <button type="button" data-registered-action="place" data-id="${escapeHtml(stop.id)}">${pendingPlaceStopId === stop.id ? "ピン追加中" : "ピン追加"}</button>
            <button type="button" data-registered-action="move" data-id="${escapeHtml(stop.id)}">移動</button>
            <button type="button" data-registered-action="details" data-id="${escapeHtml(stop.id)}">${expanded ? "閉じる" : "詳細"}</button>
          </div>
        </div>
        ${expanded ? `
          <div class="registered-details">
            <span class="status-pill status-${escapeHtml(stop.status)}">${escapeHtml(statusInfo.label)}</span>
            <p>${escapeHtml(stop.address)}</p>
            <p>${escapeHtml(areaById(stop.areaId).name)}${stop.lat && stop.lng ? " / 位置登録済み" : " / 位置未登録"}</p>
            <div class="card-actions">
              <button type="button" data-registered-action="delivered" data-id="${escapeHtml(stop.id)}">完了</button>
              <button type="button" data-registered-action="missed" data-id="${escapeHtml(stop.id)}">未配</button>
              <button type="button" data-registered-action="wrong" data-id="${escapeHtml(stop.id)}">誤配</button>
              <button type="button" data-registered-action="edit" data-id="${escapeHtml(stop.id)}">編集</button>
            </div>
          </div>
        ` : ""}
      </div>
    `;
    list.appendChild(row);
  });
}

function parseRosterText(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => splitCsvLine(line))
    .filter(cols => !isRosterHeader(cols))
    .filter(cols => cols[0] && cols[1])
    .map(cols => {
      const areaName = cols[2] || "";
      return {
        id: crypto.randomUUID(),
        name: cols[0].trim(),
        address: cols[1].trim(),
        areaName: areaName.trim(),
        areaId: areaName ? ensureAreaByName(areaName) : (areas[0]?.id || DEFAULT_AREA_ID),
        copies: 1,
        note: rosterNoteFromColumns(cols)
      };
    });
}

function isRosterHeader(cols) {
  const first = String(cols[0] || "").trim();
  const second = String(cols[1] || "").trim();
  return first === "名前" && second === "住所";
}

function downloadRosterTemplate() {
  const headers = ["名前", "住所", "エリア", "メモ"];
  const sample = ["山田様", "札幌市中央区北1条西2丁目", "中央北コース", "集合ポスト左上"];
  const rows = [headers, sample]
    .map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <table>
    ${rows}
  </table>
</body>
</html>`;
  const blob = new Blob(["\uFEFF" + html], { type: "application/vnd.ms-excel;charset=utf-8" });
  downloadBlob(blob, "新聞配達_入力用名簿.xls");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 1000);
}

function parseRosterWorkbookText(text) {
  if (/<table[\s>]/i.test(text)) {
    const doc = new DOMParser().parseFromString(text, "text/html");
    const rows = Array.from(doc.querySelectorAll("tr"))
      .map(row => Array.from(row.querySelectorAll("th,td")).map(cell => cell.textContent.trim()))
      .filter(cols => cols.length);
    return rowsToRoster(rows);
  }
  return parseRosterText(text);
}

function parseRosterWorkbookArrayBuffer(buffer) {
  if (!window.XLSX) {
    alert("Excel読込ライブラリを読み込めませんでした。通信状態を確認して、もう一度開き直してください。");
    return [];
  }
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
    header: 1,
    blankrows: false,
    defval: ""
  });
  return rowsToRoster(rows);
}

function rowsToRoster(rows) {
  return rows
    .filter(cols => !isRosterHeader(cols))
    .filter(cols => cols[0] && cols[1])
    .map(cols => {
      const areaName = cols[2] || "";
      return {
        id: crypto.randomUUID(),
        name: cols[0].trim(),
        address: cols[1].trim(),
        areaName: areaName.trim(),
        areaId: areaName ? ensureAreaByName(areaName) : (areas[0]?.id || DEFAULT_AREA_ID),
        copies: 1,
        note: rosterNoteFromColumns(cols)
      };
    });
}

function rosterNoteFromColumns(cols) {
  if (cols.length >= 5 && /^\d+$/.test(String(cols[3] || "").trim())) return String(cols[4] || "").trim();
  return String(cols[3] || "").trim();
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function fillFormFromRoster(item) {
  $("#stopId").value = "";
  $("#orderNo").value = nextOrder();
  $("#customerName").value = item.name;
  $("#address").value = item.address;
  $("#areaSelect").value = item.areaId || ensureAreaByName(item.areaName);
  $("#plannedTime").value = "";
  $("#status").value = "planned";
  $("#note").value = item.note || "";
}

function selectedRoster() {
  return roster.find(item => item.id === selectedRosterId);
}

function selectRosterItem(id) {
  selectedRosterId = id;
  const item = selectedRoster();
  if (item) fillFormFromRoster(item);
  renderRosterList();
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function loadGoogleMaps(apiKey) {
  if (!apiKey) {
    alert("Google Maps APIキーを入力してください。");
    return;
  }
  localStorage.setItem(KEY_STORAGE, apiKey);
  if (window.google?.maps) {
    initMap();
    return;
  }
  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=initMap`;
  script.async = true;
  script.defer = true;
  script.onerror = () => alert("Google Mapsを読み込めませんでした。APIキーとネットワークを確認してください。");
  document.head.appendChild(script);
}

function setupPanelResize() {
  const sidebar = $(".sidebar");
  const handle = $("#panelResizeHandle");
  if (!sidebar || !handle) return;
  const saved = localStorage.getItem(PANEL_HEIGHT_STORAGE);
  if (saved) sidebar.style.setProperty("--mobile-panel-height", saved);

  handle.addEventListener("pointerdown", event => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", event => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    const height = Math.min(Math.max(window.innerHeight - event.clientY, 94), window.innerHeight * 0.78);
    const value = `${Math.round(height)}px`;
    sidebar.style.setProperty("--mobile-panel-height", value);
    localStorage.setItem(PANEL_HEIGHT_STORAGE, value);
  });
  handle.addEventListener("pointerup", event => {
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  });
}

window.initMap = function initMap() {
  const defaultCenter = { lat: 43.0618, lng: 141.3545 };
  map = new google.maps.Map($("#map"), {
    center: defaultCenter,
    zoom: 14,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true
  });
  geocoder = new google.maps.Geocoder();
  setupMapProjection();
  setupMapDrop();
  setupLineDrawing();
  map.addListener("click", event => {
    if (pendingPlaceStopId) {
      setStopPosition(pendingPlaceStopId, event.latLng);
      return;
    }
    const item = selectedRoster();
    if (!item) return;
    upsertStop(stopFromRoster(item, {
      lat: event.latLng.lat(),
      lng: event.latLng.lng()
    }));
    selectedRosterId = "";
    renderRosterList();
  });
  syncMap({ fit: true });
};

function finishAreaSelection(endPoint) {
  if (!areaSelectionStart) return;
  const boundsValue = areaBoundsFromPoints(areaSelectionStart, endPoint);
  drawAreaSelectionPreview(boundsValue);
  if (!confirm("この範囲をエリアとして保存しますか？")) {
    areaSelectionStart = null;
    isSelectingArea = false;
    clearAreaSelectionPreview();
    updateMapModeHint(areaAssignMode ? "エリア指定中: 地図上をドラッグして範囲を指定してください。" : "");
    return;
  }
  const name = prompt("エリア名を入力してください", `エリア${areas.length + 1}`);
  if (!name || !name.trim()) {
    areaSelectionStart = null;
    isSelectingArea = false;
    clearAreaSelectionPreview();
    updateMapModeHint(areaAssignMode ? "エリア指定中: 地図上をドラッグして範囲を指定してください。" : "");
    return;
  }
  saveAreaBounds(name.trim(), boundsValue);
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 640px)").matches;
}

function areaPointFromPointer(event) {
  if (!mapProjection) return;
  const rect = $("#map").getBoundingClientRect();
  const point = new google.maps.Point(event.clientX - rect.left, event.clientY - rect.top);
  const latLng = mapProjection.fromContainerPixelToLatLng(point);
  return latLng ? { lat: latLng.lat(), lng: latLng.lng() } : null;
}

function areaBoundsFromPoints(a, b) {
  return {
    north: Math.max(a.lat, b.lat),
    south: Math.min(a.lat, b.lat),
    east: Math.max(a.lng, b.lng),
    west: Math.min(a.lng, b.lng)
  };
}

function drawAreaSelectionPreview(boundsValue) {
  if (!map || !window.google?.maps) return;
  clearAreaSelectionPreview();
  areaSelectionPreview = new google.maps.Rectangle({
    map,
    bounds: boundsValue,
    strokeColor: "#bd3d32",
    strokeOpacity: 0.95,
    strokeWeight: 2,
    fillColor: "#bd3d32",
    fillOpacity: 0.08,
    clickable: false
  });
}

function clearAreaSelectionPreview() {
  if (areaSelectionPreview) areaSelectionPreview.setMap(null);
  areaSelectionPreview = null;
}

function setupLineDrawing() {
  const drawOverlay = $("#drawOverlay");
  drawOverlay.addEventListener("pointerdown", event => {
    if (areaAssignMode && mapProjection) {
      event.preventDefault();
      event.stopPropagation();
      drawOverlay.setPointerCapture?.(event.pointerId);
      areaSelectionStart = areaPointFromPointer(event);
      isSelectingArea = !!areaSelectionStart;
      if (areaSelectionStart) {
        drawAreaSelectionPreview(areaBoundsFromPoints(areaSelectionStart, areaSelectionStart));
        updateMapModeHint("エリア指定中: そのままドラッグして長方形を作ってください。");
      }
      return;
    }
    if (!drawLineMode || !mapProjection) return;
    event.preventDefault();
    event.stopPropagation();
    drawOverlay.setPointerCapture?.(event.pointerId);
    isDrawingLine = true;
    drawingLineStart = pointToLatLng(event);
    drawingLinePath = [drawingLineStart];
    drawDrawingLine();
  });
  drawOverlay.addEventListener("pointermove", event => {
    if (isSelectingArea && areaAssignMode && mapProjection) {
      event.preventDefault();
      event.stopPropagation();
      const point = areaPointFromPointer(event);
      if (point) drawAreaSelectionPreview(areaBoundsFromPoints(areaSelectionStart, point));
      return;
    }
    if (!isDrawingLine || !drawLineMode || !mapProjection) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointToLatLng(event);
    drawingLinePath = drawLineType === "straight" ? [drawingLineStart, point] : [...drawingLinePath, point];
    drawDrawingLine();
  });
  drawOverlay.addEventListener("pointerup", event => {
    if (isSelectingArea && areaAssignMode && mapProjection) {
      event.preventDefault();
      event.stopPropagation();
      if (drawOverlay.hasPointerCapture?.(event.pointerId)) drawOverlay.releasePointerCapture(event.pointerId);
      const point = areaPointFromPointer(event);
      isSelectingArea = false;
      if (point) finishAreaSelection(point);
      return;
    }
    if (!isDrawingLine || !drawLineMode || !mapProjection) return;
    event.preventDefault();
    event.stopPropagation();
    if (drawOverlay.hasPointerCapture?.(event.pointerId)) drawOverlay.releasePointerCapture(event.pointerId);
    isDrawingLine = false;
    const point = pointToLatLng(event);
    drawingLinePath = drawLineType === "straight" ? [drawingLineStart, point] : [...drawingLinePath, point];
    finishDrawnLine();
  });
  drawOverlay.addEventListener("pointercancel", event => {
    event.preventDefault();
    event.stopPropagation();
    if (drawOverlay.hasPointerCapture?.(event.pointerId)) drawOverlay.releasePointerCapture(event.pointerId);
    isSelectingArea = false;
    isDrawingLine = false;
  });
}

function pointToLatLng(event) {
  const rect = $("#map").getBoundingClientRect();
  const point = new google.maps.Point(event.clientX - rect.left, event.clientY - rect.top);
  const latLng = mapProjection.fromContainerPixelToLatLng(point);
  return { lat: latLng.lat(), lng: latLng.lng() };
}

function drawDrawingLine() {
  if (!map || !window.google?.maps) return;
  if (drawingLineOverlay) drawingLineOverlay.setMap(null);
  if (drawingLinePath.length < 2) return;
  drawingLineOverlay = new google.maps.Polyline({
    path: drawingLinePath,
    map,
    strokeColor: "#bd3d32",
    strokeOpacity: 0.95,
    strokeWeight: 4
  });
}

function finishDrawnLine() {
  if (drawingLineOverlay) drawingLineOverlay.setMap(null);
  drawingLineOverlay = null;
  if (drawingLinePath.length < 2) {
    drawingLinePath = [];
    stopLineDrawing();
    return;
  }
  drawnLines.push({
    id: crypto.randomUUID(),
    path: simplifyLinePath(drawingLinePath),
    type: drawLineType,
    comment: ""
  });
  drawingLinePath = [];
  drawingLineStart = null;
  stopLineDrawing();
  saveState();
  syncMap({ fit: false });
}

function simplifyLinePath(path) {
  if (path.length <= 24) return path;
  const step = Math.ceil(path.length / 24);
  return path.filter((_, index) => index % step === 0 || index === path.length - 1);
}

function drawSavedLines() {
  if (!map || !window.google?.maps) return;
  drawnLineOverlays.forEach(line => line.setMap(null));
  drawnLineOverlays = [];
  drawnLines.forEach(line => {
    const overlay = new google.maps.Polyline({
      path: line.path,
      map,
      strokeColor: "#bd3d32",
      strokeOpacity: 0.95,
      strokeWeight: 5,
      clickable: true
    });
    const hitArea = new google.maps.Polyline({
      path: line.path,
      map,
      strokeColor: "#bd3d32",
      strokeOpacity: 0.01,
      strokeWeight: 22,
      clickable: true
    });
    overlay.addListener("click", event => openLineMenu(line.id, event.latLng));
    hitArea.addListener("click", event => openLineMenu(line.id, event.latLng));
    drawnLineOverlays.push(overlay);
    drawnLineOverlays.push(hitArea);
  });
}

function openLineMenu(lineId, latLng) {
  const line = drawnLines.find(item => item.id === lineId);
  if (!line) return;
  const info = new google.maps.InfoWindow({
    position: latLng,
    content: `
      <div class="map-info">
        <strong>線分メモ</strong>
        <span>${escapeHtml(line.comment || "コメントなし")}</span>
        <div class="map-info-actions">
          <button type="button" data-line-comment="${escapeHtml(line.id)}">コメント追加</button>
          <button type="button" data-line-delete="${escapeHtml(line.id)}">削除</button>
        </div>
      </div>
    `
  });
  if (openInfoWindow) openInfoWindow.close();
  openInfoWindow = info;
  info.open({ map });
  google.maps.event.addListenerOnce(info, "domready", bindLineMenuActions);
}

function bindLineMenuActions() {
  document.querySelectorAll("[data-line-comment]").forEach(button => {
    button.addEventListener("click", () => {
      const line = drawnLines.find(item => item.id === button.dataset.lineComment);
      if (!line) return;
      const comment = prompt("コメントを入力してください", line.comment || "");
      if (comment === null) return;
      line.comment = comment.trim();
      saveState();
      if (openInfoWindow) openInfoWindow.close();
      syncMap({ fit: false });
    });
  });
  document.querySelectorAll("[data-line-delete]").forEach(button => {
    button.addEventListener("click", () => {
      if (!confirm("この線分を削除しますか？")) return;
      drawnLines = drawnLines.filter(line => line.id !== button.dataset.lineDelete);
      saveState();
      if (openInfoWindow) openInfoWindow.close();
      syncMap({ fit: false });
    });
  });
}

function setupMapProjection() {
  const overlay = new google.maps.OverlayView();
  overlay.onAdd = function onAdd() {};
  overlay.draw = function draw() {
    mapProjection = overlay.getProjection();
  };
  overlay.onRemove = function onRemove() {};
  overlay.setMap(map);
}

function setupMapDrop() {
  const mapNode = $("#map");
  mapNode.addEventListener("dragover", event => {
    if (!Array.from(event.dataTransfer.types).includes("text/plain")) return;
    event.preventDefault();
    mapNode.classList.add("drop-ready");
  });
  mapNode.addEventListener("dragleave", () => {
    mapNode.classList.remove("drop-ready");
  });
  mapNode.addEventListener("drop", event => {
    event.preventDefault();
    mapNode.classList.remove("drop-ready");
    const rosterId = event.dataTransfer.getData("text/plain") || selectedRosterId;
    const item = roster.find(entry => entry.id === rosterId);
    if (!item || !mapProjection) return;
    const rect = mapNode.getBoundingClientRect();
    const point = new google.maps.Point(event.clientX - rect.left, event.clientY - rect.top);
    const latLng = mapProjection.fromContainerPixelToLatLng(point);
    if (!latLng) return;
    selectedRosterId = rosterId;
    upsertStop(stopFromRoster(item, { lat: latLng.lat(), lng: latLng.lng() }));
    selectedRosterId = "";
    renderRosterList();
  });
}

function geocodeStop(stop) {
  if (!geocoder || !stop.address || (stop.lat && stop.lng)) return;
  geocoder.geocode({ address: stop.address }, (results, status) => {
    if (status === "OK" && results[0]) {
      const location = results[0].geometry.location;
      stop.lat = location.lat();
      stop.lng = location.lng();
      saveState();
      syncMap();
    }
  });
}

function markerLabel(stop) {
  return {
    text: String(stop.orderNo),
    color: "#ffffff",
    fontWeight: "700"
  };
}

function syncMap(options = {}) {
  const shouldFit = !!options.fit;
  if (!map || !window.google?.maps) return;
  markers.forEach(marker => marker.setMap(null));
  markers.clear();
  areaRectangles.forEach(rectangle => rectangle.setMap(null));
  areaRectangles = [];

  bounds = new google.maps.LatLngBounds();
  const visibleStops = filteredStops();
  visibleStops.forEach(stop => {
    geocodeStop(stop);
    if (!stop.lat || !stop.lng) return;
    const position = { lat: Number(stop.lat), lng: Number(stop.lng) };
    const marker = new google.maps.Marker({
      map,
      position,
      draggable: true,
      label: showNameLabels ? {
        text: `${stop.orderNo} ${shortName(stop.customerName)}`,
        color: "#1d2433",
        fontWeight: "700"
      } : markerLabel(stop),
      title: `${stop.orderNo}. ${stop.customerName}`,
      icon: pinIcon((STATUS[stop.status] || STATUS.planned).color)
    });
    const info = new google.maps.InfoWindow({ content: markerInfoHtml(stop) });
    marker.addListener("click", () => {
      if (openInfoWindow) openInfoWindow.close();
      openInfoWindow = info;
      info.open({ anchor: marker, map });
      google.maps.event.addListenerOnce(info, "domready", bindMarkerInfoActions);
    });
    marker.addListener("dragend", event => {
      moveStopPosition(stop.id, event.latLng);
    });
    markers.set(stop.id, marker);
    bounds.extend(position);
  });

  drawSavedAreaRectangles();
  drawSavedLines();
  if (shouldFit && !bounds.isEmpty()) map.fitBounds(bounds, 64);
}

function drawSavedAreaRectangles() {
  if (!map || !window.google?.maps) return;
  areas.forEach(area => {
    if (!area.bounds) return;
    const rectangle = new google.maps.Rectangle({
      map,
      bounds: area.bounds,
      strokeColor: area.color,
      strokeOpacity: 0.65,
      strokeWeight: 2,
      fillOpacity: 0,
      clickable: false
    });
    areaRectangles.push(rectangle);
  });
}

function jumpToArea(areaId) {
  const area = areaById(areaId);
  if (!map || !window.google?.maps || !area?.bounds) return;
  map.fitBounds(area.bounds, 48);
}

function jumpToStop(id) {
  const stop = stops.find(item => item.id === id);
  if (!stop) return;
  if (!stop.lat || !stop.lng) {
    alert("この配達先はまだピン位置が登録されていません。ピン追加で位置を登録してください。");
    return;
  }
  if (!map || !window.google?.maps) {
    alert("地図の読み込み後にもう一度押してください。");
    return;
  }
  const position = { lat: Number(stop.lat), lng: Number(stop.lng) };
  map.panTo(position);
  map.setZoom(Math.max(map.getZoom() || 17, 18));
  currentAreaId = "all";
  renderAreaControls();
}

function markerInfoHtml(stop) {
  const statusInfo = STATUS[stop.status] || STATUS.planned;
  return `
    <div class="map-info">
      <strong>${escapeHtml(stop.customerName)}</strong>
      <span>${escapeHtml(stop.address)}</span>
      <span>${escapeHtml(statusInfo.label)} / ${escapeHtml(areaById(stop.areaId).name)}</span>
      <span>ピンはドラッグして位置を修正できます。</span>
      <div class="map-info-actions">
        <button type="button" data-map-status="${escapeHtml(stop.id)}:delivered">完了</button>
        <button type="button" data-map-status="${escapeHtml(stop.id)}:missed">未配</button>
        <button type="button" data-map-status="${escapeHtml(stop.id)}:wrong">誤配</button>
        <button type="button" data-map-edit="${escapeHtml(stop.id)}">編集</button>
      </div>
    </div>
  `;
}

function bindMarkerInfoActions() {
  document.querySelectorAll("[data-map-status]").forEach(button => {
    button.addEventListener("click", () => {
      const [id, status] = button.dataset.mapStatus.split(":");
      setStatus(id, status);
      if (openInfoWindow) openInfoWindow.close();
    });
  });
  document.querySelectorAll("[data-map-edit]").forEach(button => {
    button.addEventListener("click", () => {
      editStop(button.dataset.mapEdit);
      if (openInfoWindow) openInfoWindow.close();
    });
  });
}

function shortName(name) {
  const value = String(name || "").replace(/\s+/g, "");
  return value.length > 9 ? `${value.slice(0, 9)}…` : value;
}

function pinIcon(color) {
  return {
    path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z",
    fillColor: color,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 2,
    scale: 1.55,
    anchor: new google.maps.Point(12, 22),
    labelOrigin: showNameLabels ? new google.maps.Point(12, -8) : new google.maps.Point(12, 9)
  };
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function makeShareLink() {
  const data = btoa(unescape(encodeURIComponent(JSON.stringify({ stops, areas, drawnLines }))));
  return `${PUBLIC_URL}?data=${data}`;
}

function makeGoogleRouteLink() {
  const routeStops = filteredStops()
    .slice()
    .sort((a, b) => Number(a.orderNo) - Number(b.orderNo))
    .filter(stop => stop.address);
  if (routeStops.length < 2) return "";
  const origin = encodeURIComponent(routeStops[0].address);
  const destination = encodeURIComponent(routeStops[routeStops.length - 1].address);
  const waypoints = routeStops.slice(1, -1).slice(0, 8).map(stop => stop.address).join("|");
  const waypointPart = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "";
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypointPart}&travelmode=driving`;
}

async function copyText(text) {
  const output = $("#shareOutput");
  if (output) output.value = text;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    if (!output) return;
    output.select();
    document.execCommand("copy");
  }
}

function summaryText() {
  const missed = stops.filter(stop => stop.status === "missed");
  const wrong = stops.filter(stop => stop.status === "wrong");
  const pending = stops.filter(stop => ["planned", "hold"].includes(stop.status));
  const lines = [
    `配達予定: ${stops.length}件`,
    `完了: ${stops.filter(stop => stop.status === "delivered").length}件`,
    `未配: ${missed.length}件`,
    `誤配: ${wrong.length}件`,
    "",
    ...missed.map(stop => `未配 ${stop.orderNo}. ${stop.customerName} ${stop.address}`),
    ...wrong.map(stop => `誤配 ${stop.orderNo}. ${stop.customerName} ${stop.address}`),
    ...pending.map(stop => `未完了 ${stop.orderNo}. ${stop.customerName} ${stop.address}`)
  ];
  return lines.filter(Boolean).join("\n");
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportCsv() {
  const headers = ["配達順", "購読者・建物名", "住所", "エリア", "予定時刻", "状態", "メモ", "緯度", "経度", "更新日時"];
  const rows = stops.map(stop => [
    stop.orderNo,
    stop.customerName,
    stop.address,
    areaById(stop.areaId).name,
    stop.plannedTime,
    STATUS[stop.status]?.label || stop.status,
    stop.note,
    stop.lat,
    stop.lng,
    stop.updatedAt
  ]);
  const csv = [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `newspaper-delivery-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function showControlPanel(target) {
  $$(".control-tab").forEach(button => {
    button.classList.toggle("active", button.dataset.controlTarget === target);
  });
  $$(".control-panel").forEach(panel => {
    panel.classList.toggle("hidden", panel.dataset.controlPanel !== target);
  });
}

function updateMapModeHint(message) {
  const hint = $("#mapModeHint");
  if (!hint) return;
  hint.textContent = message || "";
  hint.classList.toggle("hidden", !message);
}

function lockMapGestures() {
  if (!map || mapGesturesLocked) return;
  mapGesturesLocked = true;
  map.setOptions({
    draggable: false,
    gestureHandling: "none",
    scrollwheel: false,
    disableDoubleClickZoom: true
  });
  $("#map")?.classList.add("map-gesture-locked");
  $("#drawOverlay")?.classList.remove("hidden");
}

function unlockMapGestures() {
  if (!map || !mapGesturesLocked) return;
  mapGesturesLocked = false;
  map.setOptions({
    draggable: true,
    gestureHandling: "greedy",
    scrollwheel: true,
    disableDoubleClickZoom: false
  });
  $("#map")?.classList.remove("map-gesture-locked");
  $("#drawOverlay")?.classList.add("hidden");
}

function showMobileAreaHint() {
  const hint = $("#mapModeHint");
  if (!hint) return;
  hint.innerHTML = `
    <strong>エリア指定</strong>
    <span>ドラッグで指定を押すと、完了するまでマップを固定します。</span>
    <div class="map-mode-actions">
      <button id="dragAreaBtn" type="button">ドラッグで指定</button>
    </div>
  `;
  hint.classList.remove("hidden");
  $("#dragAreaBtn")?.addEventListener("click", () => {
    areaAssignMode = true;
    areaSelectionStart = null;
    isSelectingArea = false;
    clearAreaSelectionPreview();
    lockMapGestures();
    $("#areaAssignBtn").classList.add("active");
    updateMapModeHint("エリア指定中: 地図上をドラッグして長方形の範囲を指定してください。");
  });
}

function showLineTypeMenu(show) {
  $("#lineTypeMenu")?.classList.toggle("hidden", !show);
}

function startLineDrawing(type) {
  drawLineType = type;
  drawLineMode = true;
  areaAssignMode = false;
  areaSelectionStart = null;
  clearAreaSelectionPreview();
  lockMapGestures();
  showLineTypeMenu(false);
  $("#drawLineBtn").classList.add("active");
  $("#areaAssignBtn").classList.remove("active");
  updateMapModeHint(`線を引く（${drawLineType === "straight" ? "直線" : "曲線"}）: 地図上をドラッグしてください。`);
}

function stopLineDrawing() {
  drawLineMode = false;
  isDrawingLine = false;
  drawingLinePath = [];
  drawingLineStart = null;
  unlockMapGestures();
  showLineTypeMenu(false);
  $("#drawLineBtn").classList.remove("active");
  updateMapModeHint("");
  if (drawingLineOverlay) drawingLineOverlay.setMap(null);
  drawingLineOverlay = null;
}

function handleRegisteredAction(action, id) {
  if (action === "details") {
    expandedRegisteredId = expandedRegisteredId === id ? "" : id;
    renderRegisteredList();
    return;
  }
  if (action === "place") {
    pendingPlaceStopId = id;
    selectedRosterId = "";
    render();
    return;
  }
  if (action === "move") {
    jumpToStop(id);
    return;
  }
  if (action === "edit") {
    editStop(id);
    showControlPanel("new");
    return;
  }
  if (["delivered", "missed", "wrong"].includes(action)) {
    setStatus(id, action);
  }
}

function deleteAreaById(areaId) {
  if (areas.length <= 1) {
    alert("エリアは1つ以上必要です。");
    return;
  }
  const area = areaById(areaId);
  if (!area || !confirm(`${area.name} を削除しますか？`)) return;
  const fallback = areas.find(item => item.id !== areaId);
  stops.forEach(stop => {
    if (stop.areaId === areaId) stop.areaId = fallback.id;
  });
  areas = areas.filter(item => item.id !== areaId);
  if (currentAreaId === areaId) currentAreaId = "all";
  saveState();
  render();
  syncMap();
}

function bindEvents() {
  $("#apiKey").value = localStorage.getItem(KEY_STORAGE) || "";
  $$(".control-tab").forEach(button => {
    button.addEventListener("click", () => showControlPanel(button.dataset.controlTarget));
  });
  $("#showNewBtn").addEventListener("click", () => {
    clearForm();
    showControlPanel("new");
  });
  $("#registeredSearch").addEventListener("input", renderRegisteredList);
  $("#registeredList").addEventListener("click", event => {
    const button = event.target.closest("[data-registered-action]");
    if (!button) return;
    handleRegisteredAction(button.dataset.registeredAction, button.dataset.id);
  });
  $("#loadMapBtn").addEventListener("click", () => loadGoogleMaps($("#apiKey").value.trim()));
  $("#stopForm").addEventListener("submit", event => {
    event.preventDefault();
    upsertStop(collectForm());
    clearForm();
    showControlPanel("roster");
  });
  $("#clearFormBtn").addEventListener("click", clearForm);
  $("#clearRosterBtn").addEventListener("click", () => {
    roster = [];
    selectedRosterId = "";
    saveState();
    renderRosterList();
  });
  $("#rosterSearch").addEventListener("input", renderRosterList);
  $("#rosterList").addEventListener("click", event => {
    const target = event.target.closest("[data-roster-id]");
    if (!target) return;
    pendingPlaceStopId = "";
    selectRosterItem(target.dataset.rosterId);
  });
  $("#downloadRosterTemplateBtn").addEventListener("click", downloadRosterTemplate);
  $("#importRosterFileBtn").addEventListener("click", () => $("#rosterFileInput").click());
  $("#rosterFileInput").addEventListener("change", event => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const isRealExcel = /\.xlsx$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const imported = isRealExcel
        ? parseRosterWorkbookArrayBuffer(reader.result)
        : parseRosterWorkbookText(String(reader.result || ""));
      if (!imported.length) {
        alert("Excelから名簿を読み込めませんでした。名前と住所を入力してください。");
        return;
      }
    importRosterItems(imported);
    $("#rosterInput").value = roster.map(item => [
      item.name,
      item.address,
      item.areaName || areaById(item.areaId).name,
      item.note || ""
    ].map(csvCell).join(",")).join("\n");
      showControlPanel("roster");
      render();
    };
    if (isRealExcel) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file, "utf-8");
    }
    event.target.value = "";
  });
  $("#areaForm").addEventListener("submit", event => {
    event.preventDefault();
    const name = $("#areaName").value.trim();
    if (!name) {
      alert("エリア名を入力してください。");
      return;
    }
    const id = $("#areaId").value || crypto.randomUUID();
    const existing = areas.findIndex(area => area.id === id);
    const previous = existing >= 0 ? areas[existing] : {};
    const area = { ...previous, id, name, color: $("#areaColor").value || "#146c94" };
    if (existing >= 0) {
      areas[existing] = area;
    } else {
      areas.push(area);
    }
    $("#areaForm").reset();
    $("#areaColor").value = "#146c94";
    $("#areaId").value = "";
    saveState();
    render();
    syncMap();
  });
  $("#areaManageList").addEventListener("click", event => {
    const editId = event.target.dataset.areaEdit;
    const deleteId = event.target.dataset.areaDelete;
    if (editId) {
      const area = areaById(editId);
      $("#areaId").value = area.id;
      $("#areaName").value = area.name;
      $("#areaColor").value = area.color;
    }
    if (deleteId) {
      deleteAreaById(deleteId);
    }
  });
  $("#areaTabs").addEventListener("click", event => {
    const deleteButton = event.target.closest("[data-area-tab-delete]");
    if (deleteButton) {
      event.stopPropagation();
      deleteAreaById(deleteButton.dataset.areaTabDelete);
      return;
    }
    const button = event.target.closest("[data-area-id]");
    if (!button) return;
    currentAreaId = button.dataset.areaId;
    render();
    syncMap();
    if (currentAreaId !== "all") jumpToArea(currentAreaId);
    clearForm();
  });
  $("#sampleBtn").addEventListener("click", () => {
    applyInitialSampleState();
    saveState();
    render();
    syncMap();
    clearForm();
  });
  $$(".filter").forEach(button => {
    button.addEventListener("click", () => {
      $$(".filter").forEach(item => item.classList.remove("active"));
      button.classList.add("active");
      currentFilter = button.dataset.filter;
      renderList();
      syncMap();
    });
  });
  $("#todayBtn").addEventListener("click", () => {
    currentFilter = currentFilter === "pending" ? "all" : "pending";
    $$(".filter").forEach(item => item.classList.remove("active"));
    $("#todayBtn").classList.toggle("active", currentFilter === "pending");
    renderList();
    syncMap();
  });
  $("#drawLineBtn").addEventListener("click", () => {
    if (drawLineMode) {
      stopLineDrawing();
      return;
    }
    const willShow = $("#lineTypeMenu").classList.contains("hidden");
    showLineTypeMenu(willShow);
    updateMapModeHint(willShow ? "線の種類を選んでください。" : "");
  });
  $("#straightLineBtn").addEventListener("click", () => startLineDrawing("straight"));
  $("#curveLineBtn").addEventListener("click", () => startLineDrawing("curve"));
  $("#areaAssignBtn").addEventListener("click", () => {
    const nextAreaMode = !$("#areaAssignBtn").classList.contains("active");
    stopLineDrawing();
    areaAssignMode = nextAreaMode && !isMobileViewport();
    areaSelectionStart = null;
    isSelectingArea = false;
    clearAreaSelectionPreview();
    if (areaAssignMode) {
      lockMapGestures();
    } else {
      unlockMapGestures();
    }
    $("#areaAssignBtn").classList.toggle("active", nextAreaMode);
    $("#drawLineBtn").classList.remove("active");
    if (nextAreaMode && isMobileViewport()) {
      showMobileAreaHint();
    } else {
      updateMapModeHint(areaAssignMode ? "エリア指定中: 地図上をドラッグして長方形の範囲を指定してください。" : "");
    }
    showControlPanel("areas");
  });
  $("#nameLabelBtn").addEventListener("click", () => {
    showNameLabels = !showNameLabels;
    localStorage.setItem(LABEL_STORAGE, String(showNameLabels));
    syncMap();
  });
  $("#exportCsvBtn").addEventListener("click", exportCsv);
}

function init() {
  loadState();
  bindEvents();
  setupPanelResize();
  render();
  clearForm();
  const savedKey = localStorage.getItem(KEY_STORAGE);
  if (savedKey) loadGoogleMaps(savedKey);
}

document.addEventListener("DOMContentLoaded", init);
