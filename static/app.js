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
  minYear: $("#minYear"),
  maxYear: $("#maxYear"),
  topN: $("#topN"),
  resetBtn: $("#resetBtn"),
  shuffleBtn: $("#shuffleBtn"),
  sortSelect: $("#sortSelect"),
  linguisticLevel: $("#linguisticLevel"),

  tasteBlock: $("#tasteBlock"),
  boothPicks: $("#boothPicks"),

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

  // “Favorites drawer” (collection)
  fav: "cinelingua.fav",
  fav_cache: "cinelingua.fav_cache",

  // “Taste profile” used for personalized sorting
  taste: "cinelingua.taste",
  taste_cache: "cinelingua.taste_cache",
};

let selectedGenres = [];
let favorites = new Set(JSON.parse(localStorage.getItem(STORAGE.fav) || "[]"));
let favCache = JSON.parse(localStorage.getItem(STORAGE.fav_cache) || "{}");

let tasteLikes = new Set(
  JSON.parse(localStorage.getItem(STORAGE.taste) || "[]")
);
let tasteCache = JSON.parse(localStorage.getItem(STORAGE.taste_cache) || "{}");

let boothPickList = []; // famous list
let currentDialogId = null;
let lastResults = [];
let isPrinting = false;

/* ---------- Initialisation ---------- */
initTheme();
wireUI();
updateFavCount();

(async function boot() {
  await Promise.all([hydrateLanguages(), hydrateLinguisticLevels()]);
  // Booth picks loaded once (not language specific)
  await hydrateBoothPicks();
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

  // Sorting
  els.sortSelect?.addEventListener("change", () => {
    if (!lastResults.length) return;
    const sorted = applySorting([...lastResults], getCurrentSortKey());
    renderCards(sorted);
    updateMetaText(sorted.length, getCurrentSortKey());
  });

  // Language change (language mandatory -> show taste block after chosen)
  els.langSelect.addEventListener("change", async () => {
    selectedGenres = [];
    renderTags();
    await updateGenreSuggestions();

    const lang = (els.langSelect.value || "").trim();
    els.tasteBlock.hidden = !lang; // only show when language chosen
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
    if (confirm("Reset all optional filters? (Language stays required)")) {
      // keep language? You can choose; here we reset everything except language selection
      selectedGenres = [];
      renderTags();
      els.genreInput.value = "";
      els.minRating.value = "";
      els.maxRuntime.value = "";
      els.minYear.value = "";
      els.maxYear.value = "";
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

  // Dialog favorite button (collection favorites)
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

/* ======================================================
   Booth Picks (Famous list) — taste profile
   ====================================================== */
async function hydrateBoothPicks() {
  try {
    const data = await apiGet("/api/booth_picks");
    boothPickList = data.results || [];
    // cache movies for taste model
    boothPickList.forEach((m) => cacheTasteMovie(m));
    renderBoothPicks();
  } catch (e) {
    console.error("booth_picks failed", e);
  }
}

function renderBoothPicks() {
  if (!els.boothPicks) return;
  els.boothPicks.innerHTML = "";

  boothPickList.slice(0, 90).forEach((m) => {
    const id = String(m.id);

    const box = document.createElement("article");
    box.className = "pick" + (tasteLikes.has(id) ? " is-liked" : "");
    box.tabIndex = 0;
    box.setAttribute("role", "button");
    box.setAttribute("aria-label", `Mark taste for ${safeTitle(m)}`);

    const img = document.createElement("img");
    img.className = "pick__img";
    img.src = posterSrc(m);
    img.alt = `Poster: ${safeTitle(m)}`;
    img.loading = "lazy";
    img.decoding = "async";

    const body = document.createElement("div");
    body.className = "pick__body";

    const left = document.createElement("div");
    const title = document.createElement("h4");
    title.className = "pick__title";
    title.textContent = safeTitle(m);
    const sub = document.createElement("p");
    sub.className = "pick__sub";
    sub.textContent = `${yearFromAny(m)} • ${(
      m.original_language || "??"
    ).toUpperCase()}`;
    left.appendChild(title);
    left.appendChild(sub);

    const btn = document.createElement("button");
    btn.className = "pick__btn";
    btn.type = "button";
    btn.textContent = tasteLikes.has(id) ? "♥" : "♡";
    btn.title = tasteLikes.has(id)
      ? "Remove from taste profile"
      : "Add to taste profile";

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTaste(id);
      box.classList.toggle("is-liked", tasteLikes.has(id));
      btn.textContent = tasteLikes.has(id) ? "♥" : "♡";
      btn.title = tasteLikes.has(id)
        ? "Remove from taste profile"
        : "Add to taste profile";

      // If user is already seeing results and sort is personal, re-sort live
      if (lastResults.length && getCurrentSortKey() === "personal") {
        const sorted = applySorting([...lastResults], "personal");
        renderCards(sorted);
        updateMetaText(sorted.length, "personal");
      }
    });

    body.appendChild(left);
    body.appendChild(btn);

    box.appendChild(img);
    box.appendChild(body);

    box.addEventListener("click", () => {
      toggleTaste(id);
      box.classList.toggle("is-liked", tasteLikes.has(id));
      btn.textContent = tasteLikes.has(id) ? "♥" : "♡";
      btn.title = tasteLikes.has(id)
        ? "Remove from taste profile"
        : "Add to taste profile";
      if (lastResults.length && getCurrentSortKey() === "personal") {
        const sorted = applySorting([...lastResults], "personal");
        renderCards(sorted);
        updateMetaText(sorted.length, "personal");
      }
    });

    els.boothPicks.appendChild(box);
  });
}

function toggleTaste(id) {
  id = String(id);
  if (tasteLikes.has(id)) tasteLikes.delete(id);
  else tasteLikes.add(id);
  persistTaste();
}

function persistTaste() {
  localStorage.setItem(STORAGE.taste, JSON.stringify([...tasteLikes]));
}

function cacheTasteMovie(m) {
  if (!m || !m.id) return;
  tasteCache[String(m.id)] = normalizeMovieForModel(m);
  localStorage.setItem(STORAGE.taste_cache, JSON.stringify(tasteCache));
}

/* ======================================================
   Recommendations + Sorting
   ====================================================== */
async function recommendAndRender() {
  if (isPrinting) return;
  isPrinting = true;

  const submitBtn = els.filters?.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  const lang = (els.langSelect.value || "").trim().toLowerCase();
  if (!lang) {
    alert("Please choose a language first (required).");
    if (submitBtn) submitBtn.disabled = false;
    isPrinting = false;
    return;
  }

  const loader = showCinematicLoader();

  try {
    const topN = clampInt(els.topN.value, 1, 100) ?? 20;
    const mr = (els.minRating.value || "").trim();
    const rt = (els.maxRuntime.value || "").trim();
    const minY = (els.minYear.value || "").trim();
    const maxY = (els.maxYear.value || "").trim();
    const linguisticLevel = (els.linguisticLevel.value || "").trim();

    const payload = {
      lang,
      genres: selectedGenres,
      top_n: topN,
      min_rating: mr ? Number(mr) : null,
      max_runtime: rt ? Number(rt) : null,
      min_year: minY ? Number(minY) : null,
      max_year: maxY ? Number(maxY) : null,
      linguistic_level: linguisticLevel || null,
    };

    const data = await apiPost("/api/recommendations", payload);
    const result = (data.results || []).map(normalizeMovieForModel);

    lastResults = result;

    renderChips();
    animatePrinter();

    const sortKey = getCurrentSortKey();
    const sorted = applySorting([...result], sortKey);
    renderCards(sorted);

    els.empty.hidden = sorted.length !== 0;
    updateMetaText(sorted.length, sortKey);
  } catch (error) {
    console.error("Error in recommendAndRender:", error);
  } finally {
    loader.remove();
    if (submitBtn) submitBtn.disabled = false;
    isPrinting = false;
  }
}

function getCurrentSortKey() {
  return els.sortSelect?.value || "personal";
}

function updateMetaText(count, sortKey) {
  const lang = (els.langSelect.value || "").trim().toLowerCase();
  const label =
    {
      personal: "Best for you",
      rating: "Best rated",
      popular: "Most popular",
      recent: "Most recent",
      oldest: "Oldest",
    }[sortKey] || "Most popular";

  const tasteN = tasteLikes.size;

  const tasteLine =
    sortKey === "personal"
      ? tasteN >= 3
        ? `• Personalized using your taste picks (${tasteN} like(s))`
        : `• Tip: pick at least 3 famous films above to improve “Best for you”`
      : "";

  els.resultsMeta.textContent = count
    ? `🎟️ Ticket printed: ${count} film(s) • Language: ${lang} • Sort: ${label} ${tasteLine}`
    : `🎬 No matching films found. Try adjusting your criteria.`;
}

/* ---------- Personalized “mini-model” (profile) ---------- */
/**
 * We train a simple profile from tasteLikes:
 * - genre weights (what user likes more)
 * - preferred year (mean) + spread
 * - preferred rating (mean)
 * Then we score every candidate film and sort by score.
 *
 * This is not heavy ML: it’s a lightweight recommender / re-ranker.
 */
function buildTasteProfile() {
  const liked = [...tasteLikes].map((id) => tasteCache[id]).filter(Boolean);

  if (liked.length < 3) return null; // not enough signal

  const genreW = {}; // counts
  const years = [];
  const ratings = [];

  liked.forEach((m) => {
    (m.genre_list || []).forEach((g) => {
      const k = String(g).toLowerCase();
      genreW[k] = (genreW[k] || 0) + 1;
    });
    if (Number.isFinite(m.release_year)) years.push(m.release_year);
    if (Number.isFinite(m.vote_average)) ratings.push(m.vote_average);
  });

  // normalize genre weights to [0..1]
  const maxG = Math.max(1, ...Object.values(genreW));
  const genreWeights = {};
  Object.entries(genreW).forEach(([g, c]) => {
    genreWeights[g] = c / maxG;
  });

  const yearMean = mean(years);
  const yearStd = std(years) || 15; // default spread
  const ratingMean = mean(ratings);

  return {
    n: liked.length,
    genreWeights,
    yearMean: Number.isFinite(yearMean) ? yearMean : null,
    yearStd,
    ratingMean: Number.isFinite(ratingMean) ? ratingMean : 7.0,
  };
}

function personalizedScore(movie, profile) {
  // Fallback if missing
  const gs = (movie.genre_list || []).map((x) => String(x).toLowerCase());
  const y = Number.isFinite(movie.release_year) ? movie.release_year : null;
  const r = Number.isFinite(movie.vote_average) ? movie.vote_average : 0;
  const p = Number.isFinite(movie.popularity) ? movie.popularity : 0;

  // 1) Genre similarity (sum weights of genres in movie)
  let gScore = 0;
  gs.forEach((g) => {
    gScore += profile.genreWeights[g] || 0;
  });
  // normalize a bit by number of genres
  if (gs.length) gScore = gScore / gs.length;

  // 2) Year affinity (closer to preferred period is better)
  let yScore = 0.5;
  if (profile.yearMean != null && y != null) {
    const d = Math.abs(y - profile.yearMean);
    const sigma = Math.max(8, profile.yearStd); // keep stable
    yScore = Math.exp(-(d * d) / (2 * sigma * sigma)); // gaussian in (0..1]
  }

  // 3) Rating affinity (if user likes highly rated films, weight it)
  // normalize rating to 0..1
  const rNorm = clamp01(r / 10);
  const pref = clamp01((profile.ratingMean || 7) / 10);
  const rScore = 1 - Math.abs(rNorm - pref); // closer to preference is better

  // 4) Popularity (small weight, keeps mainstream-ish)
  const pScore = clamp01(Math.log10(p + 1) / 3); // ~0..1

  // Final weighted score
  return 0.55 * gScore + 0.2 * yScore + 0.15 * rScore + 0.1 * pScore;
}

function applySorting(list, sortKey) {
  if (!Array.isArray(list)) return [];

  if (sortKey === "rating") {
    return list.sort(
      (a, b) => (Number(b.vote_average) || -1) - (Number(a.vote_average) || -1)
    );
  }

  if (sortKey === "popular") {
    return list.sort(
      (a, b) => (Number(b.popularity) || -1) - (Number(a.popularity) || -1)
    );
  }

  if (sortKey === "recent") {
    return list.sort(
      (a, b) => (Number(b.release_year) || -1) - (Number(a.release_year) || -1)
    );
  }

  if (sortKey === "oldest") {
    return list.sort(
      (a, b) =>
        (Number(a.release_year) || 999999) - (Number(b.release_year) || 999999)
    );
  }

  // personal
  const profile = buildTasteProfile();
  if (!profile) {
    // no taste -> default popularity
    return list.sort(
      (a, b) => (Number(b.popularity) || -1) - (Number(a.popularity) || -1)
    );
  }

  return list
    .map((m) => ({ m, s: personalizedScore(m, profile) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
}

/* ======================================================
   Render Cards (unchanged except normalization)
   ====================================================== */
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
    sub.textContent = `${safeOriginal(m)} • ${yearFromAny(m)} • ${(
      m.original_language || "??"
    ).toUpperCase()}`;

    left.appendChild(title);
    left.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "card__actions";

    const fav = document.createElement("button");
    fav.className = "iconbtn";
    fav.type = "button";
    fav.textContent = favorites.has(String(m.id)) ? "♥" : "♡";
    fav.title = favorites.has(String(m.id))
      ? "Remove from favorites"
      : "Add to favorites";
    fav.addEventListener("click", (e) => {
      e.stopPropagation();
      cacheMovie(m);
      toggleFav(m.id);
      fav.textContent = favorites.has(String(m.id)) ? "♥" : "♡";
      fav.title = favorites.has(String(m.id))
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

  const minY = (els.minYear.value || "").trim();
  const maxY = (els.maxYear.value || "").trim();
  if (minY || maxY) chips.push(`Year: ${minY || "…"}–${maxY || "…"}`);

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
    tasteCache[String(id)];
  if (local) {
    renderDialog(local);
    els.dialog.showModal();
    return;
  }

  try {
    const m = normalizeMovieForModel(await apiMovie(id));
    cacheMovie(m);
    cacheTasteMovie(m);
    renderDialog(m);
    els.dialog.showModal();
  } catch (err) {
    console.error(err);
  }
}

function renderDialogFromCacheOrState(id) {
  const sid = String(id);
  const m =
    (lastResults || []).find((x) => String(x.id) === sid) ||
    favCache[sid] ||
    tasteCache[sid];
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
  if (Array.isArray(m.genre_list) && m.genre_list.length)
    els.dialogMeta.appendChild(badge(`Genres: ${m.genre_list.join(", ")}`));

  const isFav = favorites.has(String(m.id));
  els.dialogFavBtn.textContent = isFav ? "♥ Remove Favorite" : "♡ Add Favorite";
  els.dialogFavBtn.title = isFav ? "Remove from favorites" : "Add to favorites";
}

/* ---------- Favorites (collection) ---------- */
function toggleFav(id) {
  id = String(id);
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
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
    els.langInfo.textContent =
      "Choose a language to see available genres. (Language is required)";
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
  els.langInfo.textContent = `Language is required. Everything else is optional • Genres available for '${lang}': ${all.length}`;

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

  // show/hide taste block
  const lang = (els.langSelect.value || "").trim();
  els.tasteBlock.hidden = !lang;
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
function normalizeMovieForModel(m) {
  const id = String(m?.id ?? "");
  const genre_list = Array.isArray(m?.genre_list)
    ? m.genre_list
    : Array.isArray(m?.genres)
    ? m.genres
    : [];

  const ry = Number.isFinite(m?.release_year)
    ? m.release_year
    : (() => {
        const s = String(m?.release_date || "");
        const mm = s.match(/\d{4}/);
        return mm ? Number(mm[0]) : null;
      })();

  return {
    ...m,
    id,
    genre_list,
    release_year: Number.isFinite(ry) ? ry : null,
    vote_average: m?.vote_average != null ? Number(m.vote_average) : null,
    popularity: m?.popularity != null ? Number(m.popularity) : null,
    runtime: m?.runtime != null ? Number(m.runtime) : null,
  };
}

function badge(text) {
  const b = document.createElement("span");
  b.className = "badge";
  b.textContent = text;
  return b;
}

function yearFromAny(m) {
  if (Number.isFinite(m?.release_year)) return String(m.release_year);
  if (!m?.release_date) return "????";
  const s = String(m.release_date);
  const mm = s.match(/\d{4}/);
  return mm ? mm[0] : "????";
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

function clamp01(x) {
  x = Number(x);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function mean(arr) {
  if (!arr || !arr.length) return NaN;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function std(arr) {
  if (!arr || arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length - 1);
  return Math.sqrt(v);
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
