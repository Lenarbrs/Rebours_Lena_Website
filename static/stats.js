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
  const data = await apiGet("/api/stats").catch(() => null);

  const total = Number(data?.total_movies ?? 0);
  els.totalMovies.textContent = String(total);

  if (!data || !Number.isFinite(total) || total <= 0) {
    els.statsEmpty.hidden = false;
    destroyCharts();
    return;
  }

  els.statsEmpty.hidden = true;

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

  // years: accepte dict {"1999": 3, ...} OU [{label,value}] OU [{year,count}]
  charts.push(
    makeBar(
      els.chartYears,
      normalizeItems(
        data.years_distribution,
        { yearKeys: ["year"], valueKeys: ["count", "value"] },
        true
      ),
      "Count"
    )
  );
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

/**
 * Normalize API outputs:
 * - Accepts: [{label,value}], [{year,count}], {label: value}, {year: count}
 */
function normalizeItems(input, opt = {}, sortNumericLabels = false) {
  const yearKeys = opt.yearKeys || ["label", "year"];
  const valueKeys = opt.valueKeys || ["value", "count"];

  let items = [];

  if (Array.isArray(input)) {
    items = input.map((x) => {
      if (x && typeof x === "object") {
        const label =
          x.label ?? x.year ?? x.key ?? x.name ?? String(x[yearKeys[0]] ?? "");
        const value =
          x.value ?? x.count ?? x.val ?? Number(x[valueKeys[0]] ?? 0);
        return { label: String(label), value: Number(value) || 0 };
      }
      return { label: String(x), value: 0 };
    });
  } else if (input && typeof input === "object") {
    items = Object.entries(input).map(([k, v]) => ({
      label: String(k),
      value: Number(v) || 0,
    }));
  }

  // Clean
  items = items
    .filter((x) => x.label && Number.isFinite(x.value))
    .map((x) => ({ label: x.label.trim(), value: x.value }));

  // Sort
  if (sortNumericLabels) {
    items.sort((a, b) => Number(a.label) - Number(b.label));
  } else {
    items.sort((a, b) => b.value - a.value);
  }

  return items;
}

function makeBar(canvas, items, yLabel) {
  const labels = (items || []).map((x) => x.label);
  const values = (items || []).map((x) => x.value);

  return new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: yLabel, data: values }],
    },
    options: {
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
    },
  });
}

function initTheme() {
  const saved = localStorage.getItem(STORAGE.theme) || "dark";
  setTheme(saved);
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  setTheme(cur === "dark" ? "light" : "dark");
  setTimeout(() => boot(), 0); // redraw charts with new colors
}

function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem(STORAGE.theme, t);
  if (els.themeBtn) {
    els.themeBtn.setAttribute("aria-pressed", t === "light" ? "true" : "false");
    els.themeBtn.innerHTML = t === "dark" ? "🌙 Dark Mode" : "☀️ Light Mode";
  }
}
