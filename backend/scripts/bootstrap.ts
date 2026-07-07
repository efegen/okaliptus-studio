// Admin kullanıcılarını ve başlangıç eğitmenini .env'den okuyarak DB'ye yazar.
// Idempotent: mevcut kayıtlara dokunmaz. Gerçek kimlik bilgileri (kullanıcı
// adı, şifre, eğitmen ismi) kaynak koduna asla girmez — yalnızca .env
// (gitignored) üzerinden gelir.
import bcrypt from 'bcryptjs';
import { pool, closeDatabaseConnection } from '../src/db/connection.js';

const BCRYPT_COST = 12;

async function main() {
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
    if (password.length < 6) {
      throw new Error(`Password too short for "${username}" (min 6 chars)`);
    }
    return { username, password };
  });

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

  // Owner terfisi: BOOTSTRAP_ADMINS'teki bu kullanıcı adı 'owner' rolüne
  // yükseltilir. UPDATE idempotent ve tek yönlü (role <> 'owner' koşulu) —
  // panelden yapılan rol değişikliklerini her bootstrap çalıştığında ezmez,
  // ve tekrar çalıştırmak owner'ı asla düşürmez.
  const ownerUsername = process.env.BOOTSTRAP_OWNER_USERNAME?.trim();
  if (ownerUsername) {
    const r = await pool.query(
      `UPDATE users SET role = 'owner' WHERE username = $1 AND role <> 'owner' RETURNING id`,
      [ownerUsername],
    );
    console.log(
      r.rowCount
        ? `User promoted to owner: ${ownerUsername}`
        : `Owner promotion skipped (already owner or not found): ${ownerUsername}`,
    );
  } else {
    console.warn(
      'Warning: BOOTSTRAP_OWNER_USERNAME is not set — no owner assigned. ' +
        'The user management panel will have no one able to sign in to it.',
    );
  }

  const activeOwners = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM users WHERE role = 'owner' AND is_active = true`,
  );
  if (Number(activeOwners.rows[0].count) === 0) {
    console.warn('Warning: no active owner exists. Set BOOTSTRAP_OWNER_USERNAME and re-run bootstrap.');
  }

  // Başlangıç eğitmeni: tek eğitmenli stüdyo için ilk eğitmeni .env'den oku.
  // İsim PII olduğu için koda gömülmez; yalnızca BOOTSTRAP_INSTRUCTOR_NAME'den
  // gelir. Idempotent: aktif bir eğitmen zaten varsa (örn. UI'dan eklenmişse)
  // dokunmaz, böylece tekrar çalıştırınca kopya kayıt oluşmaz.
  const instructorName = process.env.BOOTSTRAP_INSTRUCTOR_NAME?.trim();
  if (instructorName) {
    const r = await pool.query(
      `INSERT INTO instructors (full_name, is_active)
       SELECT $1, true
       WHERE NOT EXISTS (
         SELECT 1 FROM instructors WHERE is_active = true AND deleted_at IS NULL
       )
       RETURNING id`,
      [instructorName],
    );
    console.log(
      r.rowCount
        ? `Instructor created: ${instructorName}`
        : 'Instructor skipped (an active instructor already exists)',
    );
  } else {
    console.warn(
      'Warning: BOOTSTRAP_INSTRUCTOR_NAME is not set — no instructor seeded. ' +
        'Create one from the Instructors screen before scheduling lessons.',
    );
  }

  console.log('Bootstrap complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDatabaseConnection());
