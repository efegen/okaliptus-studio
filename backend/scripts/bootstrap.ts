// Instructor adını ve admin kullanıcıları .env'den okuyarak DB'ye yazar.
// Idempotent: mevcut kayıtlara dokunmaz. Gerçek kimlik bilgileri kaynak
// koduna asla girmez — yalnızca .env (gitignored) üzerinden gelir.
import bcrypt from 'bcryptjs';
import { pool, closeDatabaseConnection } from '../src/db/connection.js';

const BCRYPT_COST = 12;

async function main() {
  const instructorName = process.env.BOOTSTRAP_INSTRUCTOR_NAME?.trim();
  const adminsRaw = process.env.BOOTSTRAP_ADMINS?.trim();

  if (!adminsRaw) {
    console.error('Error: BOOTSTRAP_ADMINS is not set in .env');
    console.error('Format: username1:password1,username2:password2');
    process.exit(1);
  }

  const admins = adminsRaw.split(',').map((entry) => {
    const colonIdx = entry.indexOf(':');
    if (colonIdx === -1) throw new Error(`Invalid entry (no colon): "${entry}"`);
    const username = entry.slice(0, colonIdx).trim();
    const password = entry.slice(colonIdx + 1).trim();
    if (!username || !password) throw new Error(`Invalid entry: "${entry}"`);
    return { username, password };
  });

  // Instructor
  if (instructorName) {
    const r = await pool.query(
      `UPDATE instructors SET full_name = $1 WHERE full_name = 'Default Instructor' RETURNING id`,
      [instructorName],
    );
    console.log(
      r.rowCount
        ? `Instructor updated: "${instructorName}"`
        : 'Instructor: placeholder not found (already set or no rows)',
    );
  } else {
    console.log('BOOTSTRAP_INSTRUCTOR_NAME not set — skipping instructor update');
  }

  // Admin users
  for (const { username, password } of admins) {
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    const r = await pool.query(
      `INSERT INTO users (username, display_name, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [username, username, hash],
    );
    console.log(r.rowCount ? `User created: ${username}` : `User skipped (exists): ${username}`);
  }

  console.log('Bootstrap complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDatabaseConnection());
