import path from 'path';
import fs from 'fs';
import exifr from 'exifr';
import axios from 'axios';
import sharp from 'sharp';

const DAYS = {
  id: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
};

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// File scan
// ---------------------------------------------------------------------------

/**
 * Scan folder dan kembalikan daftar file JPEG yang ditemukan.
 * @param {string} dir - Path absolut ke folder sumber
 * @returns {string[]} Array nama file (bukan path penuh)
 */
export function scanPhotos(dir) {
  return fs.readdirSync(dir).filter(f => /\.(jpe?g)$/i.test(f));
}

// ---------------------------------------------------------------------------
// EXIF
// ---------------------------------------------------------------------------

/**
 * Baca koordinat GPS dan waktu pengambilan dari metadata EXIF foto.
 * @param {string} filePath - Path absolut ke file foto
 * @returns {Promise<{lat: number|null, lon: number|null, datetime: Date|string|null}>}
 */
export async function readExif(filePath) {
  const data = await exifr.parse(filePath, { gps: true });
  return {
    lat:      data?.latitude        ?? null,
    lon:      data?.longitude       ?? null,
    datetime: data?.DateTimeOriginal ?? null
  };
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

/**
 * Parse tanggal dari EXIF ke objek Date. Format EXIF: "YYYY:MM:DD HH:MM:SS".
 * @param {string|Date|null} dt
 * @returns {Date|null}
 */
export function parseExifDate(dt) {
  if (!dt) return null;
  if (dt instanceof Date) return dt;
  const m = String(dt).match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return new Date(dt);
}

/**
 * Format tanggal ke string yang ditampilkan di panel watermark.
 * Contoh output: "Senin, 09/06/2026 09:30 GMT+07:00"
 * @param {string|Date|null} dt   - Tanggal dari EXIF
 * @param {'id'|'en'} lang        - Bahasa nama hari
 * @returns {string} String kosong jika tanggal tidak valid
 */
export function formatDate(dt, lang) {
  const d = parseExifDate(dt);
  if (!d || isNaN(d)) return '';
  const days = DAYS[lang] ?? DAYS.id;
  const day  = days[d.getDay()];
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh   = String(d.getHours()).padStart(2, '0');
  const min  = String(d.getMinutes()).padStart(2, '0');
  return `${day}, ${dd}/${mm}/${yyyy} ${hh}:${min} GMT+07:00`;
}

// ---------------------------------------------------------------------------
// Nominatim reverse geocode  (cache: ~50m grid)
// ---------------------------------------------------------------------------

const geocodeCache = new Map();

/**
 * Konversi koordinat GPS ke nama lokasi & alamat lengkap via Nominatim (OpenStreetMap).
 * Hasil di-cache per ~50m grid (4 desimal) untuk menghindari request duplikat.
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {Promise<{name: string, full: string}>}
 *   name = ringkas maks 3 bagian (contoh: "Pontianak Kota, Kalimantan Barat, Indonesia")
 *   full = display_name lengkap dari Nominatim
 */
export async function reverseGeocode(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  const { data } = await axios.get('https://nominatim.openstreetmap.org/reverse', {
    params: { lat, lon, format: 'json', 'accept-language': 'id' },
    headers: { 'User-Agent': 'watermark-foto/1.0 (github.com/udinfm/watermark-foto)' },
    timeout: 15000
  });

  const addr = data.address ?? {};
  const nameParts = [
    addr.suburb || addr.neighbourhood || addr.hamlet,
    addr.city_district || addr.county,
    addr.city || addr.town || addr.village,
    addr.state,
    addr.country
  ].filter(Boolean);

  const result = { name: nameParts.slice(0, 3).join(', '), full: data.display_name ?? '' };
  geocodeCache.set(key, result);
  return result;
}

// ---------------------------------------------------------------------------
// OSM tile fetching & stitching
// ---------------------------------------------------------------------------

/**
 * Hitung nomor tile OSM (tx, ty) dan offset piksel (px, py) di dalam tile untuk koordinat tertentu.
 * px/py = posisi titik koordinat di dalam tile (0–256), dipakai untuk crop yang presisi.
 * @param {number} lat
 * @param {number} lon
 * @param {number} zoom
 * @returns {{tx: number, ty: number, px: number, py: number}}
 */
function latLonToTileInfo(lat, lon, zoom) {
  const n    = 2 ** zoom;
  const xF   = (lon + 180) / 360 * n;
  const latR = lat * Math.PI / 180;
  const yF   = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n;
  return { tx: Math.floor(xF), ty: Math.floor(yF), px: (xF % 1) * 256, py: (yF % 1) * 256 };
}

const tileCache = new Map();

/**
 * Download satu tile peta dari CARTO tile server. Hasil di-cache in-memory.
 * @param {number} z - Zoom level
 * @param {number} x - Nomor tile horizontal
 * @param {number} y - Nomor tile vertikal
 * @returns {Promise<Buffer|null>} Buffer PNG tile, atau null jika gagal diunduh
 */
async function fetchTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  // Menggunakan CARTO tile — lebih permissif untuk automated access
  const url = `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`;
  try {
    const { data } = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'watermark-foto/1.0' },
      timeout: 10000
    });
    const buf = Buffer.from(data);
    tileCache.set(key, buf);
    return buf;
  } catch {
    return null;
  }
}

/**
 * Ambil thumbnail peta: stitch 3×3 tiles (768×768px) → crop di titik koordinat → resize ke ukuran target.
 * @param {number} lat  - Latitude titik tengah peta
 * @param {number} lon  - Longitude titik tengah peta
 * @param {number} zoom - Zoom level (1–19; 14 = luas, 17 = detail)
 * @param {number} size - Ukuran output dalam piksel (persegi)
 * @returns {Promise<Buffer>} Buffer PNG hasil crop & resize
 */
export async function fetchMapThumbnail(lat, lon, zoom, size) {
  const TILE = 256;
  const GRID = 3;  // 3×3 tiles = 768×768px stitched
  const { tx, ty, px, py } = latLonToTileInfo(lat, lon, zoom);

  const composites = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const buf = await fetchTile(zoom, tx + dx, ty + dy);
      if (buf) composites.push({ input: buf, top: (dy + 1) * TILE, left: (dx + 1) * TILE });
      await sleep(80);
    }
  }

  const stitchSz = TILE * GRID;  // 768
  const stitched = await sharp({
    create: { width: stitchSz, height: stitchSz, channels: 3, background: '#d8cfc5' }
  }).composite(composites).png().toBuffer();

  // crop centered on target coord, upscale jika perlu
  const cropSz = Math.min(size, stitchSz);
  const cx     = Math.round(TILE + px);
  const cy     = Math.round(TILE + py);
  const left   = Math.max(0, Math.min(cx - Math.floor(cropSz / 2), stitchSz - cropSz));
  const top    = Math.max(0, Math.min(cy - Math.floor(cropSz / 2), stitchSz - cropSz));

  return sharp(stitched)
    .extract({ left, top, width: cropSz, height: cropSz })
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// XML escape untuk SVG text
// ---------------------------------------------------------------------------

/**
 * Escape karakter khusus XML agar aman dimasukkan ke dalam elemen SVG <text>.
 * @param {string} s
 * @returns {string}
 */
export function escXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Pecah teks panjang menjadi array baris sesuai batas karakter per baris.
 * @param {string} text
 * @param {number} maxChars - Maks karakter per baris
 * @returns {string[]}
 */
export function wrapText(text, maxChars) {
  if (!text) return [];
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
