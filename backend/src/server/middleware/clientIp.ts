// Ziyaretçinin gerçek IP'si — Cloudflare geçişine hazırlık.
//
// Bugün: istek → Railway'in kenar proxy'si → uygulama. app.ts'teki
// "trust proxy 1" sayesinde req.ip ziyaretçinin IP'sidir.
//
// api.okaliptusyoga.com Cloudflare'de turuncu bulut (proxied) olursa araya bir
// hop daha girer: istek → Cloudflare → Railway → uygulama. O zaman req.ip
// Cloudflare'in birkaç kenar IP'sinden biri olur ve TÜM ziyaretçiler aynı IP'yi
// paylaşır: IP başına sınırlar (giriş denemesi, site formları) herkesi birlikte
// sayar, gerçek ziyaretçiler "burst"e düşer ya da 429 alır.
//
// Bu ara katman bunu önler: req.ip Cloudflare'in YAYIMLADIĞI aralıklardan
// birindeyse, Cloudflare'in yazdığı CF-Connecting-IP başlığı gerçek IP sayılır.
// Başlık başka hiçbir durumda okunmaz: Railway'e doğrudan gelen biri bu başlığı
// uydurursa req.ip kendi IP'si olur (Cloudflare aralığında değil) ve başlık yok
// sayılır. Cloudflare'den geçen istekte başlığı Cloudflare kendisi yazar
// (ziyaretçinin gönderdiğini ezer).
//
// Aralıklar: https://www.cloudflare.com/ips-v4 ve /ips-v6 (2026-11-22 tarihli).
// Cloudflare nadiren değiştirir; değişirse bu liste güncellenmeli.
//
// Turuncu bulut için GEREKEN diğer ayarlar (kod dışı, bkz. CLAUDE.md "Cloudflare
// geçişi"): SSL/TLS modu Full (strict); Bot Fight Mode / challenge api'ye
// uygulanmamalı (tarayıcının fetch istekleri doğrulama ekranını çözemez, form
// ve panel bozulur).

import { BlockList, isIP } from "node:net";
import type { NextFunction, Request, Response } from "express";

const CLOUDFLARE_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const CLOUDFLARE_V6 = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
  "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];

const cloudflare = new BlockList();
for (const cidr of CLOUDFLARE_V4) {
  const [address, prefix] = cidr.split("/");
  cloudflare.addSubnet(address, Number(prefix), "ipv4");
}
for (const cidr of CLOUDFLARE_V6) {
  const [address, prefix] = cidr.split("/");
  cloudflare.addSubnet(address, Number(prefix), "ipv6");
}

/** "::ffff:1.2.3.4" → "1.2.3.4"; boşsa "". */
function normalizeIp(raw: string | undefined | null): string {
  const ip = String(raw ?? "").trim();
  if (ip.toLowerCase().startsWith("::ffff:") && isIP(ip.slice(7)) === 4) return ip.slice(7);
  return ip;
}

export function isCloudflareIp(raw: string | undefined | null): boolean {
  const ip = normalizeIp(raw);
  const family = isIP(ip);
  if (family === 4) return cloudflare.check(ip, "ipv4");
  if (family === 6) return cloudflare.check(ip, "ipv6");
  return false;
}

/** İsteği yapanın IP'si: Cloudflare'den geldiyse CF-Connecting-IP, yoksa req.ip. */
export function clientIpOf(req: Request): string {
  const hop = normalizeIp(req.ip);
  if (isCloudflareIp(hop)) {
    const header = req.headers["cf-connecting-ip"];
    const value = normalizeIp(Array.isArray(header) ? header[0] : header);
    if (isIP(value)) return value;
  }
  return hop;
}

/**
 * app.ts'te en başta bağlanır: req.ip'i yukarıdaki kurala göre düzeltir. Böylece
 * IP okuyan her yer (express-rate-limit'in varsayılan anahtarı, giriş kayıtları,
 * site formları, Turnstile) Cloudflare arkasında da gerçek ziyaretçiyi görür.
 */
export function cloudflareClientIp(req: Request, _res: Response, next: NextFunction): void {
  const hop = req.ip;
  if (hop && isCloudflareIp(hop)) {
    const real = clientIpOf(req);
    if (real && real !== normalizeIp(hop)) {
      Object.defineProperty(req, "ip", { value: real, configurable: true, enumerable: true });
    }
  }
  next();
}
