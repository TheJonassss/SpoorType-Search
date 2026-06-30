# SPOOR©
// Beta // WIP

**Find where a typeface lives on the web.**

SPOOR is a free search tool for the type community. Type the name of a typeface and get back a list of real-world projects and websites where it has been used, each linking straight to the source.

It is a search engine, not a platform — no uploads, no accounts, no human curation. SPOOR doesn't store or crawl anything of its own; it leans on data and searches that already exist.

---

## Who it's for

- **Type foundries & designers** tracking where their typefaces show up in the wild, without waiting for someone to submit it somewhere.
- **Graphic designers** researching how a typeface has been used before choosing it.

SPOOR works best with **distinctive names**. A unique foundry name like *Söhne*, *Migra*, or *GT Sectra* mentioned on a page almost always means real usage, with very little noise.

---

## How it works

SPOOR finds typefaces through two complementary mechanisms:

1. **Textual** — a search API (Serper) looks across the open web for projects that *name* the typeface in their title, description, or copy. These surface as **portfolio** results.
2. **Technical** *(phase 2)* — HTTP Archive (via BigQuery) detects sites that actually *load* the font through their CSS. These surface as **web** results.

Results from both are merged into a single ranked list — portfolio first, web as filler — and cleaned through a two-layer blocklist (see `functions/api/blocklist.json`) that removes predictable noise: font marketplaces, identifiers, encyclopedias, piracy sites, and foundry storefronts.

### Honest limits

- A typeface used inside an image that nobody named is **invisible** — SPOOR finds named or detectable uses, it doesn't recognize fonts in pictures.
- Generic names (*Helvetica*, *Futura*) are noisier than distinctive ones.
- Technical detection is a monthly snapshot, not real-time.

---

## Project structure

```
spoor/
├── index.html                  # the interface (static, no framework)
└── functions/
    └── api/
        ├── search.js           # serverless search function (Cloudflare)
        └── blocklist.json      # two-layer noise filter
```

## Running it

SPOOR is a static page plus one serverless function. It needs a single environment variable:

- `FIRECRAWL_API_KEY` — a key from [firecrawl.dev](https://firecrawl.dev/) (free tier available).

Set it in your host's environment variables (never in the code), connect the repo, and deploy. The function reads the key at runtime and keeps it server-side.

---

## Typeface

SPOOR is set entirely in **Pliant**, by [Non Foundry](https://fonts.google.com/specimen/Pliant) — a deliberate choice: the tool for tracking type, dressed in the maker's own type.

## Credits

Designed and built by **Jona Saucedo** / **Non Foundry**.

---

*The name comes from the Dutch/Afrikaans word for the trail an animal leaves behind.*
