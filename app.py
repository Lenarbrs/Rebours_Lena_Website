import os
import time
import math
import atexit

from flask import Flask, jsonify, request, render_template
from psycopg2.extras import RealDictCursor
from psycopg2.pool import SimpleConnectionPool

# ======================================================
# App
# ======================================================
app = Flask(__name__)

TMDB_IMG_BASE = "https://image.tmdb.org/t/p/w342"
TABLE_NAME = os.environ.get("MOVIES_TABLE", "movies")

# ======================================================
# Database pool
# ======================================================
DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set")

POOL = SimpleConnectionPool(
    minconn=1,
    maxconn=10,
    dsn=DATABASE_URL,
    sslmode="require",
    connect_timeout=10,
    keepalives=1,
    keepalives_idle=30,
    keepalives_interval=10,
    keepalives_count=5,
)

@atexit.register
def close_pool():
    try:
        POOL.closeall()
    except Exception:
        pass

def get_db():
    return POOL.getconn()

def release_db(conn):
    if conn:
        POOL.putconn(conn)

# ======================================================
# Cache
# ======================================================
CACHE_TTL = 24 * 3600

_CACHE = {
    "languages": {"ts": 0, "data": None},
    "levels": {"ts": 0, "data": None},
    "stats": {"ts": 0, "data": None},
    "booth_picks": {"ts": 0, "data": None},
}

# ======================================================
# Helpers
# ======================================================
def normalize_lang(v):
    return (v or "").strip().lower()

def normalize_genres(arr):
    return [str(g).strip().lower() for g in (arr or []) if str(g).strip()]

def clamp_int(v, a, b, d):
    try:
        return max(a, min(b, int(v)))
    except Exception:
        return d

def safe_float(v):
    try:
        return float(v)
    except Exception:
        return None

def poster_url(path):
    if path and str(path).startswith("/"):
        return f"{TMDB_IMG_BASE}{path}"
    return None

def year_from_release_date(val):
    """
    Robust extraction:
    - if release_date is date or text starting with YYYY -> take first 4 digits
    - else -> None
    """
    if val is None:
        return None
    s = str(val)
    if len(s) >= 4 and s[0:4].isdigit():
        try:
            y = int(s[0:4])
            return y if 1800 <= y <= 2100 else None
        except Exception:
            return None
    return None

# ======================================================
# Pages
# ======================================================
@app.get("/")
def home():
    return render_template("index.html")

@app.get("/about")
def about():
    return render_template("about.html")

@app.get("/stats")
def stats_page():
    return render_template("stats.html")

# ======================================================
# API — cached
# ======================================================
@app.get("/api/languages")
def api_languages():
    c = _CACHE["languages"]
    if c["data"] and time.time() - c["ts"] < CACHE_TTL:
        return jsonify({"languages": c["data"]})

    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT DISTINCT LOWER(original_language)
                FROM {TABLE_NAME}
                WHERE original_language IS NOT NULL AND TRIM(original_language) <> ''
                ORDER BY 1;
            """)
            langs = [r[0] for r in cur.fetchall() if r[0]]

        c["data"] = langs
        c["ts"] = time.time()
        return jsonify({"languages": langs})
    finally:
        release_db(conn)

@app.get("/api/linguistic_levels")
def api_levels():
    c = _CACHE["levels"]
    if c["data"] and time.time() - c["ts"] < CACHE_TTL:
        return jsonify({"levels": c["data"]})

    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT DISTINCT LOWER(linguistic_level)
                FROM {TABLE_NAME}
                WHERE linguistic_level IS NOT NULL AND TRIM(linguistic_level) <> ''
                ORDER BY 1;
            """)
            levels = [r[0] for r in cur.fetchall() if r[0]]

        c["data"] = levels
        c["ts"] = time.time()
        return jsonify({"levels": levels})
    finally:
        release_db(conn)

# ======================================================
# API — genres (par langue)
# ======================================================
@app.get("/api/genres")
def api_genres():
    lang = normalize_lang(request.args.get("lang"))
    if not lang:
        return jsonify({"genres": []})

    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT DISTINCT LOWER(g)
                FROM {TABLE_NAME}
                CROSS JOIN LATERAL unnest(genres) g
                WHERE LOWER(original_language) = %s
                ORDER BY 1;
            """, (lang,))
            genres = [r[0] for r in cur.fetchall() if r[0]]
        return jsonify({"genres": genres})
    finally:
        release_db(conn)

# ======================================================
# API — single movie (for dialog)
# ======================================================
@app.get("/api/movie/<movie_id>")
def api_movie(movie_id):
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"SELECT * FROM {TABLE_NAME} WHERE id = %s LIMIT 1;", (movie_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Movie not found"}), 404

        row["poster_url"] = poster_url(row.get("poster_path"))
        # normalize front-end expectations
        row["genre_list"] = row.get("genre_list") or row.get("genres") or []
        row["release_year"] = row.get("release_year") or year_from_release_date(row.get("release_date"))
        row["id"] = str(row.get("id"))
        return jsonify(row)
    finally:
        release_db(conn)

# ======================================================
# API — Booth Picks (global list, famous + representative)
# ======================================================
def build_booth_picks():
    """
    Strategy:
    - Pull a big pool of popular movies (not language-specific)
    - Keep only movies with poster + decent rating
    - Select a representative subset by genre quotas (simple + robust)
    """
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                SELECT id, title, original_title, original_language, release_date,
                       poster_path, popularity, vote_average, runtime, genres, linguistic_level, linguistic_register
                FROM {TABLE_NAME}
                WHERE poster_path IS NOT NULL
                ORDER BY popularity DESC
                LIMIT 1200;
            """)
            pool = cur.fetchall() or []
    finally:
        release_db(conn)

    # Normalize items
    items = []
    for r in pool:
        g = r.get("genres") or []
        if isinstance(g, str):
            g = [g]
        yr = year_from_release_date(r.get("release_date"))
        r["poster_url"] = poster_url(r.get("poster_path"))
        r["genre_list"] = g
        r["release_year"] = yr
        r["id"] = str(r.get("id"))
        # Filter a bit to avoid obscure low-rated stuff
        try:
            va = float(r.get("vote_average") or 0)
        except Exception:
            va = 0.0
        if va < 6.2:
            continue
        items.append(r)

    # Genre buckets (lowercase)
    buckets = {
        "action": ["action"],
        "comedy": ["comedy"],
        "drama": ["drama"],
        "thriller": ["thriller"],
        "sci-fi": ["science fiction", "sci-fi", "scifi"],
        "romance": ["romance"],
        "horror": ["horror"],
        "animation": ["animation"],
        "crime": ["crime"],
        "family": ["family"],
        "adventure": ["adventure"],
        "fantasy": ["fantasy"],
    }

    def bucket_of(movie):
        gs = [str(x).strip().lower() for x in (movie.get("genre_list") or [])]
        for b, keys in buckets.items():
            for k in keys:
                if k in gs:
                    return b
        return None

    # Quotas: representative
    quotas = {
        "action": 10,
        "comedy": 10,
        "drama": 10,
        "thriller": 8,
        "sci-fi": 8,
        "romance": 6,
        "horror": 6,
        "animation": 6,
        "crime": 6,
        "family": 4,
        "adventure": 4,
        "fantasy": 4,
    }
    target_total = 90  # feel free to adjust 60–120
    picked = []
    picked_ids = set()
    count = {k: 0 for k in quotas.keys()}

    # 1) Fill genre quotas first
    for m in items:
        b = bucket_of(m)
        if not b or b not in quotas:
            continue
        if count[b] >= quotas[b]:
            continue
        mid = m["id"]
        if mid in picked_ids:
            continue
        picked.append(m)
        picked_ids.add(mid)
        count[b] += 1
        if len(picked) >= target_total:
            break

    # 2) Fill remaining with "global famous" (top popularity) to hit target_total
    if len(picked) < target_total:
        for m in items:
            mid = m["id"]
            if mid in picked_ids:
                continue
            picked.append(m)
            picked_ids.add(mid)
            if len(picked) >= target_total:
                break

    return picked

@app.get("/api/booth_picks")
def api_booth_picks():
    refresh = request.args.get("refresh") == "1"
    c = _CACHE["booth_picks"]
    if (not refresh) and c["data"] and time.time() - c["ts"] < CACHE_TTL:
        return jsonify({"results": c["data"], "count": len(c["data"])})

    picks = build_booth_picks()
    c["data"] = picks
    c["ts"] = time.time()
    return jsonify({"results": picks, "count": len(picks)})

# ======================================================
# API — recommendations (lang mandatory + optional filters incl. year)
# ======================================================
@app.post("/api/recommendations")
def api_recommendations():
    data = request.get_json() or {}

    lang = normalize_lang(data.get("lang"))
    if not lang:
        return jsonify({"error": "lang required"}), 400

    genres = normalize_genres(data.get("genres"))
    top_n = clamp_int(data.get("top_n"), 1, 100, 20)
    min_rating = safe_float(data.get("min_rating"))
    max_runtime = safe_float(data.get("max_runtime"))
    level = normalize_lang(data.get("linguistic_level"))

    min_year = clamp_int(data.get("min_year"), 1800, 2100, None)
    max_year = clamp_int(data.get("max_year"), 1800, 2100, None)

    where = ["LOWER(original_language) = %s"]
    params = [lang]

    if genres:
        where.append("ARRAY(SELECT LOWER(x) FROM unnest(genres) x) && %s")
        params.append(genres)

    if min_rating is not None:
        where.append("vote_average >= %s")
        params.append(min_rating)

    if max_runtime is not None:
        where.append("runtime <= %s")
        params.append(max_runtime)

    if level:
        where.append("LOWER(linguistic_level) = %s")
        params.append(level)

    # year filter (optional) - robust extraction from release_date text/date
    # only apply if user filled it
    if min_year is not None:
        where.append("""
            (CASE
              WHEN release_date IS NOT NULL AND release_date::text ~ '^\\d{4}'
              THEN SUBSTRING(release_date::text FROM 1 FOR 4)::int
              ELSE NULL
            END) >= %s
        """)
        params.append(min_year)

    if max_year is not None:
        where.append("""
            (CASE
              WHEN release_date IS NOT NULL AND release_date::text ~ '^\\d{4}'
              THEN SUBSTRING(release_date::text FROM 1 FOR 4)::int
              ELSE NULL
            END) <= %s
        """)
        params.append(max_year)

    sql = f"""
        SELECT *
        FROM {TABLE_NAME}
        WHERE {' AND '.join(where)}
        ORDER BY popularity DESC
        LIMIT %s;
    """
    params.append(top_n)

    conn = get_db()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall() or []

        for r in rows:
            r["poster_url"] = poster_url(r.get("poster_path"))
            r["genre_list"] = r.get("genre_list") or r.get("genres") or []
            r["release_year"] = r.get("release_year") or year_from_release_date(r.get("release_date"))
            r["id"] = str(r.get("id"))

        return jsonify({"results": rows, "count": len(rows)})
    finally:
        release_db(conn)

# ======================================================
# API — stats (cached)
# ======================================================
@app.get("/api/stats")
def api_stats():
    refresh = request.args.get("refresh") == "1"
    c = _CACHE["stats"]
    if (not refresh) and c["data"] and time.time() - c["ts"] < CACHE_TTL:
        return jsonify(c["data"])

    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {TABLE_NAME};")
            total = cur.fetchone()[0]

            cur.execute(f"""
                SELECT LOWER(original_language), COUNT(*)
                FROM {TABLE_NAME}
                WHERE original_language IS NOT NULL AND TRIM(original_language) <> ''
                GROUP BY 1
                ORDER BY 2 DESC
                LIMIT 20;
            """)
            languages = [{"label": r[0], "value": r[1]} for r in cur.fetchall() if r[0]]

            cur.execute(f"""
                SELECT LOWER(linguistic_level), COUNT(*)
                FROM {TABLE_NAME}
                WHERE linguistic_level IS NOT NULL AND TRIM(linguistic_level) <> ''
                GROUP BY 1
                ORDER BY 2 DESC;
            """)
            levels = [{"label": r[0], "value": r[1]} for r in cur.fetchall() if r[0]]

            cur.execute(f"""
                SELECT LOWER(g), COUNT(*)
                FROM {TABLE_NAME}
                CROSS JOIN LATERAL unnest(genres) g
                WHERE g IS NOT NULL AND TRIM(g) <> ''
                GROUP BY 1
                ORDER BY 2 DESC
                LIMIT 25;
            """)
            genres = [{"label": r[0], "value": r[1]} for r in cur.fetchall() if r[0]]

            cur.execute(f"""
                SELECT year_int, COUNT(*)
                FROM (
                  SELECT
                    CASE
                      WHEN release_date IS NOT NULL AND release_date::text ~ '^\\d{{4}}'
                      THEN SUBSTRING(release_date::text FROM 1 FOR 4)::int
                      ELSE NULL
                    END AS year_int
                  FROM {TABLE_NAME}
                ) t
                WHERE year_int IS NOT NULL
                GROUP BY year_int
                ORDER BY year_int ASC;
            """)
            years = [{"year": r[0], "count": r[1]} for r in cur.fetchall() if r[0]]

        payload = {
            "total_movies": total,
            "languages_top": languages,
            "levels_top": levels,
            "genres_top": genres,
            "years_distribution": years,
        }

        c["data"] = payload
        c["ts"] = time.time()
        return jsonify(payload)
    finally:
        release_db(conn)

# ======================================================
# Local dev
# ======================================================
if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
