import 'dotenv/config';
import pkg from 'pg';
const { Client } = pkg;

const sql = `
CREATE TABLE IF NOT EXISTS videos (
  id            TEXT PRIMARY KEY,
  s3_key        TEXT NOT NULL,
  original_name TEXT,
  mime          TEXT,
  size          BIGINT,
  owner_sub     TEXT,
  uploaded_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_videos_owner_sub   ON videos(owner_sub);
CREATE INDEX IF NOT EXISTS idx_videos_uploaded_at ON videos(uploaded_at);
`;

async function main() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  await client.query(sql);
  console.log('✅ videos table is ready');
  await client.end();
}

main().catch(err => {
  console.error('❌ Failed to create table:', err);
  process.exit(1);
});
