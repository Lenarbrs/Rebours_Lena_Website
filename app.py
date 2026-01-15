import os
import atexit
from flask import Flask, jsonify, request, render_template
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import SimpleConnectionPool

app = Flask(__name__)

TMDB_IMG_BASE = "https://image.tmdb.org/t/p/w342"
TABLE_NAME = os.environ.get("MOVIES_TABLE", "movies")

# --------------------
# DB Pool (created once)
# --------------------
DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set in environment variables")

POOL = SimpleConnectionPool(
    minconn=1,
    maxconn=10,
    dsn=DATABASE_URL,
    sslmode="require",
)

@atexit.register
def _close_pool():
    try:
        POOL.closeall()
    except Exception:
        pass

def get_db_connection():
    """Borrow a connection from the pool."""
    return POOL.getconn()

def release_db_connection(conn):
    """Return a connection to the pool."""
    if conn is not None:
        POOL.putconn(conn)

# --------------------
# Helpers
# --------------------
def clamp_int(v, a, b, default):
    try:
        n = int(v)
        return max(a, min(b, n))
    except Exception:
        return default

def safe_float(v):
    try:
        return float(v)
    except Exception:
        return None

def normalize_lang(lang):
    return (lang or "").strip().lower()

def normalize_genres(genres):
    out = []
    for g in (genres or []):
        g = str(g).strip().lower()
        if g:
            out.append(g)
    return out

def poster_url_from_path(poster_path):
    if not poster_path:
        return None
    p = str(poster_path)
    return f"{TMDB_IMG_BASE}{p}" if p.startswith("/") else None

# --------------------
# Pages
# --------------------
@app.get("/")
def home():
    return render_template("index.html")

@app.get("/about")
def about():
    return render_template("about.html")

@app.get("/stats")
def stats_page():
    return render_template("stats.html")

# --------------------
# API
# --------------------
@app.get("/api/languages")
def api_languages():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT DISTINCT LOWER(original_language) AS lang
                FROM {TABLE_NAME}
                WHERE original_language IS NOT NULL AND TRIM(original_language) <> ''
                ORDER BY lang ASC;
            """)
            langs = [r[0] for r in cur.fetchall() if r[0] and r[0] != "nan"]
        return jsonify({"languages": langs})
    finally:
        release_db_connection(conn)

@app.get("/api/genres")
def api_genres():
    lang = normalize_lang(request.args.get("lang"))
    if not lang:
        return jsonify({"genres": []})

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT DISTINCT LOWER(g) AS genre
                FROM {TABLE_NAME}
                CROSS JOIN LATERAL unnest(genres) AS g
                WHERE LOWER(original_language) = %s
                  AND g IS NOT NULL AND TRIM(g) <> ''
                ORDER BY genre ASC;
            """, (lang,))
            genres = [r[0] for r in cur.fetchall() if r[0]]
        return jsonify({"genres": genres})
    finally:
        release_db_connection(conn)

@app.get("/api/linguistic_levels")
def api_linguistic_levels():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT DISTINCT LOWER(linguistic_level) AS lvl
                FROM {TABLE_NAME}
                WHERE linguistic_level IS NOT NULL AND TRIM(linguistic_level) <> ''
                ORDER BY lvl ASC;
            """)
            levels = [r[0] for r in cur.fetchall() if r[0] and r[0] != "nan"]
        return jsonify({"levels": levels})
    finally:
        release_db_connection(conn)

@app.post("/api/recommendations")
def api_recommendations():
    data = request.get_json(silent=True) or {}

    lang = normalize_lang(data.get("lang"))
    if not lang:
        return jsonify({"error": "lang is required"}), 400

    genres = normalize_genres(data.get("genres"))
    top_n = clamp_int(data.get("top_n", 20), 1, 100, 20)

    min_rating = safe_float(data.get("min_rating"))
    max_runtime = safe_float(data.get("max_runtime"))
    linguistic_level = (data.get("linguistic_level") or "").strip().lower()

    where = ["LOWER(original_language) = %s"]
    params = [lang]

    # genres overlap (at least one in common)
    if genres:
        where.append("ARRAY(SELECT LOWER(x) FROM unnest(genres) x) && %s")
        params.append(genres)

    if min_rating is not None:
        where.append("COALESCE(vote_average, -1) >= %s")
        params.append(float(min_rating))

    if max_runtime is not None:
        where.append("COALESCE(runtime, 1000000000) <= %s")
        params.append(float(max_runtime))

    if linguistic_level:
        where.append("LOWER(COALESCE(linguistic_level,'')) = %s")
        params.append(linguistic_level)

    where_sql = " AND ".join(where)

    sql = f"""
        SELECT
            id,
            title,
            original_title,
            release_date,
            LOWER(original_language) AS original_language,
            genres,
            overview,
            runtime,
            popularity,
            vote_average,
            poster_path,
            linguistic_level,
            linguistic_register
        FROM {TABLE_NAME}
        WHERE {where_sql}
        ORDER BY COALESCE(popularity, 0) DESC
        LIMIT %s;
    """
    params.append(top_n)

    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, tuple(params))
            rows = cur.fetchall()

        items = []
        for r in rows:
            gl = r.get("genres") or []
            gl = [str(x).strip().lower() for x in gl if str(x).strip()]

            items.append({
                "id": str(r.get("id")),
                "title": r.get("title") or "Unknown title",
                "original_title": r.get("original_title") or "",
                "release_date": r.get("release_date"),
                "original_language": (r.get("original_language") or "").lower(),
                "genre_list": gl,
                "overview": r.get("overview"),
                "runtime": r.get("runtime"),
                "popularity": r.get("popularity") or 0,
                "vote_average": r.get("vote_average"),
                "poster_url": poster_url_from_path(r.get("poster_path")),
                "linguistic_level": (r.get("linguistic_level") or "").strip().lower()
                if r.get("linguistic_level") else None,
                "linguistic_register": (r.get("linguistic_register") or "").strip().lower()
                if r.get("linguistic_register") else None,
            })

        return jsonify({"results": items, "count": len(items)})
    finally:
        release_db_connection(conn)

@app.get("/api/movie/<movie_id>")
def api_movie(movie_id):
    movie_id = str(movie_id)

    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                SELECT
                    id,
                    title,
                    original_title,
                    release_date,
                    LOWER(original_language) AS original_language,
                    genres,
                    overview,
                    runtime,
                    popularity,
                    vote_average,
                    poster_path,
                    linguistic_level,
                    linguistic_register
                FROM {TABLE_NAME}
                WHERE id = %s
                LIMIT 1;
            """, (movie_id,))
            r = cur.fetchone()

        if not r:
            return jsonify({"error": "not found"}), 404

        gl = r.get("genres") or []
        gl = [str(x).strip().lower() for x in gl if str(x).strip()]

        out = dict(r)
        out["id"] = str(out.get("id"))
        out["title"] = out.get("title") or "Unknown title"
        out["original_title"] = out.get("original_title") or ""
        out["original_language"] = (out.get("original_language") or "").lower()
        out["genre_list"] = gl
        out["poster_url"] = poster_url_from_path(out.get("poster_path"))

        return jsonify(out)
    finally:
        release_db_connection(conn)

@app.get("/api/stats")
def api_stats():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {TABLE_NAME};")
            total_movies = int(cur.fetchone()[0])

            if total_movies == 0:
                return jsonify({
                    "total_movies": 0,
                    "languages_top": [],
                    "levels_top": [],
                    "genres_top": [],
                    "years_distribution": [],
                })

            cur.execute(f"""
                SELECT LOWER(original_language) AS label, COUNT(*)::int AS value
                FROM {TABLE_NAME}
                WHERE original_language IS NOT NULL AND TRIM(original_language) <> ''
                GROUP BY LOWER(original_language)
                ORDER BY value DESC
                LIMIT 20;
            """)
            languages_top = [{"label": r[0], "value": r[1]} for r in cur.fetchall() if r[0]]

            cur.execute(f"""
                SELECT LOWER(linguistic_level) AS label, COUNT(*)::int AS value
                FROM {TABLE_NAME}
                WHERE linguistic_level IS NOT NULL AND TRIM(linguistic_level) <> ''
                GROUP BY LOWER(linguistic_level)
                ORDER BY value DESC
                LIMIT 12;
            """)
            levels_top = [{"label": r[0], "value": r[1]} for r in cur.fetchall() if r[0]]

            cur.execute(f"""
                SELECT LOWER(g) AS label, COUNT(*)::int AS value
                FROM {TABLE_NAME}
                CROSS JOIN LATERAL unnest(genres) AS g
                WHERE g IS NOT NULL AND TRIM(g) <> ''
                GROUP BY LOWER(g)
                ORDER BY value DESC
                LIMIT 25;
            """)
            genres_top = [{"label": r[0], "value": r[1]} for r in cur.fetchall() if r[0]]

            cur.execute(f"""
                SELECT y::text AS label, COUNT(*)::int AS value
                FROM (
                    SELECT (substring(release_date from '(\\d{{4}})'))::int AS y
                    FROM {TABLE_NAME}
                    WHERE release_date IS NOT NULL
                ) t
                WHERE y BETWEEN 1900 AND 2025
                GROUP BY y
                ORDER BY y ASC;
            """)
            years_distribution = [{"label": r[0], "value": r[1]} for r in cur.fetchall() if r[0]]

            if len(years_distribution) > 50:
                years_distribution = years_distribution[-50:]

        return jsonify({
            "total_movies": total_movies,
            "languages_top": languages_top,
            "levels_top": levels_top,
            "genres_top": genres_top,
            "years_distribution": years_distribution,
        })
    finally:
        release_db_connection(conn)

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
