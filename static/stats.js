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

initTheme();
els.themeBtn.addEventListener("click", toggleTheme);

async function apiGet(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`GET ${url} failed (${r.status})`);
  return await r.json();
}

let charts = [];

boot();

async function boot() {
  const data = await apiGet("/api/stats").catch(() => null);

  if (!data || !data.total_movies) {
    els.statsEmpty.hidden = false;
    els.totalMovies.textContent = "0";
    return;
  }

  els.totalMovies.textContent = String(data.total_movies);

  destroyCharts();
  charts.push(makeBar(els.chartLanguages, data.languages_top, "Count"));
  charts.push(makeBar(els.chartLevels, data.levels_top, "Count"));
  charts.push(makeBar(els.chartGenres, data.genres_top, "Count"));
  charts.push(makeBar(els.chartYears, data.years_distribution, "Count"));
}

function destroyCharts() {
  charts.forEach((c) => c.destroy());
  charts = [];
}

function themeIsDark() {
  const t = document.documentElement.getAttribute("data-theme") || "dark";
  return t === "dark";
}

function axisColor() {
  return themeIsDark() ? "rgba(245, 240, 230, 0.75)" : "rgba(26, 21, 19, 0.7)";
}

function gridColor() {
  return themeIsDark() ? "rgba(212, 175, 55, 0.15)" : "rgba(139, 0, 0, 0.10)";
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
        x: {
          ticks: { color: axisColor() },
          grid: { color: gridColor() },
        },
        y: {
          ticks: { color: axisColor() },
          grid: { color: gridColor() },
        },
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
  setTimeout(() => boot(), 0);
}

function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem(STORAGE.theme, t);
  els.themeBtn.setAttribute("aria-pressed", t === "light" ? "true" : "false");
  els.themeBtn.innerHTML = t === "dark" ? "🌙 Dark Mode" : "☀️ Light Mode";
}
