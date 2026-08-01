-- A catalogue item can expose only one active option for a given duration.
-- Keep the most configured duplicate active so existing local/test data can
-- adopt the invariant without losing historical invoice or service links.
WITH ranked_duration_options AS (
  SELECT
    option.id,
    row_number() OVER (
      PARTITION BY
        option.account_id,
        option.item_id,
        option.duration_count,
        option.duration_unit
      ORDER BY
        (
          SELECT count(*)
          FROM public.trainer_rates rate
          WHERE rate.option_id = option.id
            AND rate.is_active
        ) DESC,
        (option.standard_price IS NOT NULL) DESC,
        option.created_at,
        option.id
    ) AS rank
  FROM public.catalog_options option
  WHERE option.is_active
    AND option.duration_count IS NOT NULL
    AND option.duration_unit IS NOT NULL
)
UPDATE public.catalog_options option
SET is_active = FALSE,
    updated_at = now()
FROM ranked_duration_options ranked
WHERE option.id = ranked.id
  AND ranked.rank > 1;

-- Merchandise has a single active unit price rather than duration variants.
WITH ranked_unit_options AS (
  SELECT
    option.id,
    row_number() OVER (
      PARTITION BY option.account_id, option.item_id
      ORDER BY
        (option.standard_price IS NOT NULL) DESC,
        option.created_at,
        option.id
    ) AS rank
  FROM public.catalog_options option
  WHERE option.is_active
    AND option.duration_count IS NULL
    AND option.duration_unit IS NULL
)
UPDATE public.catalog_options option
SET is_active = FALSE,
    updated_at = now()
FROM ranked_unit_options ranked
WHERE option.id = ranked.id
  AND ranked.rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_options_active_duration_unique
  ON public.catalog_options(
    account_id,
    item_id,
    duration_count,
    duration_unit
  )
  WHERE is_active
    AND duration_count IS NOT NULL
    AND duration_unit IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_options_active_unit_unique
  ON public.catalog_options(account_id, item_id)
  WHERE is_active
    AND duration_count IS NULL
    AND duration_unit IS NULL;
