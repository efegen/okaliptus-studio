/**
 * Site istatistikleri için il tablosu üretir: geo/tr-regions.json
 *
 * Kaynak: DB-IP "IP to City Lite" (CC BY 4.0, https://db-ip.com). Aylık yayımlanır:
 *   https://download.db-ip.com/free/dbip-city-lite-YYYY-MM.csv.gz
 * Lisans gereği verinin gösterildiği yerde "IP Geolocation by DB-IP" yazmalı
 * (panelde Site ekranının dipnotu, sitede gizlilik sayfası).
 *
 * Yalnız Türkiye satırları ve yalnız İL tutulur (ilçe, koordinat, yurt dışı
 * yok). Komşu aralıklar aynı ildeyse birleştirilir. Çıktı ~1 MB; sunucu açılışta
 * belleğe alır (bkz. src/services/site-geo.service.ts).
 *
 * ÇALIŞTIRMA (ayda bir, isteğe bağlı):
 *   cd backend && npx tsx scripts/geo-build.ts <indirilen .csv.gz dosyasının yolu>
 */

import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

const PROVINCES = [
  "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Aksaray", "Amasya", "Ankara", "Antalya", "Ardahan",
  "Artvin", "Aydın", "Balıkesir", "Bartın", "Batman", "Bayburt", "Bilecik", "Bingöl", "Bitlis", "Bolu",
  "Burdur", "Bursa", "Çanakkale", "Çankırı", "Çorum", "Denizli", "Diyarbakır", "Düzce", "Edirne",
  "Elazığ", "Erzincan", "Erzurum", "Eskişehir", "Gaziantep", "Giresun", "Gümüşhane", "Hakkari",
  "Hatay", "Iğdır", "Isparta", "İstanbul", "İzmir", "Kahramanmaraş", "Karabük", "Karaman", "Kars",
  "Kastamonu", "Kayseri", "Kilis", "Kırıkkale", "Kırklareli", "Kırşehir", "Kocaeli", "Konya",
  "Kütahya", "Malatya", "Manisa", "Mardin", "Mersin", "Muğla", "Muş", "Nevşehir", "Niğde", "Ordu",
  "Osmaniye", "Rize", "Sakarya", "Samsun", "Siirt", "Sinop", "Sivas", "Şanlıurfa", "Şırnak",
  "Tekirdağ", "Tokat", "Trabzon", "Tunceli", "Uşak", "Van", "Yalova", "Yozgat", "Zonguldak",
];

// Kaynaktaki yazımlar → il adı.
const ALIASES: Record<string, string> = {
  Istanbul: "İstanbul",
  Canakkale: "Çanakkale",
  "Hakkâri": "Hakkari",
  Izmir: "İzmir",
};

function provinceIndex(raw: string): number {
  const name = raw.replace(/ Province$/, "").trim();
  return PROVINCES.indexOf(ALIASES[name] ?? name);
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function v4ToInt(ip: string): number {
  const p = ip.split(".").map(Number);
  return ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
}

/** IPv6 adresinin ilk 64 biti. */
function v6High(ip: string): bigint {
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  let hi = 0n;
  for (let i = 0; i < 4; i++) hi = (hi << 16n) | BigInt(Number.parseInt(groups[i] || "0", 16));
  return hi;
}

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) {
    console.error("Kullanım: npx tsx scripts/geo-build.ts <dbip-city-lite-YYYY-MM.csv.gz>");
    process.exit(1);
  }

  const v4: Array<[number, number, number]> = [];
  const v6: Array<[bigint, bigint, number]> = [];
  const unknown = new Map<string, number>();

  const lines = createInterface({ input: createReadStream(input).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes(",TR,")) continue;
    const f = splitCsv(line);
    if (f[3] !== "TR") continue;
    const idx = provinceIndex(f[4] ?? "");
    if (idx < 0) {
      unknown.set(f[4] ?? "", (unknown.get(f[4] ?? "") ?? 0) + 1);
      continue;
    }
    if (f[0].includes(":")) v6.push([v6High(f[0]), v6High(f[1]), idx]);
    else v4.push([v4ToInt(f[0]), v4ToInt(f[1]), idx]);
  }

  v4.sort((a, b) => a[0] - b[0]);
  v6.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const flat4: number[] = [];
  for (const [s, e, i] of v4) {
    const n = flat4.length;
    if (n && flat4[n - 1] === i && flat4[n - 2] + 1 === s) flat4[n - 2] = e;
    else flat4.push(s, e, i);
  }
  const flat6: Array<string | number> = [];
  let last6: [bigint, bigint, number] | null = null;
  for (const [s, e, i] of v6) {
    if (last6 && last6[2] === i && last6[1] + 1n >= s) {
      if (e > last6[1]) last6[1] = e;
      flat6[flat6.length - 2] = last6[1].toString(16);
    } else {
      last6 = [s, e, i];
      flat6.push(s.toString(16), e.toString(16), i);
    }
  }

  const dir = path.resolve(process.cwd(), "geo");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "tr-regions.json");
  writeFileSync(
    file,
    JSON.stringify({
      source: "DB-IP IP to City Lite (CC BY 4.0, https://db-ip.com)",
      edition: path.basename(input).replace(/\.csv\.gz$/, ""),
      provinces: PROVINCES,
      v4: flat4,
      v6: flat6,
    }),
  );

  const seen = new Set<number>();
  for (let i = 2; i < flat4.length; i += 3) seen.add(flat4[i]);
  console.log(`IPv4 aralığı: ${flat4.length / 3}, IPv6 aralığı: ${flat6.length / 3}, il: ${seen.size}/81`);
  if (unknown.size) console.log("Tanınmayan il adları:", Object.fromEntries(unknown));
  console.log(`Yazıldı: ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
