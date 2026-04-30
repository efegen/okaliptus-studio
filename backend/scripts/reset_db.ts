// Local test DB reset. DATABASE_URL'dan DB adını çıkartır, bağlantıyı kapatır,
// postgres maintenance DB üzerinden DROP + CREATE yapar.
//
// SAFETY: sadece localhost/127.0.0.1/::1 ve NODE_ENV !== 'production' olduğunda çalışır.
import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set.');
  process.exit(1);
}

const parsed = new URL(url);
const host = parsed.hostname;
const dbName = parsed.pathname.replace(/^\//, '');

const productionMarkers = [
  'supabase', 'neon', 'render', 'railway', 'rds.amazonaws', 'amazonaws',
  'heroku', 'digitalocean', 'vercel', 'azure', 'googleusercontent',
  'fly.dev', 'cloud', 'production', 'prod-',
];

const urlLower = url.toLowerCase();
const matchedMarker = productionMarkers.find((m) => urlLower.includes(m));
if (matchedMarker) {
  console.error(`ABORT: DATABASE_URL contains production marker "${matchedMarker}".`);
  process.exit(1);
}
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`ABORT: host "${host}" is not local.`);
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('ABORT: NODE_ENV=production.');
  process.exit(1);
}

const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';

async function main() {
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  console.log(`Connected to admin DB; will drop+create "${dbName}"...`);

  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [dbName],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  // UTF8 + template0: Windows'ta postgres template1 default encoding WIN1252
  // olabiliyor; Türkçe karakterler için template0 şart.
  await admin.query(
    `CREATE DATABASE "${dbName}" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`,
  );
  console.log(`DB "${dbName}" dropped and recreated.`);
  await admin.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
