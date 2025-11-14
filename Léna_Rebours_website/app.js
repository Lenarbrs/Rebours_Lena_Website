// Smooth scroll on in-page anchor links
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const id = a.getAttribute("href");
    if (id && id.length > 1) {
      const el = document.querySelector(id);
      if (el) {
        e.preventDefault();
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  });
});

// Fade-in when blocks enter the viewport
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add("visible");
    });
  },
  { threshold: 0.14 }
);

document
  .querySelectorAll(
    ".container .grid, .container .form-section, .section-title"
  )
  .forEach((el) => observer.observe(el));

// Mobile nav toggle
const navToggle = document.querySelector(".nav-toggle");
const menu = document.getElementById("menu");

if (navToggle && menu) {
  navToggle.addEventListener("click", () => {
    const isOpen = menu.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });

  // Close menu when clicking a link (on small screens)
  menu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      if (menu.classList.contains("is-open")) {
        menu.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
      }
    });
  });
}

// Recommendation form
const form = document.getElementById("form-filters");
const resultsContainer = document.getElementById("results-filters");
const noteElement = document.getElementById("note-filters");

if (form && resultsContainer && noteElement) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const lang = form.elements.lang.value;
    const type = form.elements.type.value;
    const genres = form.elements.genres.value;

    noteElement.textContent = "Looking up recommendations…";
    noteElement.style.color = "var(--accent)";

    const safeGenres = genres
      ? genres.replace(/</g, "&lt;").replace(/>/g, "&gt;")
      : "";

    resultsContainer.innerHTML = `
      <div class="result">
        <strong>No recommendations yet</strong><br>
        <span class="muted">
          Data source not connected. Selected:
          lang = <code>${lang}</code>,
          type = <code>${type}</code>${
      safeGenres.trim() ? `, genres = <code>${safeGenres}</code>` : ""
    }.
        </span>
        <br>
        <span class="muted">
          Once the backend is ready, results will appear here.
        </span>
      </div>
    `;

    noteElement.textContent =
      "No recommendations available (no data source configured).";
    noteElement.style.color = "var(--highlight)";
  });
}
