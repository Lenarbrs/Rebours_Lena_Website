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
};

const STORAGE = { theme: "cinelingua.theme" };
let charts = [];

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
    destroyCharts();
    return;
  }

  if (els.statsEmpty) els.statsEmpty.hidden = true;

  destroyCharts();

  charts.push(
    makeBar(els.chartLanguages, normalizeItems(data.languages_top), "Count")
  );
  charts.push(
    makeBar(els.chartLevels, normalizeItems(data.levels_top), "Count")
  );
  charts.push(
    makeBar(els.chartGenres, normalizeItems(data.genres_top), "Count")
  );

  // Histogramme des années
  const years = normalizeYearDistribution(data.years_distribution);
  charts.push(makeYearHistogram(els.chartYears, years));
}

function destroyCharts() {
  charts.forEach((c) => c?.destroy?.());
  charts = [];
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
