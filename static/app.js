// static/app.js
const $ = (s) => document.querySelector(s);

const els = {
  themeBtn: $("#themeBtn"),
  openFavBtn: $("#openFavBtn"),
  closeFavBtn: $("#closeFavBtn"),
  clearFavBtn: $("#clearFavBtn"),
  favDrawer: $("#favDrawer"),
  favList: $("#favList"),
  favCount: $("#favCount"),

  filters: $("#filters"),
  langSelect: $("#langSelect"),
  langInfo: $("#langInfo"),
  genreInput: $("#genreInput"),
  tagList: $("#tagList"),
  suggestions: $("#genreSuggestions"),
  minRating: $("#minRating"),
  maxRuntime: $("#maxRuntime"),
  topN: $("#topN"),
  resetBtn: $("#resetBtn"),
  shuffleBtn: $("#shuffleBtn"),
  linguisticLevel: $("#linguisticLevel"),

  cards: $("#cards"),
  empty: $("#emptyState"),
  resultsMeta: $("#resultsMeta"),
  chips: $("#activeChips"),
  printer: $("#ticketPrinter"),

  dialog: $("#movieDialog"),
  dialogTitle: $("#dialogTitle"),
  dialogSub: $("#dialogSub"),
  dialogOverview: $("#dialogOverview"),
  dialogMeta: $("#dialogMeta"),
  dialogFavBtn: $("#dialogFavBtn"),
};

const STORAGE = {
  theme: "cinelingua.theme",
  fav: "cinelingua.fav",
  fav_cache: "cinelingua.fav_cache",
};

let selectedGenres = [];
let favorites = new Set(JSON.parse(localStorage.getItem(STORAGE.fav) || "[]"));
let favCache = JSON.parse(localStorage.getItem(STORAGE.fav_cache) || "{}");

let currentDialogId = null;
let lastResults = [];
let isPrinting = false;

/* ---------- Initialisation ---------- */
initTheme();
wireUI();
updateFavCount();

(async function boot() {
  await hydrateLanguages();
  await hydrateLinguisticLevels();
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
  els.themeBtn.addEventListener("click", toggleTheme);

  // Favorites drawer
  els.openFavBtn.addEventListener("click", openFavDrawer);
  els.closeFavBtn.addEventListener("click", closeFavDrawer);
  els.clearFavBtn.addEventListener("click", () => {
    if (favorites.size === 0) return;
    if (confirm("Clear all favorites from your collection?")) {
      favorites.clear();
      favCache = {};
      persistFav();
      persistFavCache();
      updateFavCount();
      renderFav();
    }
  });

  // Language change
  els.langSelect.addEventListener("change", async () => {
    selectedGenres = [];
    renderTags();
    await updateGenreSuggestions();
  });

  // Genre tag input
  els.genreInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const raw = els.genreInput.value.trim().toLowerCase();
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

  // Form submit
  els.filters.addEventListener("submit", async (e) => {
    e.preventDefault();
    await recommendAndRender();
  });

  // Reset
  els.resetBtn.addEventListener("click", async () => {
    if (confirm("Reset all filters to default values?")) {
      els.langSelect.value = "";
      selectedGenres = [];
      renderTags();
      els.genreInput.value = "";
      els.minRating.value = "";
      els.maxRuntime.value = "";
      els.linguisticLevel.value = "";
      els.topN.value = 20;

      els.cards.innerHTML = "";
      els.chips.innerHTML = "";
      els.resultsMeta.textContent =
        "Your personalized film recommendations will appear here";
      els.empty.hidden = true;
      lastResults = [];
      await updateGenreSuggestions();
    }
  });

  // Surprise button
  els.shuffleBtn.addEventListener("click", async () => {
    const list = lastResults || [];
    if (!list.length) return;
    const pick = list[Math.floor(Math.random() * list.length)];
    await openDialog(pick.id);
  });

  // Dialog favorite button
  els.dialogFavBtn.addEventListener("click", () => {
    if (!currentDialogId) return;
    toggleFav(currentDialogId);
    renderDialogFromCacheOrState(currentDialogId);
    updateFavCount();
  });

  // Close drawer when clicking outside
  document.addEventListener("click", (e) => {
    if (!els.favDrawer.classList.contains("open")) return;
    if (els.favDrawer.contains(e.target) || els.openFavBtn.contains(e.target))
      return;
    closeFavDrawer();
  });

  // Close dialog on ESC
  els.dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") els.dialog.close();
  });
}

/* ---------- Recommendations via API ---------- */
async function recommendAndRender() {
  if (isPrinting) return;
  isPrinting = true;

  const submitBtn = els.filters?.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  const lang = (els.langSelect.value || "").trim().toLowerCase();
  if (!lang) {
    if (submitBtn) submitBtn.disabled = false;
    isPrinting = false;
    return;
  }

  const loader = showCinematicLoader();

  try {
    const topN = clampInt(els.topN.value, 1, 100) ?? 20;
    const mr = (els.minRating.value || "").trim();
    const rt = (els.maxRuntime.value || "").trim();
    const linguisticLevel = (els.linguisticLevel.value || "").trim();

    const payload = {
      lang,
      genres: selectedGenres,
      top_n: topN,
      min_rating: mr ? Number(mr) : null,
      max_runtime: rt ? Number(rt) : null,
      linguistic_level: linguisticLevel || null,
    };

    const data = await apiPost("/api/recommendations", payload);

    const result = data.results || [];
    lastResults = result;

    renderChips();
    animatePrinter();

    renderCards(result);
    els.empty.hidden = result.length !== 0;

    els.resultsMeta.textContent = result.length
      ? `🎟️ Ticket printed: ${result.length} film(s) • Language: ${lang} • Sorted by popularity ↓`
      : `🎬 No matching films found. Try adjusting your criteria.`;
  } catch (error) {
    console.error("Error in recommendAndRender:", error);
  } finally {
    loader.remove();
    if (submitBtn) submitBtn.disabled = false;
    isPrinting = false;
  }
}

/* ---------- Render Cards ---------- */
function renderCards(list) {
  els.cards.innerHTML = "";

  list.forEach((m, index) => {
    const card = document.createElement("article");
    card.className = "card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `View details for ${safeTitle(m)}`);
    card.style.animationDelay = `${(index + 1) * 0.06}s`;

    const content = document.createElement("div");
    content.className = "card__content";

    const poster = document.createElement("img");
    poster.className = "card__poster";
    poster.src = posterSrc(m);
    poster.alt = `Poster: ${safeTitle(m)}`;
    poster.loading = "lazy";
    poster.decoding = "async";
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
    fav.className = "iconbtn";
    fav.type = "button";
    fav.textContent = favorites.has(m.id) ? "♥" : "♡";
    fav.title = favorites.has(m.id)
      ? "Remove from favorites"
      : "Add to favorites";
    fav.addEventListener("click", (e) => {
      e.stopPropagation();
      cacheMovie(m);
      toggleFav(m.id);
      fav.textContent = favorites.has(m.id) ? "♥" : "♡";
      fav.title = favorites.has(m.id)
        ? "Remove from favorites"
        : "Add to favorites";
      updateFavCount();
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
    if (Array.isArray(m.genre_list) && m.genre_list.length)
      badges.appendChild(badge(m.genre_list[0]));
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
  currentDialogId = id;

  const local = (lastResults || []).find((x) => x.id === id) || favCache[id];
  if (local) {
    renderDialog(local);
    els.dialog.showModal();
    return;
  }

  try {
    const m = await apiMovie(id);
    cacheMovie(m);
    renderDialog(m);
    els.dialog.showModal();
  } catch (err) {
    console.error(err);
  }
}

function renderDialogFromCacheOrState(id) {
  const m = (lastResults || []).find((x) => x.id === id) || favCache[id];
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
  if (Array.isArray(m.genre_list) && m.genre_list.length) {
    els.dialogMeta.appendChild(badge(`Genres: ${m.genre_list.join(", ")}`));
  }
  if (m.linguistic_level)
    els.dialogMeta.appendChild(badge(`Level: ${m.linguistic_level}`));
  if (m.linguistic_register)
    els.dialogMeta.appendChild(badge(`Register: ${m.linguistic_register}`));

  const isFav = favorites.has(m.id);
  els.dialogFavBtn.textContent = isFav ? "♥ Remove Favorite" : "♡ Add Favorite";
  els.dialogFavBtn.title = isFav ? "Remove from favorites" : "Add to favorites";
}

/* ---------- Favorites ---------- */
function toggleFav(id) {
  id = String(id);
  if (favorites.has(id)) {
    favorites.delete(id);
  } else {
    favorites.add(id);
  }
  persistFav();
}

function persistFav() {
  localStorage.setItem(STORAGE.fav, JSON.stringify([...favorites]));
}

function cacheMovie(m) {
  if (!m || !m.id) return;
  favCache[String(m.id)] = m;
  persistFavCache();
}

function persistFavCache() {
  localStorage.setItem(STORAGE.fav_cache, JSON.stringify(favCache));
}

function updateFavCount() {
  els.favCount.textContent = String(favorites.size);
}

function openFavDrawer() {
  els.favDrawer.classList.add("open");
  els.favDrawer.setAttribute("aria-hidden", "false");
  renderFav();
}

function closeFavDrawer() {
  els.favDrawer.classList.remove("open");
  els.favDrawer.setAttribute("aria-hidden", "true");
}

function renderFav() {
  els.favList.innerHTML = "";

  const favIds = [...favorites];
  if (!favIds.length) {
    const empty = document.createElement("div");
    empty.className = "favitem";
    empty.innerHTML = `
      <h3 class="favitem__title">Your favorites collection is empty</h3>
      <p class="favitem__sub">Click ♥ on any movie to add it here.</p>
    `;
    els.favList.appendChild(empty);
    return;
  }

  const favs = favIds
    .map((id) => favCache[id])
    .filter(Boolean)
    .sort((a, b) => Number(b.popularity ?? -1) - Number(a.popularity ?? -1));

  favs.forEach((m) => {
    const box = document.createElement("div");
    box.className = "favitem";

    const t = document.createElement("h3");
    t.className = "favitem__title";
    t.textContent = safeTitle(m);

    const s = document.createElement("p");
    s.className = "favitem__sub";
    s.textContent = `${safeOriginal(m)} • ${(
      m.original_language || "??"
    ).toUpperCase()} • ${m.release_date || "Unknown date"}`;

    const row = document.createElement("div");
    row.className = "favitem__row";

    const open = document.createElement("button");
    open.className = "btn btn--ghost";
    open.type = "button";
    open.textContent = "Details";
    open.addEventListener("click", async () => await openDialog(m.id));

    const rm = document.createElement("button");
    rm.className = "btn btn--ghost";
    rm.type = "button";
    rm.textContent = "Remove";
    rm.addEventListener("click", () => {
      toggleFav(m.id);
      updateFavCount();
      renderFav();
    });

    row.appendChild(open);
    row.appendChild(rm);

    box.appendChild(t);
    box.appendChild(s);
    box.appendChild(row);

    els.favList.appendChild(box);
  });
}

/* ---------- Genres ---------- */
function addGenre(g) {
  g = g.trim().toLowerCase();
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
    t.innerHTML = `<span>${g}</span>`;

    const x = document.createElement("button");
    x.type = "button";
    x.setAttribute("aria-label", `Remove ${g}`);
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

  const lang = (els.langSelect.value || "").trim().toLowerCase();
  if (!lang) {
    els.langInfo.textContent = "Choose a language to see available genres.";
    return;
  }

  let data;
  try {
    data = await apiGet(`/api/genres?lang=${encodeURIComponent(lang)}`);
  } catch (err) {
    els.langInfo.textContent = "Could not load genres.";
    return;
  }

  const all = (data.genres || [])
    .slice()
    .sort((a, b) => a.localeCompare(b, "en"));
  els.langInfo.textContent = `Available genres for '${lang}': ${all.length}`;

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

async function hydrateLanguages() {
  els.langSelect.innerHTML = `<option value="">— Choose a language —</option>`;
  const data = await apiGet("/api/languages");
  const langs = (data.languages || []).slice().sort();

  langs.forEach((l) => {
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

  const levels = (data.levels || []).slice();

  const order = [
    "beginner",
    "elementary",
    "intermediate",
    "upper intermediate",
    "advanced",
    "proficient",
  ];
  levels.sort((a, b) => {
    const ia = order.indexOf(String(a).toLowerCase());
    const ib = order.indexOf(String(b).toLowerCase());
    if (ia === -1 && ib === -1) return String(a).localeCompare(String(b));
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  levels.forEach((lvl) => {
    const v = String(lvl).trim().toLowerCase();
    if (!v) return;
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v.replace(/\b\w/g, (c) => c.toUpperCase());
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
  els.themeBtn.setAttribute("aria-pressed", t === "light" ? "true" : "false");
  els.themeBtn.innerHTML = t === "dark" ? "🌙 Dark Mode" : "☀️ Light Mode";
  els.themeBtn.title =
    t === "dark" ? "Switch to light mode" : "Switch to dark mode";
}

/* ---------- Helpers ---------- */
function badge(text) {
  const b = document.createElement("span");
  b.className = "badge";
  b.textContent = text;
  return b;
}

function yearFromDate(d) {
  if (!d) return "????";
  const s = String(d);
  const m = s.match(/\d{4}/);
  return m ? m[0] : "????";
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

function clampInt(v, a, b) {
  const n = parseInt(String(v), 10);
  if (Number.isNaN(n)) return null;
  return Math.max(a, Math.min(b, n));
}

function posterSrc(m) {
  if (m?.poster_url) return m.poster_url;
  if (m?.poster_path) return `https://image.tmdb.org/t/p/w342${m.poster_path}`;
  return "/static/placeholder-poster.png";
}

/* ---------- Loader ---------- */
function showCinematicLoader() {
  const loader = document.createElement("div");
  loader.className = "cinematic-loader";
  loader.innerHTML = `
    <div class="loader-content">
      <div class="film-strip"></div>
      <div class="loader-text">PRINTING TICKET...</div>
    </div>
  `;
  document.body.appendChild(loader);

  return {
    remove: () => {
      if (!loader.parentNode) return;
      loader.style.opacity = "0";
      loader.style.transition = "opacity 0.2s ease";
      setTimeout(() => {
        if (loader.parentNode) loader.parentNode.removeChild(loader);
      }, 220);
    },
  };
}
