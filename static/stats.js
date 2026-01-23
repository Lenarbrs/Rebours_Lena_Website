// static/stats.js
const $ = (s) => document.querySelector(s);

const els = {
  themeBtn: $("#themeBtn"),
  totalMovies: $("#totalMovies"),
  statsEmpty: $("#statsEmpty"),
  chartLanguages: $("#chartLanguages"),
  chartLevels: $("#chartLevels"),
  chartGenres: $("#chartGenres"),
  chartYears: $("#chartYears"),
  mapLanguages: $("#mapLanguages"), // ✅ NEW
};

const STORAGE = { theme: "cinelingua.theme" };
let charts = [];
let langMap = null; // ✅ NEW
let langLayer = null; // ✅ NEW tile layer

initTheme();
els.themeBtn?.addEventListener("click", toggleTheme);

boot();

async function apiGet(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`GET ${url} failed (${r.status})`);
  return await r.json();
}

async function boot() {
  // Tu peux ajouter ?refresh=1 pour bypass le cache côté serveur (voir app.py)
  const data = await apiGet("/api/stats").catch(() => null);

  const total = Number(data?.total_movies ?? 0);
  if (els.totalMovies) els.totalMovies.textContent = String(total);

  if (!data || !Number.isFinite(total) || total <= 0) {
    if (els.statsEmpty) els.statsEmpty.hidden = false;
    destroyChartsAndMap();
    return;
  }

  if (els.statsEmpty) els.statsEmpty.hidden = true;

  destroyChartsAndMap();

  charts.push(
    makeBar(els.chartLanguages, normalizeItems(data.languages_top), "Count"),
  );
  charts.push(
    makeBar(els.chartLevels, normalizeItems(data.levels_top), "Count"),
  );
  charts.push(
    makeBar(els.chartGenres, normalizeItems(data.genres_top), "Count"),
  );

  // Histogramme des années
  const years = normalizeYearDistribution(data.years_distribution);
  charts.push(makeYearHistogram(els.chartYears, years));

  // ✅ NEW: World map of languages
  const langs = normalizeItems(data.languages_top);
  makeLanguageWorldMap(els.mapLanguages, langs);
}

function destroyChartsAndMap() {
  charts.forEach((c) => c?.destroy?.());
  charts = [];

  if (langMap) {
    try {
      langMap.remove();
    } catch (_) {}
    langMap = null;
    langLayer = null;
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

/* Supports:
   - [{label,value}] / [{label,count}]
   - {"label": value}
*/
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

/* years_distribution supports:
   - [{year,count}] OR [{label,value}]
   - {"1999": 12, "2000": 8}
   return [{year, count}] sorted asc
*/
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

  pairs = pairs
    .filter((x) => Number.isFinite(x.year) && x.year > 0)
    .sort((a, b) => a.year - b.year);

  return pairs;
}

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
  const labels = (items || []).map((x) => x.label);
  const values = (items || []).map((x) => x.value);

  return new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ label: yLabel, data: values }] },
    options: baseOptions(),
  });
}

function makeYearHistogram(canvas, pairs) {
  const labels = pairs.map((x) => String(x.year));
  const values = pairs.map((x) => x.count);

  return new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Films", data: values }],
    },
    options: {
      ...baseOptions(),
      plugins: {
        ...baseOptions().plugins,
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: {
            color: axisColor(),
            autoSkip: true,
            maxTicksLimit: 14,
          },
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

/* =========================
   ✅ NEW: World map bubbles
   ========================= */

/**
 * Mapping approximatif langue -> coordonnées (centre “culture/region”).
 * (Tu peux en ajouter autant que tu veux)
 */
const LANG_COORDS = {
  en: { name: "English", lat: 51.5074, lon: -0.1278 }, // London
  fr: { name: "French", lat: 48.8566, lon: 2.3522 }, // Paris
  es: { name: "Spanish", lat: 40.4168, lon: -3.7038 }, // Madrid
  de: { name: "German", lat: 52.52, lon: 13.405 }, // Berlin
  it: { name: "Italian", lat: 41.9028, lon: 12.4964 }, // Rome
  pt: { name: "Portuguese", lat: 38.7223, lon: -9.1393 }, // Lisbon
  ru: { name: "Russian", lat: 55.7558, lon: 37.6173 }, // Moscow
  ja: { name: "Japanese", lat: 35.6762, lon: 139.6503 }, // Tokyo
  ko: { name: "Korean", lat: 37.5665, lon: 126.978 }, // Seoul
  zh: { name: "Chinese", lat: 39.9042, lon: 116.4074 }, // Beijing
  ar: { name: "Arabic", lat: 24.7136, lon: 46.6753 }, // Riyadh
  hi: { name: "Hindi", lat: 28.6139, lon: 77.209 }, // Delhi
  tr: { name: "Turkish", lat: 39.9334, lon: 32.8597 }, // Ankara
  nl: { name: "Dutch", lat: 52.3676, lon: 4.9041 }, // Amsterdam
  sv: { name: "Swedish", lat: 59.3293, lon: 18.0686 }, // Stockholm
  no: { name: "Norwegian", lat: 59.9139, lon: 10.7522 }, // Oslo
  da: { name: "Danish", lat: 55.6761, lon: 12.5683 }, // Copenhagen
  pl: { name: "Polish", lat: 52.2297, lon: 21.0122 }, // Warsaw
  el: { name: "Greek", lat: 37.9838, lon: 23.7275 }, // Athens
  he: { name: "Hebrew", lat: 32.0853, lon: 34.7818 }, // Tel Aviv
  th: { name: "Thai", lat: 13.7563, lon: 100.5018 }, // Bangkok
  id: { name: "Indonesian", lat: -6.2088, lon: 106.8456 }, // Jakarta
  vi: { name: "Vietnamese", lat: 21.0278, lon: 105.8342 }, // Hanoi
  fa: { name: "Persian", lat: 35.6892, lon: 51.389 }, // Tehran
  ro: { name: "Romanian", lat: 44.4268, lon: 26.1025 }, // Bucharest
  cs: { name: "Czech", lat: 50.0755, lon: 14.4378 }, // Prague
  hu: { name: "Hungarian", lat: 47.4979, lon: 19.0402 }, // Budapest
  fi: { name: "Finnish", lat: 60.1699, lon: 24.9384 }, // Helsinki
  uk: { name: "Ukrainian", lat: 50.4501, lon: 30.5234 }, // Kyiv
};

function makeLanguageWorldMap(container, items) {
  if (!container) return;

  // Create map
  langMap = L.map(container, {
    zoomControl: true,
    worldCopyJump: true,
    attributionControl: true,
  }).setView([20, 0], 2);

  // Tiles (light vs dark)
  langLayer = L.tileLayer(tileUrl(), {
    maxZoom: 18,
    attribution: tileAttribution(),
  }).addTo(langMap);

  // Bubble markers
  const filtered = (items || [])
    .map((x) => ({
      code: String(x.label || "")
        .trim()
        .toLowerCase(),
      count: Number(x.value || 0) || 0,
    }))
    .filter((x) => x.code && x.count > 0 && LANG_COORDS[x.code]);

  if (!filtered.length) return;

  const max = Math.max(...filtered.map((x) => x.count));
  const min = Math.min(...filtered.map((x) => x.count));

  filtered.forEach((x) => {
    const meta = LANG_COORDS[x.code];
    const r = bubbleRadius(x.count, min, max);

    const marker = L.circleMarker([meta.lat, meta.lon], {
      radius: r,
      weight: 1,
      opacity: 0.9,
      fillOpacity: 0.35,
      color: themeIsDark() ? "rgba(212,175,55,0.9)" : "rgba(139,0,0,0.9)",
      fillColor: themeIsDark() ? "rgba(212,175,55,0.45)" : "rgba(139,0,0,0.35)",
    }).addTo(langMap);

    marker.bindTooltip(
      `<b>${meta.name}</b> (${x.code})<br/>Films: ${x.count}`,
      { direction: "top", sticky: true, opacity: 0.95 },
    );
  });
}

function bubbleRadius(v, min, max) {
  // radius between 6 and 18, with sqrt scaling
  if (max <= 0) return 8;
  const t = Math.sqrt(v / max);
  return 6 + t * 12;
}

function tileUrl() {
  // Dark: CartoDB Dark Matter (nice for cinema look)
  // Light: OpenStreetMap
  return themeIsDark()
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
}

function tileAttribution() {
  return themeIsDark()
    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';
}

/* Theme */
function initTheme() {
  const saved = localStorage.getItem(STORAGE.theme) || "dark";
  setTheme(saved);
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  setTheme(cur === "dark" ? "light" : "dark");
  // reboot to redraw charts + map with new colors/tiles
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
