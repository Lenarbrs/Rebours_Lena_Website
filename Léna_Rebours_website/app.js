// ===== Smooth scroll on in-page anchor links =====
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const id = a.getAttribute("href");
    if (id && id.length > 1) {
      const el = document.querySelector(id);
      if (el) {
        e.preventDefault();
        // Smoothly scroll to the target section
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  });
});

// ===== Fade-in when blocks enter the viewport =====
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) e.target.classList.add("visible");
    });
  },
  { threshold: 0.14 }
);
// I observe a few common groups of elements
(
  document.querySelectorAll(
    ".container .grid, .container .form-section, .section-title, .timeline"
  ) || []
).forEach((el) => observer.observe(el));

// ===== Hover lift effect on cards =====
document.querySelectorAll(".cards .card").forEach((card) => {
  card.addEventListener("mouseenter", () => {
    card.style.transform = "translateY(-5px)";
  });

  card.addEventListener("mouseleave", () => {
    card.style.transform = "";
  });
});

// ===== Recommendation form =====
const form = document.getElementById("form-filters");
const resultsContainer = document.getElementById("results-filters");
const noteElement = document.getElementById("note-filters");

if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Read form values
    const lang = form.elements.lang.value;
    const type = form.elements.type.value;
    const genres = form.elements.genres.value;

    // Status message
    noteElement.textContent = "Looking up recommendations…";
    noteElement.style.color = "var(--accent)";

    // For now, I just show a message with what the user selected.
    resultsContainer.innerHTML = `
      <div class="result">
        <strong>No recommendations yet</strong><br>
        <span class="muted">
          Data source not connected. Selected:
          lang = <code>${lang}</code>,
          type = <code>${type}</code>${
      genres?.trim()
        ? `, genres = <code>${genres.replace(/</g, "&lt;")}</code>`
        : ""
    }.
        </span>
        <br>
        <span class="muted">
          Once the backend is ready, results will appear here.
        </span>
      </div>
    `;

    noteElement.textContent =
      "No recommendations available (no data source configured)";
    noteElement.style.color = "var(--highlight)";
  });
}

// ===== Tiny emoji confetti on primary button clicks =====
document.querySelectorAll(".button:not(.ghost)").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const n = 6;
    const symbols = ["🌍", "🗣️", "🎭", "🎵", "📚", "🎨"];

    for (let i = 0; i < n; i++) {
      const s = document.createElement("span");
      s.textContent = symbols[Math.floor(Math.random() * symbols.length)];
      s.style.position = "fixed";
      s.style.fontSize = 18 + Math.random() * 12 + "px";
      s.style.zIndex = 1000;
      s.style.pointerEvents = "none";
      s.style.userSelect = "none";
      s.style.filter = "drop-shadow(0 0 3px rgba(58, 134, 255, 0.5))";

      const x = e.clientX,
        y = e.clientY;
      s.style.left = x + "px";
      s.style.top = y + "px";

      document.body.appendChild(s);

      const dx = (Math.random() - 0.5) * 180,
        dy = (Math.random() - 0.8) * 220;

      // Particle animation
      s.animate(
        [
          { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
          {
            transform: `translate(${dx}px, ${dy}px) rotate(${
              360 * (Math.random() > 0.5 ? 1 : -1)
            }deg)`,
            opacity: 0,
          },
        ],
        {
          duration: 1000 + Math.random() * 500,
          easing: "cubic-bezier(.2,.8,.2,1)",
        }
      ).onfinish = () => s.remove();
    }
  });
});
