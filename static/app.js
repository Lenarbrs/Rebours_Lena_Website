const $ = (s) => document.querySelector(s);

const els = {
  themeBtn: $("#themeBtn"),

  // favorites
  openFavBtn: $("#openFavBtn"),
  closeFavBtn: $("#closeFavBtn"),
  clearFavBtn: $("#clearFavBtn"),
  favDrawer: $("#favDrawer"),
  favList: $("#favList"),
  favCount: $("#favCount"),

  // preferences
  openPrefsBtn: $("#openPrefsBtn"),
  closePrefsBtn: $("#closePrefsBtn"),
  clearPrefsBtn: $("#clearPrefsBtn"),
  prefsDrawer: $("#prefsDrawer"),
  prefsList: $("#prefsList"),
  prefCount: $("#prefCount"),
  clearPrefsDrawerBtn: $("#clearPrefsDrawerBtn"),

  // filters
  filters: $("#filters"),
  langSelect: $("#langSelect"),
  langInfo: $("#langInfo"),
  genreInput: $("#genreInput"),
  tagList: $("#tagList"),
  suggestions: $("#genreSuggestions"),
  minRating: $("#minRating"),
  maxRuntime: $("#maxRuntime"),
  yearMin: $("#yearMin"),
  yearMax: $("#yearMax"),
  topN: $("#topN"),
  resetBtn: $("#resetBtn"),
  shuffleBtn: $("#shuffleBtn"),
  linguisticLevel: $("#linguisticLevel"),
  sortSelect: $("#sortSelect"),

  // results
  cards: $("#cards"),
  empty: $("#emptyState"),
  resultsMeta: $("#resultsMeta"),
  chips: $("#activeChips"),
  printer: $("#ticketPrinter"),

  // dialog
  dialog: $("#movieDialog"),
  dialogTitle: $("#dialogTitle"),
  dialogSub: $("#dialogSub"),
  dialogOverview: $("#dialogOverview"),
  dialogMeta: $("#dialogMeta"),
  dialogFavBtn: $("#dialogFavBtn"),

  // booth picks (preferences)
  tasteBlock: $("#tasteBlock"),
  boothPicks: $("#boothPicks"),
};

const STORAGE = {
  theme: "cinelingua.theme",
  favorites: "cinelingua.fav",
  fav_cache: "cinelingua.fav_cache",

  prefs: "cinelingua.prefs", // ✅ preferences for personalization
  prefs_cache: "cinelingua.prefs_cache",
};

let selectedGenres = [];

let favorites = new Set(
  JSON.parse(localStorage.getItem(STORAGE.favorites) || "[]")
);
let favCache = JSON.parse(localStorage.getItem(STORAGE.fav_cache) || "{}");

// ✅ preferences are separate
let prefs = new Set(JSON.parse(localStorage.getItem(STORAGE.prefs) || "[]"));
let prefsCache = JSON.parse(localStorage.getItem(STORAGE.prefs_cache) || "{}");

let currentDialogId = null;
let lastResults = [];
let isPrinting = false;

initTheme();
wireUI();
updateCounts();

(async function boot() {
  await Promise.all([hydrateLanguages(), hydrateLinguisticLevels()]);
})();

/* ---------- API helpers ---------- */
async function apiGet(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`GET ${url} failed (${r.status})`);
  return await r.json();
}

async function apiPost(url, payload) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `POST ${url} failed (${r.status})`);
  return data;
}

async function apiMovie(id) {
  const r = await fetch(`/api/movie/${encodeURIComponent(id)}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "Movie not found");
  return data;
}

/* ---------- UI wiring ---------- */
function wireUI() {
  els.themeBtn?.addEventListener("click", toggleTheme);

  // favorites drawer
  els.openFavBtn?.addEventListener("click", openFavDrawer);
  els.closeFavBtn?.addEventListener("click", closeFavDrawer);
  els.clearFavBtn?.addEventListener("click", () => {
    if (favorites.size === 0) return;
    if (confirm("Clear all favorites?")) {
      favorites.clear();
      favCache = {};
      persistFavorites();
      persistFavCache();
      updateCounts();
      renderFav();
      renderCards(applySort(lastResults.slice()));
    }
  });

  // preferences drawer
  els.openPrefsBtn?.addEventListener("click", openPrefsDrawer);
  els.closePrefsBtn?.addEventListener("click", closePrefsDrawer);

  els.clearPrefsBtn?.addEventListener("click", () => clearPreferences());
  els.clearPrefsDrawerBtn?.addEventListener("click", () => clearPreferences());

  function clearPreferences() {
    if (prefs.size === 0) return;
    if (confirm("Clear all preferences used for personalization?")) {
      prefs.clear();
      prefsCache = {};
      persistPrefs();
      persistPrefsCache();
      updateCounts();
      renderPrefs();
      // update booth picks hearts
      repaintBoothPickHearts();
      // sort might change
      renderCards(applySort(lastResults.slice()));
    }
  }

  // language change
  els.langSelect?.addEventListener("change", async () => {
    selectedGenres = [];
    renderTags();

    const lang = normalizeLang(els.langSelect.value);
    if (lang) {
      els.tasteBlock.hidden = false;
      await loadBoothPicks();
    } else {
      els.tasteBlock.hidden = true;
      els.boothPicks.innerHTML = "";
    }

    await updateGenreSuggestions();
  });

  // genres input
  els.genreInput?.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const raw = normalizeGenre(els.genreInput.value);
      if (!raw) return;
      addGenre(raw);
      els.genreInput.value = "";
      await updateGenreSuggestions();
    } else if (
      e.key === "Backspace" &&
      !els.genreInput.value &&
      selectedGenres.length
    ) {
      removeGenre(selectedGenres[selectedGenres.length - 1]);
      await updateGenreSuggestions();
    }
  });

  // submit
  els.filters?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await recommendAndRender();
  });

  // reset optional filters
  els.resetBtn?.addEventListener("click", async () => {
    if (confirm("Clear all optional filters? (Language stays)")) {
      selectedGenres = [];
      renderTags();
      els.genreInput.value = "";
      els.minRating.value = "";
      els.maxRuntime.value = "";
      els.yearMin.value = "";
      els.yearMax.value = "";
      els.linguisticLevel.value = "";
      els.topN.value = 20;

      els.cards.innerHTML = "";
      els.chips.innerHTML = "";
      els.resultsMeta.textContent =
        "Your movie recommendations will appear here (preferences are optional).";
      els.empty.hidden = true;
      lastResults = [];
      await updateGenreSuggestions();
    }
  });

  // surprise
  els.shuffleBtn?.addEventListener("click", async () => {
    if (!lastResults.length) return;
    const pick = lastResults[Math.floor(Math.random() * lastResults.length)];
    await openDialog(pick.id);
  });

  // sort
  els.sortSelect?.addEventListener("change", () => {
    if (!lastResults.length) return;
    renderCards(applySort(lastResults.slice()));
  });

  // dialog favorite
  els.dialogFavBtn?.addEventListener("click", () => {
    if (!currentDialogId) return;
    toggleFavorite(currentDialogId);
    renderDialogFromCacheOrState(currentDialogId);
    updateCounts();
    renderFav();
    renderCards(applySort(lastResults.slice()));
  });

  // click outside drawers
  document.addEventListener("click", (e) => {
    if (els.favDrawer?.classList.contains("open")) {
      if (
        !els.favDrawer.contains(e.target) &&
        !els.openFavBtn.contains(e.target)
      )
        closeFavDrawer();
    }
    if (els.prefsDrawer?.classList.contains("open")) {
      if (
        !els.prefsDrawer.contains(e.target) &&
        !els.openPrefsBtn.contains(e.target)
      )
        closePrefsDrawer();
    }
  });

  // ESC closes dialog
  els.dialog?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") els.dialog.close();
  });
}

/* ---------- Booth Picks (Preferences) ---------- */
async function loadBoothPicks() {
  try {
    const data = await apiGet("/api/booth_picks");
    renderBoothPicks(data.results || []);
  } catch (e) {
    console.error(e);
    els.boothPicks.innerHTML = "";
  }
}

function renderBoothPicks(list) {
  els.boothPicks.innerHTML = "";

  (list || []).slice(0, 20).forEach((m) => {
    // cache into prefsCache (not favorites)
    cachePrefMovie(m);

    const card = document.createElement("article");
    card.className = "pick";
    card.tabIndex = 0;
    card.setAttribute("role", "button");

    const img = document.createElement("img");
    img.className = "pick__poster";
    img.src = posterSrc(m);
    img.alt = `Poster: ${safeTitle(m)}`;
    img.loading = "lazy";

    const meta = document.createElement("div");
    meta.className = "pick__meta";

    const t = document.createElement("div");
    t.className = "pick__title";
    t.textContent = safeTitle(m);

    const s = document.createElement("div");
    s.className = "pick__sub";
    s.textContent = `${yearFromDate(m.release_date)} • ${(
      m.original_language || "??"
    ).toUpperCase()}`;

    const heart = document.createElement("button");
    heart.className = "pick__fav";
    heart.type = "button";
    heart.dataset.mid = String(m.id);

    setPickHeartUI(heart, String(m.id));

    heart.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePref(m.id);
      setPickHeartUI(heart, String(m.id));
      updateCounts();
      renderPrefs();
      // sort might change
      renderCards(applySort(lastResults.slice()));
    });

    meta.appendChild(t);
    meta.appendChild(s);

    card.appendChild(img);
    card.appendChild(meta);
    card.appendChild(heart);

    card.addEventListener("click", async () => await openDialog(m.id));
    card.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        await openDialog(m.id);
      }
    });

    els.boothPicks.appendChild(card);
  });
}

function repaintBoothPickHearts() {
  els.boothPicks?.querySelectorAll(".pick__fav").forEach((btn) => {
    setPickHeartUI(btn, btn.dataset.mid);
  });
}

function setPickHeartUI(btn, id) {
  const on = prefs.has(String(id));
  btn.textContent = on ? "♥" : "♡";
  btn.title = on ? "Remove preference" : "Add preference";
  btn.classList.toggle("is-on", on);
}

/* ---------- Recommendations ---------- */
async function recommendAndRender() {
  if (isPrinting) return;
  isPrinting = true;

  const submitBtn = els.filters?.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  const lang = normalizeLang(els.langSelect.value);
  if (!lang) {
    if (submitBtn) submitBtn.disabled = false;
    isPrinting = false;
    return;
  }

  const loader = showCinematicLoader();

  try {
    const topN = clampInt(els.topN.value, 1, 100) ?? 20;

    const payload = {
      lang,
      genres: selectedGenres,
      top_n: topN,
      min_rating: numOrNull(els.minRating.value),
      max_runtime: numOrNull(els.maxRuntime.value),
      linguistic_level: normalizeMaybe(els.linguisticLevel.value),
      year_min: intOrNull(els.yearMin.value),
      year_max: intOrNull(els.yearMax.value),
    };

    const data = await apiPost("/api/recommendations", payload);
    const result = data.results || [];
    lastResults = result;

    renderChips();
    animatePrinter();

    renderCards(applySort(result.slice()));

    els.empty.hidden = result.length !== 0;

    const personalizationStatus =
      prefs.size >= 3
        ? "Personalization: ON"
        : "Personalization: OFF (preferences optional)";

    els.resultsMeta.textContent = result.length
      ? `🎟️ Ticket printed: ${result.length} film(s) • Language: ${lang} • ${personalizationStatus}`
      : `🎬 No matching films found. Try adjusting your criteria.`;
  } catch (error) {
    console.error(error);
  } finally {
    loader.remove();
    if (submitBtn) submitBtn.disabled = false;
    isPrinting = false;
  }
}

/* ---------- Sorting ---------- */
function applySort(list) {
  const mode = (els.sortSelect?.value || "popular").trim();

  if (mode === "popular")
    return list.sort((a, b) => num(b.popularity) - num(a.popularity));
  if (mode === "rating")
    return list.sort((a, b) => num(b.vote_average) - num(a.vote_average));
  if (mode === "recent") return list.sort((a, b) => yearInt(b) - yearInt(a));
  if (mode === "oldest") return list.sort((a, b) => yearInt(a) - yearInt(b));

  // personalized (preferences-based)
  const profile = buildUserProfileFromPrefs();
  if (!profile) {
    // prefs are optional: fallback
    return list.sort((a, b) => num(b.popularity) - num(a.popularity));
  }

  return list
    .map((m) => ({ m, s: scoreMovie(m, profile) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

function buildUserProfileFromPrefs() {
  const ids = [...prefs];
  const movies = ids.map((id) => prefsCache[String(id)]).filter(Boolean);

  // ✅ require 3 for personalization
  if (movies.length < 3) return null;

  const gCount = new Map();
  let gTotal = 0;

  const years = [];
  const runtimes = [];
  const ratings = [];

  movies.forEach((m) => {
    const gs = extractGenres(m);
    gs.forEach((g) => {
      gCount.set(g, (gCount.get(g) || 0) + 1);
      gTotal += 1;
    });

    const y = yearInt(m);
    if (Number.isFinite(y) && y > 0) years.push(y);

    const rt = Number(m.runtime);
    if (Number.isFinite(rt) && rt > 0) runtimes.push(rt);

    const r = Number(m.vote_average);
    if (Number.isFinite(r)) ratings.push(r);
  });

  const genreWeights = {};
  for (const [g, c] of gCount.entries()) {
    genreWeights[g] = gTotal ? c / gTotal : 0;
  }

  return {
    genreWeights,
    meanYear: mean(years) ?? 2005,
    meanRuntime: mean(runtimes) ?? 110,
    meanRating: mean(ratings) ?? 7.0,
  };
}

function scoreMovie(m, profile) {
  const gs = extractGenres(m);
  const gScore = gs.length
    ? gs.reduce((acc, g) => acc + (profile.genreWeights[g] || 0), 0) / gs.length
    : 0;

  const y = yearInt(m);
  const yearScore = Number.isFinite(y)
    ? Math.exp(-Math.abs(y - profile.meanYear) / 10)
    : 0.35;

  const rt = Number(m.runtime);
  const rtScore = Number.isFinite(rt)
    ? Math.exp(-Math.abs(rt - profile.meanRuntime) / 40)
    : 0.35;

  const r = Number(m.vote_average);
  const ratingScore = Number.isFinite(r)
    ? Math.max(0, Math.min(1, r / 10))
    : 0.5;

  const p = Number(m.popularity);
  const popScore = Number.isFinite(p)
    ? Math.max(0, Math.min(1, Math.log1p(p) / 10))
    : 0.3;

  return (
    0.55 * gScore +
    0.2 * yearScore +
    0.15 * ratingScore +
    0.07 * rtScore +
    0.03 * popScore
  );
}

/* ---------- Cards ---------- */
function renderCards(list) {
  els.cards.innerHTML = "";

  list.forEach((m, index) => {
    cacheFavMovie(m); // ok to cache movie details for dialog & favorites

    const card = document.createElement("article");
    card.className = "card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.style.animationDelay = `${(index + 1) * 0.06}s`;

    const content = document.createElement("div");
    content.className = "card__content";

    const poster = document.createElement("img");
    poster.className = "card__poster";
    poster.src = posterSrc(m);
    poster.alt = `Poster: ${safeTitle(m)}`;
    poster.loading = "lazy";
    content.appendChild(poster);

    const header = document.createElement("div");
    header.className = "card__header";

    const left = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "card__title";
    title.textContent = safeTitle(m);

    const sub = document.createElement("p");
    sub.className = "card__sub";
    sub.textContent = `${safeOriginal(m)} • ${yearFromDate(
      m.release_date
    )} • ${(m.original_language || "??").toUpperCase()}`;

    left.appendChild(title);
    left.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "card__actions";

    const fav = document.createElement("button");
    fav.className = "iconbtn iconbtn--heart";
    fav.type = "button";
    fav.textContent = favorites.has(String(m.id)) ? "♥" : "♡";
    fav.title = favorites.has(String(m.id))
      ? "Remove from favorites"
      : "Add to favorites";
    fav.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(m.id);
      fav.textContent = favorites.has(String(m.id)) ? "♥" : "♡";
      updateCounts();
      renderFav();
    });

    const info = document.createElement("button");
    info.className = "iconbtn";
    info.type = "button";
    info.textContent = "i";
    info.title = "Details";
    info.addEventListener("click", async (e) => {
      e.stopPropagation();
      await openDialog(m.id);
    });

    actions.appendChild(fav);
    actions.appendChild(info);

    header.appendChild(left);
    header.appendChild(actions);

    const badges = document.createElement("div");
    badges.className = "badges";
    badges.appendChild(badge(`Pop ${fmt(m.popularity)}`));
    if (m.vote_average != null)
      badges.appendChild(badge(`${fmt(m.vote_average)}★`));
    if (m.runtime != null) badges.appendChild(badge(`${m.runtime} min`));
    const g1 = extractGenres(m)[0];
    if (g1) badges.appendChild(badge(g1));
    if (m.linguistic_level)
      badges.appendChild(badge(`Level: ${m.linguistic_level}`));
    if (m.linguistic_register)
      badges.appendChild(badge(`Register: ${m.linguistic_register}`));

    content.appendChild(header);
    content.appendChild(badges);
    card.appendChild(content);

    card.addEventListener("click", async () => await openDialog(m.id));
    card.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        await openDialog(m.id);
      }
    });

    els.cards.appendChild(card);
  });
}

/* ---------- Chips (light mode readability) ---------- */
function renderChips() {
  els.chips.innerHTML = "";
  const chips = [];

  const lang = (els.langSelect.value || "").trim();
  if (lang) chips.push(`Language: ${lang}`);

  if (selectedGenres.length) chips.push(`Genres: ${selectedGenres.join(", ")}`);

  const mr = (els.minRating.value || "").trim();
  if (mr) chips.push(`Rating ≥ ${mr}`);

  const rt = (els.maxRuntime.value || "").trim();
  if (rt) chips.push(`Duration ≤ ${rt} min`);

  const ym = (els.yearMin.value || "").trim();
  const yM = (els.yearMax.value || "").trim();
  if (ym || yM) chips.push(`Year: ${ym || "…"} → ${yM || "…"}`);

  const ll = (els.linguisticLevel.value || "").trim();
  if (ll) chips.push(`Level: ${ll.replace(/\b\w/g, (c) => c.toUpperCase())}`);

  chips.push(`TopN: ${clampInt(els.topN.value, 1, 100) ?? 20}`);

  chips.forEach((t) => {
    const c = document.createElement("span");
    c.className = "chip";
    c.textContent = t;
    els.chips.appendChild(c);
  });
}

function animatePrinter() {
  els.printer.classList.remove("is-printing");
  void els.printer.offsetWidth;
  els.printer.classList.add("is-printing");
}

/* ---------- Dialog ---------- */
async function openDialog(id) {
  currentDialogId = String(id);

  const local =
    (lastResults || []).find((x) => String(x.id) === String(id)) ||
    favCache[String(id)] ||
    prefsCache[String(id)];

  if (local) {
    renderDialog(local);
    els.dialog.showModal();
    return;
  }

  try {
    const m = await apiMovie(id);
    cacheFavMovie(m);
    renderDialog(m);
    els.dialog.showModal();
  } catch (err) {
    console.error(err);
  }
}

function renderDialogFromCacheOrState(id) {
  const m =
    (lastResults || []).find((x) => String(x.id) === String(id)) ||
    favCache[String(id)] ||
    prefsCache[String(id)];
  if (m) renderDialog(m);
}

function renderDialog(m) {
  const posterDiv = els.dialog.querySelector(".poster");
  if (posterDiv) posterDiv.style.backgroundImage = `url("${posterSrc(m)}")`;

  els.dialogTitle.textContent = safeTitle(m);
  els.dialogSub.textContent = `${safeOriginal(m)} • ${(
    m.original_language || "??"
  ).toUpperCase()} • ${m.release_date || "Unknown date"}`;

  els.dialogOverview.textContent =
    m.overview || "No synopsis available for this movie.";

  els.dialogMeta.innerHTML = "";
  els.dialogMeta.appendChild(badge(`Popularity: ${fmt(m.popularity)}`));
  if (m.vote_average != null)
    els.dialogMeta.appendChild(badge(`Rating: ${fmt(m.vote_average)}★`));
  if (m.runtime != null)
    els.dialogMeta.appendChild(badge(`Duration: ${m.runtime} min`));

  const gs = extractGenres(m);
  if (gs.length) els.dialogMeta.appendChild(badge(`Genres: ${gs.join(", ")}`));

  if (m.linguistic_level)
    els.dialogMeta.appendChild(badge(`Level: ${m.linguistic_level}`));
  if (m.linguistic_register)
    els.dialogMeta.appendChild(badge(`Register: ${m.linguistic_register}`));

  const isFav = favorites.has(String(m.id));
  els.dialogFavBtn.textContent = isFav ? "♥ Remove Favorite" : "♡ Add Favorite";
}

/* ---------- Favorites + Preferences storage ---------- */
function toggleFavorite(id) {
  id = String(id);
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  persistFavorites();
}

function togglePref(id) {
  id = String(id);
  if (prefs.has(id)) prefs.delete(id);
  else prefs.add(id);
  persistPrefs();
}

function persistFavorites() {
  localStorage.setItem(STORAGE.favorites, JSON.stringify([...favorites]));
}
function persistPrefs() {
  localStorage.setItem(STORAGE.prefs, JSON.stringify([...prefs]));
}

function cacheFavMovie(m) {
  if (!m || !m.id) return;
  favCache[String(m.id)] = m;
  persistFavCache();
}
function cachePrefMovie(m) {
  if (!m || !m.id) return;
  prefsCache[String(m.id)] = m;
  persistPrefsCache();
}

function persistFavCache() {
  localStorage.setItem(STORAGE.fav_cache, JSON.stringify(favCache));
}
function persistPrefsCache() {
  localStorage.setItem(STORAGE.prefs_cache, JSON.stringify(prefsCache));
}

function updateCounts() {
  if (els.favCount) els.favCount.textContent = String(favorites.size);
  if (els.prefCount) els.prefCount.textContent = String(prefs.size);
}

/* ---------- Drawers ---------- */
function openFavDrawer() {
  els.favDrawer.classList.add("open");
  els.favDrawer.setAttribute("aria-hidden", "false");
  renderFav();
}
function closeFavDrawer() {
  els.favDrawer.classList.remove("open");
  els.favDrawer.setAttribute("aria-hidden", "true");
}
function openPrefsDrawer() {
  els.prefsDrawer.classList.add("open");
  els.prefsDrawer.setAttribute("aria-hidden", "false");
  renderPrefs();
}
function closePrefsDrawer() {
  els.prefsDrawer.classList.remove("open");
  els.prefsDrawer.setAttribute("aria-hidden", "true");
}

/* ---------- Render Favorites drawer ---------- */
function renderFav() {
  els.favList.innerHTML = "";
  const ids = [...favorites];

  if (!ids.length) {
    els.favList.innerHTML = `
      <div class="favitem">
        <h3 class="favitem__title">Your favorites collection is empty</h3>
        <p class="favitem__sub">Use ♥ on any movie card to save it here.</p>
      </div>`;
    return;
  }

  const items = ids.map((id) => favCache[id]).filter(Boolean);

  items.forEach((m) => {
    const box = document.createElement("div");
    box.className = "favitem";
    box.innerHTML = `
      <h3 class="favitem__title">${escapeHtml(safeTitle(m))}</h3>
      <p class="favitem__sub">${escapeHtml(safeOriginal(m))} • ${(
      m.original_language || "??"
    ).toUpperCase()} • ${escapeHtml(m.release_date || "Unknown date")}</p>
      <div class="favitem__row">
        <button class="btn btn--ghost" type="button" data-open="1">Details</button>
        <button class="btn btn--ghost" type="button" data-rm="1">Remove</button>
      </div>
    `;
    box
      .querySelector('[data-open="1"]')
      .addEventListener("click", async () => await openDialog(m.id));
    box.querySelector('[data-rm="1"]').addEventListener("click", () => {
      toggleFavorite(m.id);
      updateCounts();
      renderFav();
    });
    els.favList.appendChild(box);
  });
}

/* ---------- Render Preferences drawer ---------- */
function renderPrefs() {
  els.prefsList.innerHTML = "";
  const ids = [...prefs];

  if (!ids.length) {
    els.prefsList.innerHTML = `
      <div class="favitem">
        <h3 class="favitem__title">No preferences yet</h3>
        <p class="favitem__sub">Use ♥ in Booth Picks to help “Best for you”. Not required.</p>
      </div>`;
    return;
  }

  const items = ids.map((id) => prefsCache[id]).filter(Boolean);

  items.forEach((m) => {
    const box = document.createElement("div");
    box.className = "favitem";
    box.innerHTML = `
      <h3 class="favitem__title">${escapeHtml(safeTitle(m))}</h3>
      <p class="favitem__sub">${escapeHtml(safeOriginal(m))} • ${(
      m.original_language || "??"
    ).toUpperCase()} • ${escapeHtml(m.release_date || "Unknown date")}</p>
      <div class="favitem__row">
        <button class="btn btn--ghost" type="button" data-open="1">Details</button>
        <button class="btn btn--ghost" type="button" data-rm="1">Remove</button>
      </div>
    `;
    box
      .querySelector('[data-open="1"]')
      .addEventListener("click", async () => await openDialog(m.id));
    box.querySelector('[data-rm="1"]').addEventListener("click", () => {
      togglePref(m.id);
      updateCounts();
      renderPrefs();
      repaintBoothPickHearts();
    });
    els.prefsList.appendChild(box);
  });
}

/* ---------- Genres ---------- */
function addGenre(g) {
  if (!g) return;
  if (selectedGenres.includes(g)) return;
  selectedGenres.push(g);
  renderTags();
}
function removeGenre(g) {
  selectedGenres = selectedGenres.filter((x) => x !== g);
  renderTags();
}
function renderTags() {
  els.tagList.innerHTML = "";
  selectedGenres.forEach((g) => {
    const t = document.createElement("span");
    t.className = "tag";
    t.innerHTML = `<span>${escapeHtml(g)}</span>`;
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.addEventListener("click", async () => {
      removeGenre(g);
      await updateGenreSuggestions();
    });
    t.appendChild(x);
    els.tagList.appendChild(t);
  });
}

async function updateGenreSuggestions() {
  els.suggestions.innerHTML = "";
  const lang = normalizeLang(els.langSelect.value);

  if (!lang) {
    els.langInfo.textContent =
      "Language is required. Choose one to see available genres.";
    return;
  }

  let data;
  try {
    data = await apiGet(`/api/genres?lang=${encodeURIComponent(lang)}`);
  } catch {
    els.langInfo.textContent = "Could not load genres.";
    return;
  }

  const all = (data.genres || [])
    .slice()
    .sort((a, b) => a.localeCompare(b, "en"));
  els.langInfo.textContent = `Language selected: '${lang}'. Optional filters available. Genres: ${all.length}`;

  all
    .filter((g) => !selectedGenres.includes(g))
    .slice(0, 18)
    .forEach((g) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sugg";
      b.textContent = g;
      b.addEventListener("click", async () => {
        addGenre(g);
        await updateGenreSuggestions();
      });
      els.suggestions.appendChild(b);
    });
}

/* ---------- Hydration ---------- */
async function hydrateLanguages() {
  els.langSelect.innerHTML = `<option value="">— Choose a language —</option>`;
  const data = await apiGet("/api/languages");
  (data.languages || [])
    .slice()
    .sort()
    .forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l;
      opt.textContent = l;
      els.langSelect.appendChild(opt);
    });
  await updateGenreSuggestions();
}

async function hydrateLinguisticLevels() {
  els.linguisticLevel.innerHTML = `<option value="">Any level</option>`;
  let data;
  try {
    data = await apiGet("/api/linguistic_levels");
  } catch {
    return;
  }
  const levels = (data.levels || []).slice().sort();
  levels.forEach((lvl) => {
    const opt = document.createElement("option");
    opt.value = String(lvl).toLowerCase();
    opt.textContent = String(lvl).replace(/\b\w/g, (c) => c.toUpperCase());
    els.linguisticLevel.appendChild(opt);
  });
}

/* ---------- Theme ---------- */
function initTheme() {
  const saved = localStorage.getItem(STORAGE.theme) || "dark";
  setTheme(saved);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  setTheme(cur === "dark" ? "light" : "dark");
}
function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem(STORAGE.theme, t);
  if (els.themeBtn) {
    els.themeBtn.setAttribute("aria-pressed", t === "light" ? "true" : "false");
    els.themeBtn.innerHTML = t === "dark" ? "🌙 Dark Mode" : "☀️ Light Mode";
  }
}

/* ---------- Helpers ---------- */
function normalizeLang(v) {
  return String(v || "")
    .trim()
    .toLowerCase();
}
function normalizeMaybe(v) {
  const s = String(v || "").trim();
  return s ? s.toLowerCase() : null;
}
function normalizeGenre(v) {
  return String(v || "")
    .trim()
    .toLowerCase();
}
function badge(text) {
  const b = document.createElement("span");
  b.className = "badge";
  b.textContent = text;
  return b;
}
function yearFromDate(d) {
  if (!d) return "????";
  const m = String(d).match(/\d{4}/);
  return m ? m[0] : "????";
}
function yearInt(m) {
  const y = parseInt(yearFromDate(m?.release_date), 10);
  return Number.isFinite(y) ? y : 0;
}
function extractGenres(m) {
  const arr =
    m?.genre_list || m?.genres || (Array.isArray(m?.genres) ? m.genres : null);
  if (Array.isArray(arr))
    return arr.map((g) => String(g).toLowerCase().trim()).filter(Boolean);
  return [];
}
function safeTitle(m) {
  return m?.title || "Unknown title";
}
function safeOriginal(m) {
  return m?.original_title || "";
}
function fmt(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return "N/A";
  return x.toFixed(1);
}
function num(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : -1;
}
function clampInt(v, a, b) {
  const n = parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(a, Math.min(b, n));
}
function numOrNull(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}
function intOrNull(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const x = parseInt(s, 10);
  return Number.isFinite(x) ? x : null;
}
function mean(arr) {
  if (!arr || !arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function posterSrc(m) {
  if (m?.poster_url) return m.poster_url;
  if (m?.poster_path) return `https://image.tmdb.org/t/p/w342${m.poster_path}`;
  return "/static/placeholder-poster.png";
}
function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------- Loader ---------- */
function showCinematicLoader() {
  const loader = document.createElement("div");
  loader.className = "cinematic-loader";
  loader.innerHTML = `
    <div class="loader-content">
      <div class="film-strip"></div>
      <div class="loader-text">PRINTING TICKET...</div>
    </div>`;
  document.body.appendChild(loader);

  return {
    remove: () => {
      loader.style.opacity = "0";
      loader.style.transition = "opacity 0.2s ease";
      setTimeout(() => loader.remove(), 220);
    },
  };
}
