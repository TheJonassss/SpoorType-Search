# Refreshing the SPOOR index

SPOOR serves search results from a **Cloudflare D1** database — a monthly snapshot of Google Fonts usage taken from HTTP Archive. The live search never touches BigQuery; it reads this pre-computed index. That means the index **ages**: HTTP Archive publishes a new crawl every month, so to keep results current the database has to be reloaded periodically (monthly is ideal; every couple of months is fine).

This is a manual, no-server process. It's free.

---

## What you need

- A Google account with access to the **BigQuery Sandbox** (no card).
- **Wrangler** installed and logged in (`npx wrangler login`).
- The exported CSV converted into SQL load files (see step 2).

---

## Step 1 — Pull the new index from BigQuery

Open the BigQuery console and run the extraction query, changing `date` to the **latest available crawl** (crawls are dated the first of each month, e.g. `2026-06-01`). Check the "This query will process ~18 GB" estimate before running.

```sql
WITH pares AS (
  SELECT
    REGEXP_EXTRACT(url, r'fonts\.gstatic\.com/s/([^/]+)/') AS familia,
    NET.REG_DOMAIN(page)                                   AS dominio,
    MIN(rank)                                              AS rank
  FROM `httparchive.crawl.requests`
  WHERE date = '2026-06-01'          -- <-- change to the newest crawl
    AND client = 'desktop'
    AND type = 'font'
    AND url LIKE '%fonts.gstatic.com/s/%'
  GROUP BY familia, dominio
),
rankeado AS (
  SELECT familia, dominio, rank,
    ROW_NUMBER() OVER (PARTITION BY familia ORDER BY rank ASC) AS posicion
  FROM pares
  WHERE REGEXP_CONTAINS(familia, r'^[a-z0-9]+$') AND dominio IS NOT NULL
)
SELECT familia, dominio, rank
FROM rankeado
WHERE posicion <= 100
ORDER BY familia, rank
```

Then **export the result as CSV** (Save results → CSV, or via Drive if it's large).

## Step 2 — Turn the CSV into SQL load files

D1 loads data from `.sql` files of `INSERT` statements. Convert the CSV into two files, each **under the daily write limit** (split so a single day's load doesn't exceed it). A short script does this, or Claude can generate the two files from the exported CSV.

Result: `parte1.sql` and `parte2.sql` (batched `INSERT INTO uso (familia,dominio,rank) VALUES (...),(...);`).

## Step 3 — Reset the table (cheap) and load

Instead of deleting rows one by one (which counts as writes), **drop and recreate** the table — that's a structural (DDL) operation and clears the old month cleanly. Recreate it **without the index first**, so the load writes each row once instead of twice.

Run in the D1 console (dashboard) or via Wrangler:

```sql
DROP TABLE IF EXISTS uso;
CREATE TABLE uso (familia TEXT NOT NULL, dominio TEXT NOT NULL, rank INTEGER);
```

Then load the data with Wrangler (from the folder holding the files):

```bash
npx wrangler d1 execute spoor-index --remote --file=parte1.sql
# if the daily write limit is hit, wait for reset (00:00 UTC) and run:
npx wrangler d1 execute spoor-index --remote --file=parte2.sql
```

## Step 4 — Recreate the index

Once all rows are loaded, rebuild the index that makes searches fast:

```sql
CREATE INDEX idx_familia ON uso (familia);
```

Loading **without** the index and creating it once at the end avoids the double-write that happens when inserting into an already-indexed table.

## Step 5 — Verify

```bash
npx wrangler d1 execute spoor-index --remote --command "SELECT COUNT(*) AS total FROM uso;"
npx wrangler d1 execute spoor-index --remote --command "SELECT dominio, rank FROM uso WHERE familia='roboto' ORDER BY rank LIMIT 5;"
```

The count should match the row count of the new CSV, and a known family (e.g. `roboto`) should return real domains. Done — the live site now serves the new month with no redeploy needed.

---

## Notes

- **Write limits reset daily (00:00 UTC).** If a load errors saying the limit is exceeded, wait for the reset and continue with the next file. Splitting into two files is the safe default.
- **The `date` is the only thing that changes** month to month. Everything else stays the same.
- **This process only touches the database.** The frontend (`index.html`) and the search function (`functions/api/search.js`) are untouched by a refresh.
- HTTP Archive is a sample, not a census (only crawled sites, homepage only, name visible in the URL). A refresh brings a fresher sample, not completeness.

---

*SPOOR — index maintenance.*
