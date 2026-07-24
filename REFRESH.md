# Refreshing the SPOOR index

SPOOR serves results from a **Cloudflare D1** database — a monthly snapshot of Google Fonts usage taken from HTTP Archive. The live search never touches BigQuery; it reads this pre-computed index. That means the index **ages**, so it should be reloaded roughly once a month.

This procedure loads the new month into a **separate table** while the live one keeps serving, then swaps them in seconds. The site never goes down.

It's manual, server-less and free.

---

## What you need

- A Google account with access to the **BigQuery Sandbox** (no card).
- **Wrangler** installed and logged in (`npx wrangler login`).

---

## Step 1 — Check which crawl is published

HTTP Archive publishes a new crawl each month, usually available towards the end of that month. This query lists the available crawl dates and **costs nothing** (metadata queries are free):

```sql
SELECT partition_id
FROM `httparchive.crawl.INFORMATION_SCHEMA.PARTITIONS`
WHERE table_name = 'requests'
ORDER BY partition_id DESC
LIMIT 6
```

The newest date at the top is the crawl to use. Ignore any `__NULL__` row.

## Step 2 — Extract the new index

Run the extraction query in BigQuery, setting `date` to the crawl from step 1. Check the "This query will process ~18 GB" estimate before running — that's a small fraction of the free 1 TB/month.

```sql
WITH pares AS (
  SELECT
    REGEXP_EXTRACT(url, r'fonts\.gstatic\.com/s/([^/]+)/') AS familia,
    NET.REG_DOMAIN(page)                                   AS dominio,
    MIN(rank)                                              AS rank
  FROM `httparchive.crawl.requests`
  WHERE date = '2026-07-01'          -- <-- newest crawl
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

Then **Save results → CSV** and download it.

## Step 3 — Turn the CSV into SQL load files

D1 loads from `.sql` files of batched `INSERT` statements. Convert the CSV into **two files**, split so that a single day's load stays under the free plan's daily write limit (~95,000 rows in the first file works well).

Each statement targets the temporary table:

```sql
INSERT INTO uso_nuevo (familia,dominio,rank) VALUES ('roboto','samsung.com',1000), ... ;
```

## Step 4 — Create the temporary table (no index yet)

```bash
npx wrangler d1 execute spoor-index --remote --command "CREATE TABLE uso_nuevo (familia TEXT NOT NULL, dominio TEXT NOT NULL, rank INTEGER);"
```

**Do not create the index at this point.** Inserting into an indexed table writes each row twice (once to the table, once to the index). Loading without the index halves the writes; the index is created once at the end.

## Step 5 — Load the data

From the folder holding the `.sql` files:

```bash
npx wrangler d1 execute spoor-index --remote --file=parte1.sql
npx wrangler d1 execute spoor-index --remote --file=parte2.sql
```

If the daily write limit is reached, the second file can be loaded once the limit resets. Throughout the load the live site keeps serving from the old table.

Verify the row count matches the CSV:

```bash
npx wrangler d1 execute spoor-index --remote --command "SELECT COUNT(*) AS total FROM uso_nuevo;"
```

## Step 6 — Create the index on the new table

```bash
npx wrangler d1 execute spoor-index --remote --command "CREATE INDEX idx_familia_nuevo ON uso_nuevo (familia);"
```

## Step 7 — Swap the tables

Only after the row count checks out. This takes seconds:

```bash
npx wrangler d1 execute spoor-index --remote --command "DROP TABLE uso;"
npx wrangler d1 execute spoor-index --remote --command "ALTER TABLE uso_nuevo RENAME TO uso;"
npx wrangler d1 execute spoor-index --remote --command "DROP INDEX IF EXISTS idx_familia_nuevo; CREATE INDEX IF NOT EXISTS idx_familia ON uso (familia);"
```

The last command restores the standard index name, so the next refresh starts from the same state.

## Step 8 — Verify

```bash
npx wrangler d1 execute spoor-index --remote --command "SELECT COUNT(*) AS total FROM uso;"
npx wrangler d1 execute spoor-index --remote --command "SELECT dominio, rank FROM uso WHERE familia='roboto' ORDER BY rank LIMIT 5;"
```

The count should match the new CSV, and a known family should return real domains. Then search on the live site to confirm. **No redeploy is needed** — the frontend and the search function are untouched by a refresh.

---

## Notes

- **Only the `date` changes** month to month. Everything else stays the same.
- **A refresh only touches the database.** `index.html` and `functions/api/search.js` are unaffected.
- HTTP Archive is a sample, not a census (crawled sites only, homepage only, font name visible in the URL). A refresh brings a fresher sample, not completeness.

---

*SPOOR — index maintenance.*
