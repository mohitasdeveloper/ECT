-- Only needed if you already ran migration_featured_services_v6.sql before
-- this fix. Updates the Talent Hunt link_url from the placeholder to the
-- real one. Safe to run even if the row doesn't exist yet (affects 0 rows).
UPDATE public.featured_services
SET link_url = 'https://mohitmali5489.github.io/HUNT/'
WHERE provider_name = 'Kalamandal' AND label = 'Talent Hunt';
