# Cultural Content Recommendation Algorithm — Website

A cultural content recommendation project (MVP focus: **movies**) designed for people learning a foreign language.  
The goal is to provide **personalized recommendations** in a target language **without sacrificing the user’s tastes**, and to encourage language immersion through culture (movies first, with music/videos planned later).

---

## Project Objective

This project aims to build a web-based tool that allows users to:
- discover cultural content (movies) in a **language they want to learn**;
- maintain a recommendation logic based on **user preferences** (genre, criteria, etc.);
- encourage the discovery of works that are less highlighted by traditional recommendation systems.

---

## Data (TMDB)

Movie data is sourced from **TMDB via its API**.  
A Python script is used to collect a large volume of movies in order to avoid under-representing less common languages, and then to filter and assemble the dataset accordingly.

---

## Repository Structure

At the root of the repository:

```text
.
├── script python/          # Data / ML scripts & notebooks (TMDB API, cleaning, recommendation, annotation)
├── static/                 # Front-end assets (CSS / JS / images, etc.)
├── templates/              # HTML templates
├── app.py                  # Web application entry point
└── requirements.txt        # Python dependencies
