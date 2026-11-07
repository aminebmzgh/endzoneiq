-- Separate database for integration tests (npm test). Picks are append-only, so the
-- tests reset this database; they never touch the dev database `endzoneiq`.
CREATE DATABASE IF NOT EXISTS endzoneiq_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON endzoneiq_test.* TO 'endzoneiq'@'%';
