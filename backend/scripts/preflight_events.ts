/**
 * Etkinlik migration'ları için salt-okunur production preflight.
 * Hiçbir satırı değiştirmez; kayıplı 0267 öncesinde veya mevcut iç içe misafir
 * verisi varsa migrate adımını operatörün bilinçli olarak durdurmasını sağlar.
 */
import { pool } from "../src/db/connection.js";

async function main(): Promise<void> {
  const tableResult = await pool.query<{ table_name: string | null }>(
    `SELECT to_regclass('public.event_participants')::text AS table_name`,
  );
  if (!tableResult.rows[0]?.table_name) {
    console.log("Etkinlik tabloları henüz yok; event preflight temiz.");
    return;
  }

  const migrationResult = await pool.query<{ applied: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM schema_migrations
        WHERE filename = '0267_event_rsvp_remove_not_coming.sql'
     ) AS applied`,
  );
  if (!migrationResult.rows[0]?.applied) {
    const notComingResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM event_participants
        WHERE rsvp_status = 'not_coming'`,
    );
    const count = Number(notComingResult.rows[0]?.count ?? 0);
    if (count > 0) {
      throw new Error(
        `0267 uygulanırsa ${count} adet not_coming katılımcı fiziksel silinecek. `
        + "Önce yedek alın ve kayıtları iş kararıyla unsure durumuna taşıyın veya etkinlikten kaldırın.",
      );
    }
  }

  const nestedResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM event_participants child
       JOIN event_participants parent ON parent.id = child.guest_of_participant_id
      WHERE parent.guest_of_participant_id IS NOT NULL`,
  );
  const nestedCount = Number(nestedResult.rows[0]?.count ?? 0);
  if (nestedCount > 0) {
    throw new Error(
      `${nestedCount} adet iç içe misafir bağlantısı var. Deploy öncesinde üst seviye katılımcıya yeniden bağlayın.`,
    );
  }

  console.log("Etkinlik production preflight temiz; veri kaybı göstergesi bulunmadı.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
