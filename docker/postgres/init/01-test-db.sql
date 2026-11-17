-- Runs once, when the mom_pg_data volume is first created.
-- A separate database for automated tests (#3), so tests never touch dev data.
CREATE DATABASE mom_test OWNER mom;
