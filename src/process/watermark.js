import sharp from 'sharp';
import { readExif, reverseGeocode, fetchMapThumbnail, formatDate, escXml, wrapText } from '../utils/helpers.js';

// ---------------------------------------------------------------------------
// Panel builder
// ---------------------------------------------------------------------------

async function buildPanel(width, panelH, mapBuf, mapSz, loc, lat, lon, dateStr) {
  const pad       = Math.round(panelH * 0.07);
  const textX     = mapSz + pad;
  const textW     = width - mapSz - pad * 2;
  const nameSize  = Math.round(panelH * 0.115);
  const smallSize = Math.round(panelH * 0.075);
  const lineH1    = nameSize  * 1.25;
  const lineH2    = smallSize * 1.35;
  const charsName = Math.max(10, Math.floor(textW / (nameSize  * 0.58)));
  const charsSml  = Math.max(10, Math.floor(textW / (smallSize * 0.55)));

  const elems = [];
  let y = pad + nameSize;

  // Nama lokasi — bold putih
  for (const line of wrapText(loc.name, charsName)) {
    elems.push(`<text x="${textX}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${nameSize}" font-weight="bold" fill="white">${escXml(line)}</text>`);
    y += lineH1;
  }
  y += smallSize * 0.4;

  // Alamat lengkap — abu-abu
  for (const line of wrapText(loc.full, charsSml)) {
    if (y + smallSize > panelH - pad * 2.5) break;
    elems.push(`<text x="${textX}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${smallSize}" fill="#bbbbbb">${escXml(line)}</text>`);
    y += lineH2;
  }
  y += smallSize * 0.3;

  // Koordinat
  if (y + smallSize <= panelH - pad) {
    elems.push(`<text x="${textX}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${smallSize}" fill="#999999">Lat ${lat.toFixed(6)}° Long ${lon.toFixed(6)}°</text>`);
    y += lineH2;
  }

  // Tanggal & waktu
  if (y + smallSize <= panelH - pad) {
    elems.push(`<text x="${textX}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${smallSize}" fill="#999999">${escXml(dateStr)}</text>`);
  }

  // Atribusi OSM — pojok kanan bawah
  const attrSz = Math.round(smallSize * 0.65);
  elems.push(`<text x="${width - pad}" y="${panelH - Math.round(pad * 0.4)}" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="${attrSz}" fill="#555555">© OpenStreetMap contributors</text>`);

  const svg = `<svg width="${width}" height="${panelH}" xmlns="http://www.w3.org/2000/svg">\n  ${elems.join('\n  ')}\n</svg>`;

  const bgBuf = await sharp({
    create: { width, height: panelH, channels: 3, background: { r: 28, g: 22, b: 14 } }
  }).png().toBuffer();

  return sharp(bgBuf)
    .composite([
      { input: mapBuf,           top: 0, left: 0 },
      { input: Buffer.from(svg), top: 0, left: 0 }
    ])
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Proses satu foto
// ---------------------------------------------------------------------------

export async function processPhoto(inputPath, outputPath, cfg) {
  const exifData = await readExif(inputPath);
  if (exifData.lat == null) throw new Error('Tidak ada data GPS di EXIF');

  const location = await reverseGeocode(exifData.lat, exifData.lon);
  const meta     = await sharp(inputPath).metadata();
  const panelH   = Math.round(meta.height * cfg.panel / 100);
  const dateStr  = formatDate(exifData.datetime, cfg.lang);

  const mapBuf   = await fetchMapThumbnail(exifData.lat, exifData.lon, cfg.zoom, panelH);
  const panelBuf = await buildPanel(meta.width, panelH, mapBuf, panelH, location, exifData.lat, exifData.lon, dateStr);

  await sharp(inputPath)
    .composite([{ input: panelBuf, top: meta.height - panelH, left: 0 }])
    .withMetadata()
    .jpeg({ quality: 92 })
    .toFile(outputPath);
}
