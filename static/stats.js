const $ = (s) => document.querySelector(s);

const els = {
  themeBtn: $("#themeBtn"),
  totalMovies: $("#totalMovies"),
  statsEmpty: $("#statsEmpty"),

  chartLanguages: $("#chartLanguages"),
  chartLevels: $("#chartLevels"),
  chartGenres: $("#chartGenres"),
  chartYears: $("#chartYears"),

  mapCountries: $("#mapCountries"),

  // ✅ NEW: the languages list container
  langList: $("#langList"),
};

const STORAGE = { theme: "cinelingua.theme" };
let charts = [];
let map = null;
let geoLayer = null;
let tileLayer = null;

initTheme();
els.themeBtn?.addEventListener("click", toggleTheme);
boot();

async function apiGet(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`GET ${url} failed (${r.status})`);
  return await r.json();
}

async function boot() {
  const data = await apiGet("/api/stats?refresh=1").catch(() => null);

  const total = Number(data?.total_movies ?? 0);
  if (els.totalMovies) els.totalMovies.textContent = String(total);

  if (!data || !Number.isFinite(total) || total <= 0) {
    if (els.statsEmpty) els.statsEmpty.hidden = false;
    destroyChartsAndMap();
    if (els.langList) els.langList.innerHTML = "";
    return;
  }
  if (els.statsEmpty) els.statsEmpty.hidden = true;

  destroyChartsAndMap();

  // Charts
  charts.push(
    makeBar(els.chartLanguages, normalizeItems(data.languages_top), "Count"),
  );
  charts.push(
    makeBar(els.chartLevels, normalizeItems(data.levels_top), "Count"),
  );
  charts.push(
    makeBar(els.chartGenres, normalizeItems(data.genres_top), "Count"),
  );
  charts.push(
    makeYearHistogram(
      els.chartYears,
      normalizeYearDistribution(data.years_distribution),
    ),
  );

  // ✅ NEW: render full languages list
  renderLangList(els.langList, normalizeItems(data.languages_all || []));

  // countries choropleth (NOW uses country NAMES, not ISO2)
  const countriesAll = normalizeItems(data.countries_all || []);
  await makeCountriesChoroplethMap(els.mapCountries, countriesAll);
}

function destroyChartsAndMap() {
  charts.forEach((c) => c?.destroy?.());
  charts = [];

  if (map) {
    try {
      map.remove();
    } catch (_) {}
    map = null;
    geoLayer = null;
    tileLayer = null;
  }
}

function themeIsDark() {
  const t = document.documentElement.getAttribute("data-theme") || "dark";
  return t === "dark";
}

function axisColor() {
  return themeIsDark() ? "rgba(245, 240, 230, 0.78)" : "rgba(26, 21, 19, 0.72)";
}
function gridColor() {
  return themeIsDark() ? "rgba(212, 175, 55, 0.15)" : "rgba(139, 0, 0, 0.10)";
}

/* -------------------------
   Normalizers
------------------------- */
function normalizeItems(input) {
  let items = [];

  if (Array.isArray(input)) {
    items = input
      .filter((x) => x && typeof x === "object")
      .map((x) => ({
        label: String(x.label ?? x.name ?? x.key ?? ""),
        value: Number(x.value ?? x.count ?? 0) || 0,
      }));
  } else if (input && typeof input === "object") {
    items = Object.entries(input).map(([k, v]) => ({
      label: String(k),
      value: Number(v) || 0,
    }));
  }
  return items.filter((x) => x.label);
}

function normalizeYearDistribution(input) {
  let pairs = [];
  if (Array.isArray(input)) {
    pairs = input.map((x) => ({
      year: Number(x.year ?? x.label),
      count: Number(x.count ?? x.value ?? 0) || 0,
    }));
  } else if (input && typeof input === "object") {
    pairs = Object.entries(input).map(([k, v]) => ({
      year: Number(k),
      count: Number(v) || 0,
    }));
  }
  return pairs
    .filter((x) => Number.isFinite(x.year) && x.year > 0)
    .sort((a, b) => a.year - b.year);
}

/* -------------------------
   Charts
------------------------- */
function baseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: axisColor() } },
      tooltip: { enabled: true },
    },
    scales: {
      x: { ticks: { color: axisColor() }, grid: { color: gridColor() } },
      y: { ticks: { color: axisColor() }, grid: { color: gridColor() } },
    },
  };
}

function makeBar(canvas, items, yLabel) {
  if (!canvas) return null;
  const labels = (items || []).map((x) => x.label);
  const values = (items || []).map((x) => x.value);

  return new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ label: yLabel, data: values }] },
    options: baseOptions(),
  });
}

function makeYearHistogram(canvas, pairs) {
  if (!canvas) return null;
  const labels = pairs.map((x) => String(x.year));
  const values = pairs.map((x) => x.count);

  return new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ label: "Films", data: values }] },
    options: {
      ...baseOptions(),
      plugins: { ...baseOptions().plugins, legend: { display: false } },
      scales: {
        x: {
          ticks: { color: axisColor(), autoSkip: true, maxTicksLimit: 14 },
          grid: { color: gridColor() },
        },
        y: {
          ticks: { color: axisColor() },
          grid: { color: gridColor() },
          beginAtZero: true,
        },
      },
    },
  });
}

/* -------------------------
   ✅ NEW: All languages list renderer
------------------------- */
function renderLangList(container, items) {
  if (!container) return;

  const list = (items || [])
    .filter((x) => x.label)
    .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));

  container.innerHTML = `
    <p class="langlist__meta">${list.length} language(s) • sorted by count</p>
    <div class="langlist__table">
      <div class="langrow langrow--head">
        <div>Language</div>
        <div style="text-align:right">Count</div>
      </div>
      ${list
        .map(
          (x) => `
        <div class="langrow">
          <div class="langrow__code">${escapeHtml(x.label)}</div>
          <div class="langrow__count">${Number(x.value || 0)}</div>
        </div>`,
        )
        .join("")}
    </div>
  `;
}

/* =========================
   Countries choropleth map
   - NOW matches by COUNTRY NAME (ADMIN/name)
   ========================= */

async function makeCountriesChoroplethMap(container, items) {
  if (!container) return;

  // build {countryNameKey: count}
  const counts = {};
  for (const it of items || []) {
    const key = normalizeCountryName(it.label);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + (Number(it.value) || 0);
  }

  const values = Object.values(counts);
  const max = values.length ? Math.max(...values) : 0;

  map = L.map(container, {
    zoomControl: true,
    worldCopyJump: true,
    attributionControl: true,
  }).setView([20, 0], 2);

  tileLayer = L.tileLayer(tileUrl(), {
    maxZoom: 18,
    attribution: tileAttribution(),
  }).addTo(map);

  // GeoJSON world countries
  const geojsonUrl =
    "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson";
  const gj = await fetch(geojsonUrl)
    .then((r) => r.json())
    .catch(() => null);
  if (!gj) return;

  geoLayer = L.geoJSON(gj, {
    style: (feature) => {
      const key = featureCountryKey(feature);
      const v = key ? counts[key] || 0 : 0;
      return countryStyle(v, max);
    },
    onEachFeature: (feature, layer) => {
      const p = feature?.properties || {};
      const name =
        p.ADMIN || p.name || p.NAME || p.NAME_EN || p.formal_en || "Country";

      const key = featureCountryKey(feature);
      const v = key ? counts[key] || 0 : 0;

      layer.bindTooltip(`<b>${escapeHtml(String(name))}</b><br/>Films: ${v}`, {
        sticky: true,
        opacity: 0.95,
      });
    },
  }).addTo(map);
}

function normalizeCountryName(s) {
  const t = String(s || "")
    .trim()
    .toLowerCase();
  if (!t) return null;

  // minimal aliases (add more if needed)
  const alias = {
    "united states": "united states of america",
    usa: "united states of america",
    uk: "united kingdom",
  };

  return alias[t] || t;
}

function featureCountryKey(feature) {
  const p = feature?.properties || {};
  const name =
    p.ADMIN || p.name || p.NAME || p.NAME_EN || p.formal_en || p.BRK_NAME || "";
  return normalizeCountryName(name);
}

function countryStyle(v, max) {
  const baseStroke = themeIsDark()
    ? "rgba(212,175,55,0.25)"
    : "rgba(139,0,0,0.22)";
  const stroke = baseStroke;

  // intensity 0..1
  const t = !max ? 0 : Math.sqrt(v / max);
  const fill = themeIsDark()
    ? `rgba(212,175,55,${0.08 + t * 0.55})`
    : `rgba(139,0,0,${0.06 + t * 0.45})`;

  return {
    color: stroke,
    weight: 1,
    opacity: 0.9,
    fillColor: fill,
    fillOpacity: 1,
  };
}

function tileUrl() {
  return themeIsDark()
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
}

function tileAttribution() {
  return '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* Theme */
function initTheme() {
  const saved = localStorage.getItem(STORAGE.theme) || "dark";
  setTheme(saved);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  setTheme(cur === "dark" ? "light" : "dark");
  setTimeout(() => boot(), 0);
}
function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem(STORAGE.theme, t);
  if (els.themeBtn) {
    els.themeBtn.setAttribute("aria-pressed", t === "light" ? "true" : "false");
    els.themeBtn.innerHTML = t === "dark" ? "🌙 Dark Mode" : "☀️ Light Mode";
  }
}
