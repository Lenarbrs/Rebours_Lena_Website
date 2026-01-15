import os
import time
import math
import atexit
from collections import Counter

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

def parse_genres_param(v):
    """genres=crime,drama -> ['crime','drama']"""
    if not v:
        return []
    parts = [p.strip().lower() for p in str(v).split(",")]
    return [p for p in parts if p]

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

def normalize_row(r: dict):
    """Ensure fields expected by frontend exist (poster_url, genre_list)."""
    if not r:
        return r
    r["poster_url"] = poster_url(r.get("poster_path"))
    # Front expects genre_list (you have genres array in DB)
    if "genre_list" not in r:
        g = r.get("genres")
        if isinstance(g, list):
            r["genre_list"] = g
        else:
            r["genre_list"] = []
    return r

def year_from_release_date(release_date):
    if not release_date:
        return None
    s = str(release_date)
    if len(s) >= 4 and s[:4].isdigit():
        return int(s[:4])
    return None

def exp_decay(dist, k):
    try:
        return math.exp(-abs(dist) / float(k))
    except Exception:
        return 0.0

def build_user_profile(favs: list[dict]):
    """Mini-model: profile from favorites."""
    if not favs:
        return None

    genre_counter = Counter()
    years = []
    runtimes = []
    ratings = []

    for m in favs:
        gl = m.get("genre_list") or m.get("genres") or []
        for g in gl:
            gg = str(g).strip().lower()
            if gg:
                genre_counter[gg] += 1

        y = year_from_release_date(m.get("release_date"))
        if y:
            years.append(y)

        rt = m.get("runtime")
        if rt is not None:
            try:
                runtimes.append(float(rt))
            except Exception:
                pass

        va = m.get("vote_average")
        if va is not None:
            try:
                ratings.append(float(va))
            except Exception:
                pass

    total_genres = sum(genre_counter.values()) or 1

    profile = {
        "genre_weights": {k: v / total_genres for k, v in genre_counter.items()},
        "mean_year": sum(years) / len(years) if years else None,
        "mean_runtime": sum(runtimes) / len(runtimes) if runtimes else None,
        "mean_rating": sum(ratings) / len(ratings) if ratings else None,
    }
    return profile

def personalized_score(profile, movie: dict):
    """Score candidate movie using profile."""
    if not profile:
        return 0.0

    # Features
    gl = movie.get("genre_list") or movie.get("genres") or []
    gl = [str(g).strip().lower() for g in gl if str(g).strip()]
    y = year_from_release_date(movie.get("release_date"))
    rt = movie.get("runtime")
    va = movie.get("vote_average")
    pop = movie.get("popularity")

    # Genre affinity
    gw = profile["genre_weights"] or {}
    genre_score = 0.0
    if gl:
        genre_score = sum(gw.get(g, 0.0) for g in gl)
        # normalize a bit by number of genres
        genre_score = genre_score / max(1, len(gl))

    # Year affinity
    year_score = 0.0
    if profile["mean_year"] is not None and y is not None:
        year_score = exp_decay(y - profile["mean_year"], 10)  # decade-ish

    # Runtime affinity
    runtime_score = 0.0
    if profile["mean_runtime"] is not None and rt is not None:
        try:
            runtime_score = exp_decay(float(rt) - profile["mean_runtime"], 40)
        except Exception:
            runtime_score = 0.0

    # Rating preference (just use rating as a positive feature)
    rating_score = 0.0
    if va is not None:
        try:
            rating_score = max(0.0, min(1.0, float(va) / 10.0))
        except Exception:
            rating_score = 0.0

    # Popularity (log-normalized)
    pop_score = 0.0
    if pop is not None:
        try:
            pop_score = math.log1p(max(0.0, float(pop))) / 10.0
            pop_score = max(0.0, min(1.0, pop_score))
        except Exception:
            pop_score = 0.0

    # Weights (tunable)
    score = (
        0.55 * genre_score +
        0.15 * year_score +
        0.15 * rating_score +
        0.10 * runtime_score +
        0.05 * pop_score
    )
    return float(score)

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
# API — single movie (needed for dialog fallback)
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
            normalize_row(row)
            return jsonify(row)
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
# API — Booth picks (list of movies user can favorite before printing)
# ======================================================
@app.get("/api/booth_movies")
def api_booth_movies():
    lang = normalize_lang(request.args.get("lang"))
    if not lang:
        return jsonify({"results": [], "count": 0})

    limit = clamp_int(request.args.get("limit"), 1, 40, 12)
    genres = parse_genres_param(request.args.get("genres"))
    year_min = safe_int(request.args.get("year_min"))
    year_max = safe_int(request.args.get("year_max"))

    where = ["LOWER(original_language) = %s"]
    params = [lang]

    if genres:
        where.append("ARRAY(SELECT LOWER(x) FROM unnest(genres) x) && %s")
        params.append(genres)

    # robust year extraction from release_date (date or text)
    year_expr = """
        CASE
          WHEN release_date IS NOT NULL AND release_date::text ~ '^\\d{4}'
          THEN SUBSTRING(release_date::text FROM 1 FOR 4)::int
          ELSE NULL
        END
    """

    if year_min is not None:
        where.append(f"({year_expr}) >= %s")
        params.append(year_min)

    if year_max is not None:
        where.append(f"({year_expr}) <= %s")
        params.append(year_max)

    sql = f"""
        SELECT *
        FROM {TABLE_NAME}
        WHERE {' AND '.join(where)}
        ORDER BY popularity DESC NULLS LAST
        LIMIT %s;
    """
    params.append(limit)

    conn = get_db()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        rows = [normalize_row(r) for r in rows]
        return jsonify({"results": rows, "count": len(rows)})
    finally:
        release_db(conn)

# ======================================================
# API — recommendations (supports sorting + personalized mini-model + year filter)
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
    sort_by = normalize_lang(data.get("sort_by")) or "popularity"

    # optional year filter
    year_min = safe_int(data.get("year_min"))
    year_max = safe_int(data.get("year_max"))

    # favorites for personalization
    fav_ids = data.get("fav_ids") or []
    fav_ids = [str(x) for x in fav_ids if str(x).strip()]

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

    year_expr = """
        CASE
          WHEN release_date IS NOT NULL AND release_date::text ~ '^\\d{4}'
          THEN SUBSTRING(release_date::text FROM 1 FOR 4)::int
          ELSE NULL
        END
    """

    if year_min is not None:
        where.append(f"({year_expr}) >= %s")
        params.append(year_min)

    if year_max is not None:
        where.append(f"({year_expr}) <= %s")
        params.append(year_max)

    # Non-personalized order mapping
    ORDER_MAP = {
        "popularity": "popularity DESC NULLS LAST",
        "rating": "vote_average DESC NULLS LAST, popularity DESC NULLS LAST",
        "newest": f"({year_expr}) DESC NULLS LAST, popularity DESC NULLS LAST",
        "oldest": f"({year_expr}) ASC NULLS LAST, popularity DESC NULLS LAST",
    }

    conn = get_db()
    try:
        # Personalized: get a larger candidate pool then re-rank in Python
        if sort_by in ("personalized", "best", "best_for_you", "for_you"):
            # if no favorites, fallback
            if not fav_ids:
                sort_clause = ORDER_MAP["popularity"]
                sql = f"""
                    SELECT *
                    FROM {TABLE_NAME}
                    WHERE {' AND '.join(where)}
                    ORDER BY {sort_clause}
                    LIMIT %s;
                """
                params2 = params + [top_n]
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(sql, params2)
                    rows = cur.fetchall()
                rows = [normalize_row(r) for r in rows]
                return jsonify({"results": rows, "count": len(rows), "sort_by": "popularity"})

            # load favorites rows
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(f"""
                    SELECT *
                    FROM {TABLE_NAME}
                    WHERE id = ANY(%s);
                """, (fav_ids,))
                fav_rows = cur.fetchall()

            fav_rows = [normalize_row(r) for r in fav_rows]
            profile = build_user_profile(fav_rows)

            # candidate pool
            candidate_limit = max(200, top_n * 8)
            sort_clause = ORDER_MAP["popularity"]
            sql = f"""
                SELECT *
                FROM {TABLE_NAME}
                WHERE {' AND '.join(where)}
                ORDER BY {sort_clause}
                LIMIT %s;
            """
            params2 = params + [candidate_limit]

            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql, params2)
                candidates = cur.fetchall()

            candidates = [normalize_row(r) for r in candidates]

            # score + sort
            scored = []
            for m in candidates:
                s = personalized_score(profile, m)
                m["_user_score"] = s
                scored.append(m)

            scored.sort(key=lambda x: (x.get("_user_score", 0.0), x.get("popularity") or 0.0), reverse=True)
            rows = scored[:top_n]

            # optional: remove internal field if you want
            for r in rows:
                r.pop("_user_score", None)

            return jsonify({"results": rows, "count": len(rows), "sort_by": "personalized"})

        # Standard sorts
        sort_clause = ORDER_MAP.get(sort_by, ORDER_MAP["popularity"])
        sql = f"""
            SELECT *
            FROM {TABLE_NAME}
            WHERE {' AND '.join(where)}
            ORDER BY {sort_clause}
            LIMIT %s;
        """
        params.append(top_n)

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        rows = [normalize_row(r) for r in rows]
        return jsonify({"results": rows, "count": len(rows), "sort_by": sort_by})
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

            # years_distribution: robust extraction from release_date
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
