// IP → il (yalnız Türkiye). Bkz. scripts/geo-build.ts ve migration 0297.
//
// Tablo geo/tr-regions.json'dan açılışta bir kez belleğe alınır (~1 MB dosya,
// ~40 bin aralık). Dosya yoksa ya da bozuksa il bulunmaz (null); istatistikler
// ilsiz çalışmaya devam eder. Ağ çağrısı yoktur: IP hiçbir yere gönderilmez.
//
// Doğruluk: ücretsiz veri il düzeyinde yaklaşık doğrudur; mobil operatörlerin
// adresleri sık sık İstanbul ya da Ankara görünür. Panel bunu "tahmini" diye
// gösterir.

import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";

type Table = {
  provinces: string[];
  start4: Float64Array;
  end4: Float64Array;
  idx4: Uint8Array;
  start6: BigUint64Array;
  end6: BigUint64Array;
  idx6: Uint8Array;
  edition: string;
};

let table: Table | null | undefined;

function load(): Table | null {
  try {
    const file = path.resolve(process.cwd(), "geo", "tr-regions.json");
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      provinces: string[];
      v4: number[];
      v6: Array<string | number>;
      edition?: string;
    };
    const n4 = Math.floor(raw.v4.length / 3);
    const n6 = Math.floor(raw.v6.length / 3);
    const t: Table = {
      provinces: raw.provinces,
      start4: new Float64Array(n4),
      end4: new Float64Array(n4),
      idx4: new Uint8Array(n4),
      start6: new BigUint64Array(n6),
      end6: new BigUint64Array(n6),
      idx6: new Uint8Array(n6),
      edition: raw.edition ?? "",
    };
    for (let i = 0; i < n4; i++) {
      t.start4[i] = raw.v4[i * 3];
      t.end4[i] = raw.v4[i * 3 + 1];
      t.idx4[i] = raw.v4[i * 3 + 2];
    }
    for (let i = 0; i < n6; i++) {
      t.start6[i] = BigInt(`0x${raw.v6[i * 3]}`);
      t.end6[i] = BigInt(`0x${raw.v6[i * 3 + 1]}`);
      t.idx6[i] = Number(raw.v6[i * 3 + 2]);
    }
    console.info(`[site-stats] il tablosu yüklendi (${n4} IPv4, ${n6} IPv6 aralığı, ${t.edition}).`);
    return t;
  } catch (err) {
    console.warn(`[site-stats] il tablosu yüklenemedi, il bilgisi boş kalacak: ${(err as Error).message}`);
    return null;
  }
}

function v6High(ip: string): bigint | null {
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  if (groups.length < 4) return null;
  let hi = 0n;
  for (let i = 0; i < 4; i++) {
    const g = Number.parseInt(groups[i] || "0", 16);
    if (!Number.isFinite(g)) return null;
    hi = (hi << 16n) | BigInt(g);
  }
  return hi;
}

/** Aralık dizisinde ikili arama: start[i] <= x <= end[i] olan i, yoksa -1. */
function find<T extends number | bigint>(start: ArrayLike<T>, end: ArrayLike<T>, x: T): number {
  let lo = 0;
  let hi = start.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (x < start[mid]) hi = mid - 1;
    else if (x > end[mid]) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** İl adı ("İzmir") ya da null (Türkiye dışı, özel ağ, bilinmiyor). */
export function regionOfIp(rawIp: string | undefined | null): string | null {
  if (table === undefined) table = load();
  if (!table) return null;
  let ip = String(rawIp ?? "").trim();
  if (ip.toLowerCase().startsWith("::ffff:")) ip = ip.slice(7);
  const family = isIP(ip);
  if (family === 4) {
    const p = ip.split(".").map(Number);
    const n = ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
    const i = find(table.start4, table.end4, n);
    return i < 0 ? null : (table.provinces[table.idx4[i]] ?? null);
  }
  if (family === 6) {
    const hi = v6High(ip.split("%")[0]);
    if (hi === null) return null;
    const i = find(table.start6, table.end6, hi);
    return i < 0 ? null : (table.provinces[table.idx6[i]] ?? null);
  }
  return null;
}

/** Tablonun sürümü (panel dipnotu için); yüklenmediyse "". */
export function geoEdition(): string {
  if (table === undefined) table = load();
  return table?.edition ?? "";
}
