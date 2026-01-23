import os
import time
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
# Cache (24h)
# ======================================================
CACHE_TTL = 24 * 3600
_CACHE = {
    "languages": {"ts": 0, "data": None},
    "levels": {"ts": 0, "data": None},
    "registers": {"ts": 0, "data": None},
    "stats": {"ts": 0, "data": None},
    "booth_picks": {"ts": 0, "data": None},
}

# ======================================================
# Booth Picks — YOUR CURATED LIST (20)
# ======================================================
BOOTH_PICKS = [
    {"title": "Parasite", "year": 2019},
    {"title": "Spirited Away", "year": 2001},
    {"title": "Your Name.", "year": 2016},
    {"title": "Amélie", "year": 2001},
    {"title": "Intouchables", "year": 2011},
    {"title": "La vita è bella", "year": 1997},
    {"title": "Jurassic Park", "year": 1993},
    {"title": "Forrest Gump", "year": 1994},
    {"title": "The Dark Knight", "year": 2008},
    {"title": "Slumdog Millionaire", "year": 2008},
    {"title": "The Lives of Others", "year": 2006},
    {"title": "Inception", "year": 2010},
    {"title": "The Grand Budapest Hotel", "year": 2014},
    {"title": "Life of Pi", "year": 2012},
    {"title": "Roma", "year": 2018},
    {"title": "The Pianist", "year": 2002},
    {"title": "Harry Potter and the Sorcerer's Stone", "year": 2001},
    {"title": "Coco", "year": 2017},
    {"title": "The Lion King", "year": 1994},
    {"title": "Titanic", "year": 1997},
]

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

def safe_int(v):
    try:
        return int(v)
    except Exception:
        return None

def poster_url(path):
    if path and str(path).startswith("/"):
        return f"{TMDB_IMG_BASE}{path}"
    return None

# SQL snippet to extract year from release_date (robust)
YEAR_SQL = r"""
CASE
  WHEN release_date IS NOT NULL AND release_date::text ~ '^\d{4}'
  THEN SUBSTRING(release_date::text FROM 1 FOR 4)::int
  ELSE NULL
END
"""

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

@app.get("/api/linguistic_registers")
def api_registers():
    c = _CACHE["registers"]
    if c["data"] and time.time() - c["ts"] < CACHE_TTL:
        return jsonify({"registers": c["data"]})

    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT DISTINCT LOWER(linguistic_register)
                FROM {TABLE_NAME}
                WHERE linguistic_register IS NOT NULL AND TRIM(linguistic_register) <> ''
                ORDER BY 1;
            """)
            registers = [r[0] for r in cur.fetchall() if r[0]]

        c["data"] = registers
        c["ts"] = time.time()
        return jsonify({"registers": registers})
    finally:
        release_db(conn)

# ======================================================
# API — genres (depends on chosen language)
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
# API — single movie (used by dialog)
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
            return jsonify(row)
    finally:
        release_db(conn)

# ======================================================
# API — Booth Picks
# ======================================================
@app.get("/api/booth_picks")
def api_booth_picks():
    refresh = request.args.get("refresh") == "1"
    c = _CACHE["booth_picks"]
    if (not refresh) and c["data"] and time.time() - c["ts"] < CACHE_TTL:
        return jsonify({"results": c["data"], "count": len(c["data"])})

    values_sql = ", ".join(["(%s, %s)"] * len(BOOTH_PICKS))
    params = []
    for p in BOOTH_PICKS:
        params.extend([p["title"], p["year"]])

    sql = f"""
    WITH picks(title, y) AS (
      VALUES {values_sql}
    ),
    movies_with_year AS (
      SELECT m.*, {YEAR_SQL} AS year_int
      FROM {TABLE_NAME} m
    )
    SELECT mw.*
    FROM picks p
    JOIN movies_with_year mw
      ON (LOWER(mw.title) = LOWER(p.title) OR LOWER(mw.original_title) = LOWER(p.title))
     AND mw.year_int = p.y;
    """

    conn = get_db()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        for r in rows:
            r["poster_url"] = poster_url(r.get("poster_path"))

        if len(rows) < len(BOOTH_PICKS):
            missing = len(BOOTH_PICKS) - len(rows)
            conn2 = get_db()
            try:
                with conn2.cursor(cursor_factory=RealDictCursor) as cur2:
                    cur2.execute(f"""
                        SELECT *
                        FROM {TABLE_NAME}
                        ORDER BY popularity DESC NULLS LAST
                        LIMIT %s;
                    """, (missing,))
                    extra = cur2.fetchall()
                for r in extra:
                    r["poster_url"] = poster_url(r.get("poster_path"))
                rows = rows + extra
            finally:
                release_db(conn2)

        c["data"] = rows
        c["ts"] = time.time()
        return jsonify({"results": rows, "count": len(rows)})
    finally:
        release_db(conn)

# ======================================================
# API — stats (UPDATED: languages_all)
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
            total = cur.fetchone()[0] or 0

            # ✅ ALL languages (no LIMIT)
            cur.execute(f"""
                SELECT LOWER(original_language) AS label, COUNT(*) AS count
                FROM {TABLE_NAME}
                WHERE original_language IS NOT NULL AND TRIM(original_language) <> ''
                GROUP BY 1
                ORDER BY count DESC, label ASC;
            """)
            languages_all = [{"label": r[0], "count": r[1]} for r in cur.fetchall()]

            # ✅ TOP languages for chart (keep small)
            languages_top = languages_all[:12]

            cur.execute(f"""
                SELECT LOWER(linguistic_level) AS label, COUNT(*) AS count
                FROM {TABLE_NAME}
                WHERE linguistic_level IS NOT NULL AND TRIM(linguistic_level) <> ''
                GROUP BY 1
                ORDER BY count DESC
                LIMIT 12;
            """)
            levels = [{"label": r[0], "count": r[1]} for r in cur.fetchall()]

            cur.execute(f"""
                SELECT LOWER(g) AS label, COUNT(*) AS count
                FROM {TABLE_NAME}
                CROSS JOIN LATERAL unnest(genres) g
                WHERE g IS NOT NULL AND TRIM(g) <> ''
                GROUP BY 1
                ORDER BY count DESC
                LIMIT 14;
            """)
            genres = [{"label": r[0], "count": r[1]} for r in cur.fetchall()]

            cur.execute(f"""
                SELECT {YEAR_SQL} AS year, COUNT(*)
                FROM {TABLE_NAME}
                WHERE {YEAR_SQL} IS NOT NULL
                GROUP BY 1
                ORDER BY 1 ASC;
            """)
            years = [{"year": r[0], "count": r[1]} for r in cur.fetchall() if r[0]]

        payload = {
            "total_movies": int(total),
            "languages_top": languages_top,   # chart
            "languages_all": languages_all,   # ✅ map + list
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
# API — recommendations (paginated)
# language required, others optional
# ======================================================
@app.post("/api/recommendations")
def api_recommendations():
    data = request.get_json() or {}

    lang = normalize_lang(data.get("lang"))
    if not lang:
        return jsonify({"error": "lang required"}), 400

    genres = normalize_genres(data.get("genres"))
    min_rating = safe_float(data.get("min_rating"))
    max_runtime = safe_float(data.get("max_runtime"))
    level = normalize_lang(data.get("linguistic_level"))
    register = normalize_lang(data.get("linguistic_register"))
    year_min = safe_int(data.get("year_min"))
    year_max = safe_int(data.get("year_max"))

    limit = clamp_int(data.get("limit"), 1, 60, 20)
    offset = clamp_int(data.get("offset"), 0, 500000, 0)

    where = ["LOWER(original_language) = %s"]
    params = [lang]

    if genres:
        where.append("ARRAY(SELECT LOWER(x) FROM unnest(genres) x) && %s")
        params.append(genres)

    if level:
        where.append("LOWER(linguistic_level) = %s")
        params.append(level)

    if register:
        where.append("LOWER(linguistic_register) = %s")
        params.append(register)

    if min_rating is not None:
        where.append("vote_average >= %s")
        params.append(min_rating)

    if max_runtime is not None:
        where.append("runtime <= %s")
        params.append(max_runtime)

    if year_min is not None:
        where.append(f"({YEAR_SQL}) >= %s")
        params.append(year_min)

    if year_max is not None:
        where.append(f"({YEAR_SQL}) <= %s")
        params.append(year_max)

    where_sql = " AND ".join(where)

    sql_count = f"""
        SELECT COUNT(*) AS total
        FROM {TABLE_NAME}
        WHERE {where_sql};
    """

    sql_page = f"""
        SELECT *
        FROM {TABLE_NAME}
        WHERE {where_sql}
        ORDER BY popularity DESC NULLS LAST
        LIMIT %s OFFSET %s;
    """

    conn = get_db()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql_count, params)
            total = int(cur.fetchone()["total"] or 0)

            page_params = params + [limit, offset]
            cur.execute(sql_page, page_params)
            rows = cur.fetchall()

        for r in rows:
            r["poster_url"] = poster_url(r.get("poster_path"))

        has_more = (offset + len(rows)) < total

        return jsonify({
            "results": rows,
            "count": len(rows),
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": has_more,
        })
    finally:
        release_db(conn)

# ======================================================
# Local dev
# ======================================================
if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
