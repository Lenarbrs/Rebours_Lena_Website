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
    "stats": {"ts": 0, "data": None},
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
            cur.execute("""
                SELECT DISTINCT LOWER(original_language)
                FROM movies
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
            cur.execute("""
                SELECT DISTINCT LOWER(linguistic_level)
                FROM movies
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
# API — genres
# ======================================================
@app.get("/api/genres")
def api_genres():
    lang = normalize_lang(request.args.get("lang"))
    if not lang:
        return jsonify({"genres": []})

    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT LOWER(g)
                FROM movies
                CROSS JOIN LATERAL unnest(genres) g
                WHERE LOWER(original_language) = %s
                ORDER BY 1;
            """, (lang,))
            genres = [r[0] for r in cur.fetchall() if r[0]]
        return jsonify({"genres": genres})
    finally:
        release_db(conn)

# ======================================================
# API — recommendations
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

    sql = f"""
        SELECT *
        FROM movies
        WHERE {' AND '.join(where)}
        ORDER BY popularity DESC
        LIMIT %s;
    """
    params.append(top_n)

    conn = get_db()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        for r in rows:
            r["poster_url"] = poster_url(r.get("poster_path"))

        return jsonify({"results": rows, "count": len(rows)})
    finally:
        release_db(conn)

# ======================================================
# API — stats (cached)
# ======================================================
@app.get("/api/stats")
def api_stats():
    c = _CACHE["stats"]
    if c["data"] and time.time() - c["ts"] < CACHE_TTL:
        return jsonify(c["data"])

    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM movies;")
            total = cur.fetchone()[0]

            cur.execute("""
                SELECT LOWER(original_language), COUNT(*)
                FROM movies
                GROUP BY 1
                ORDER BY 2 DESC
                LIMIT 20;
            """)
            languages = [{"label": r[0], "value": r[1]} for r in cur.fetchall() if r[0]]

            cur.execute("""
                SELECT LOWER(linguistic_level), COUNT(*)
                FROM movies
                WHERE linguistic_level IS NOT NULL
                GROUP BY 1
                ORDER BY 2 DESC;
            """)
            levels = [{"label": r[0], "value": r[1]} for r in cur.fetchall() if r[0]]

            cur.execute("""
                SELECT LOWER(g), COUNT(*)
                FROM movies
                CROSS JOIN LATERAL unnest(genres) g
                GROUP BY 1
                ORDER BY 2 DESC
                LIMIT 25;
            """)
            genres = [{"label": r[0], "value": r[1]} for r in cur.fetchall() if r[0]]

        payload = {
            "total_movies": total,
            "languages_top": languages,
            "levels_top": levels,
            "genres_top": genres,
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
