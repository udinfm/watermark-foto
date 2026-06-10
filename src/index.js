import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import exifr from 'exifr'
import axios from 'axios'
import chalk from 'chalk'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DAYS = {
  id: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs() {
  const cfg = { input: 'sources', output: 'hasil', panel: 28, zoom: 15, lang: 'id' }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--input':  case '-i': cfg.input  = argv[++i]; break
      case '--output': case '-o': cfg.output = argv[++i]; break
      case '--panel':  case '-p': cfg.panel  = Number(argv[++i]); break
      case '--zoom':   case '-z': cfg.zoom   = Number(argv[++i]); break
      case '--lang':   case '-l': cfg.lang   = argv[++i]; break
      case '--help':   case '-h': printHelp(); process.exit(0)
    }
  }
  return cfg
}

function printHelp() {
  console.log(`
${chalk.cyan.bold('=== Watermark Foto — GPS Overlay Tool ===')}

${chalk.yellow('Usage:')} node src/index.js [options]

${chalk.yellow('Options:')}
  ${chalk.green('-i, --input')}   <folder>   Folder foto sumber  ${chalk.gray('(default: sources)')}
  ${chalk.green('-o, --output')}  <folder>   Folder output       ${chalk.gray('(default: hasil)')}
  ${chalk.green('-p, --panel')}   <persen>   Tinggi panel (% dari tinggi foto) ${chalk.gray('(default: 28)')}
  ${chalk.green('-z, --zoom')}    <level>    Zoom level peta OSM ${chalk.gray('(default: 15)')}
  ${chalk.green('-l, --lang')}    <id|en>    Bahasa nama hari    ${chalk.gray('(default: id)')}
  ${chalk.green('-h, --help')}               Tampilkan bantuan ini

${chalk.yellow('Contoh:')}
  node src/index.js
  node src/index.js --input ../sources --output ../hasil --lang id
  node src/index.js -i ../sources -o ../hasil -p 30 -z 16 -l en
`)
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const sleep = ms => new Promise(r => setTimeout(r, ms))

function escXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function wrapText(text, maxChars) {
  if (!text) return []
  const words = text.split(' ')
  const lines = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (next.length > maxChars && cur) { lines.push(cur); cur = w }
    else cur = next
  }
  if (cur) lines.push(cur)
  return lines
}

function parseExifDate(dt) {
  if (!dt) return null
  if (dt instanceof Date) return dt
  const m = String(dt).match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return new Date(dt)
}

function formatDate(dt, lang) {
  const d = parseExifDate(dt)
  if (!d || isNaN(d)) return ''
  const days = DAYS[lang] ?? DAYS.id
  const day  = days[d.getDay()]
  const dd   = String(d.getDate()).padStart(2, '0')
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh   = String(d.getHours()).padStart(2, '0')
  const min  = String(d.getMinutes()).padStart(2, '0')
  return `${day}, ${dd}/${mm}/${yyyy} ${hh}:${min} GMT+07:00`
}

// ---------------------------------------------------------------------------
// EXIF
// ---------------------------------------------------------------------------

async function readExif(filePath) {
  const data = await exifr.parse(filePath, { gps: true, pick: ['DateTimeOriginal'] })
  return {
    lat:      data?.latitude       ?? null,
    lon:      data?.longitude      ?? null,
    datetime: data?.DateTimeOriginal ?? null
  }
}

// ---------------------------------------------------------------------------
// Nominatim reverse geocode  (cache: ~50m grid)
// ---------------------------------------------------------------------------

const geocodeCache = new Map()

async function reverseGeocode(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`
  if (geocodeCache.has(key)) return geocodeCache.get(key)

  const { data } = await axios.get('https://nominatim.openstreetmap.org/reverse', {
    params: { lat, lon, format: 'json', 'accept-language': 'id' },
    headers: { 'User-Agent': 'watermark-foto/1.0 (github.com/udinfm/watermark-foto)' },
    timeout: 15000
  })

  const addr = data.address ?? {}
  const nameParts = [
    addr.suburb || addr.neighbourhood || addr.hamlet,
    addr.city_district || addr.county,
    addr.city || addr.town || addr.village,
    addr.state,
    addr.country
  ].filter(Boolean)

  const result = { name: nameParts.slice(0, 3).join(', '), full: data.display_name ?? '' }
  geocodeCache.set(key, result)
  return result
}

// ---------------------------------------------------------------------------
// OSM tile fetching & stitching
// ---------------------------------------------------------------------------

function latLonToTileInfo(lat, lon, zoom) {
  const n    = 2 ** zoom
  const xF   = (lon + 180) / 360 * n
  const latR = lat * Math.PI / 180
  const yF   = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n
  return { tx: Math.floor(xF), ty: Math.floor(yF), px: (xF % 1) * 256, py: (yF % 1) * 256 }
}

const tileCache = new Map()

async function fetchTile(z, x, y) {
  const key = `${z}/${x}/${y}`
  if (tileCache.has(key)) return tileCache.get(key)
  try {
    const { data } = await axios.get(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'watermark-foto/1.0', 'Referer': 'https://openstreetmap.org' },
      timeout: 10000
    })
    const buf = Buffer.from(data)
    tileCache.set(key, buf)
    return buf
  } catch {
    return null
  }
}

async function fetchMapThumbnail(lat, lon, zoom, size) {
  const TILE = 256
  const GRID = 3  // 3×3 tiles = 768×768px stitched
  const { tx, ty, px, py } = latLonToTileInfo(lat, lon, zoom)

  const composites = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const buf = await fetchTile(zoom, tx + dx, ty + dy)
      if (buf) composites.push({ input: buf, top: (dy + 1) * TILE, left: (dx + 1) * TILE })
      await sleep(80)
    }
  }

  const stitchSz = TILE * GRID  // 768
  const stitched = await sharp({
    create: { width: stitchSz, height: stitchSz, channels: 3, background: '#d8cfc5' }
  }).composite(composites).png().toBuffer()

  // crop centered on target coord, upscale if needed
  const cropSz = Math.min(size, stitchSz)
  const cx     = Math.round(TILE + px)
  const cy     = Math.round(TILE + py)
  const left   = Math.max(0, Math.min(cx - Math.floor(cropSz / 2), stitchSz - cropSz))
  const top    = Math.max(0, Math.min(cy - Math.floor(cropSz / 2), stitchSz - cropSz))

  return sharp(stitched)
    .extract({ left, top, width: cropSz, height: cropSz })
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer()
}

// ---------------------------------------------------------------------------
// Panel builder
// ---------------------------------------------------------------------------

async function buildPanel(width, panelH, mapBuf, mapSz, loc, lat, lon, dateStr) {
  const pad       = Math.round(panelH * 0.07)
  const textX     = mapSz + pad
  const textW     = width - mapSz - pad * 2
  const nameSize  = Math.round(panelH * 0.115)
  const smallSize = Math.round(panelH * 0.075)
  const lineH1    = nameSize  * 1.25
  const lineH2    = smallSize * 1.35
  const charsName = Math.max(10, Math.floor(textW / (nameSize  * 0.58)))
  const charsSml  = Math.max(10, Math.floor(textW / (smallSize * 0.55)))

  const elems = []
  let y = pad + nameSize

  // Nama lokasi — bold putih
  for (const line of wrapText(loc.name, charsName)) {
    elems.push(`<text x="${textX}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${nameSize}" font-weight="bold" fill="white">${escXml(line)}</text>`)
    y += lineH1
  }
  y += smallSize * 0.4

  // Alamat lengkap — abu-abu
  for (const line of wrapText(loc.full, charsSml)) {
    if (y + smallSize > panelH - pad * 2.5) break
    elems.push(`<text x="${textX}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${smallSize}" fill="#bbbbbb">${escXml(line)}</text>`)
    y += lineH2
  }
  y += smallSize * 0.3

  // Koordinat
  if (y + smallSize <= panelH - pad) {
    elems.push(`<text x="${textX}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${smallSize}" fill="#999999">Lat ${lat.toFixed(6)}° Long ${lon.toFixed(6)}°</text>`)
    y += lineH2
  }

  // Tanggal & waktu
  if (y + smallSize <= panelH - pad) {
    elems.push(`<text x="${textX}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${smallSize}" fill="#999999">${escXml(dateStr)}</text>`)
  }

  // Atribusi OSM — pojok kanan bawah
  const attrSz = Math.round(smallSize * 0.65)
  elems.push(`<text x="${width - pad}" y="${panelH - Math.round(pad * 0.4)}" text-anchor="end" font-family="Arial,Helvetica,sans-serif" font-size="${attrSz}" fill="#555555">© OpenStreetMap contributors</text>`)

  const svg = `<svg width="${width}" height="${panelH}" xmlns="http://www.w3.org/2000/svg">\n  ${elems.join('\n  ')}\n</svg>`

  const bgBuf = await sharp({
    create: { width, height: panelH, channels: 3, background: { r: 28, g: 22, b: 14 } }
  }).png().toBuffer()

  return sharp(bgBuf)
    .composite([
      { input: mapBuf,           top: 0, left: 0 },
      { input: Buffer.from(svg), top: 0, left: 0 }
    ])
    .png()
    .toBuffer()
}

// ---------------------------------------------------------------------------
// Proses satu foto
// ---------------------------------------------------------------------------

async function processPhoto(inputPath, outputPath, cfg) {
  const exifData = await readExif(inputPath)
  if (exifData.lat == null) throw new Error('Tidak ada data GPS di EXIF')

  const location = await reverseGeocode(exifData.lat, exifData.lon)
  const meta     = await sharp(inputPath).metadata()
  const panelH   = Math.round(meta.height * cfg.panel / 100)
  const dateStr  = formatDate(exifData.datetime, cfg.lang)

  const mapBuf   = await fetchMapThumbnail(exifData.lat, exifData.lon, cfg.zoom, panelH)
  const panelBuf = await buildPanel(meta.width, panelH, mapBuf, panelH, location, exifData.lat, exifData.lon, dateStr)

  await sharp(inputPath)
    .composite([{ input: panelBuf, top: meta.height - panelH, left: 0 }])
    .withMetadata()
    .jpeg({ quality: 92 })
    .toFile(outputPath)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const cfg       = parseArgs()
  const inputDir  = path.resolve(cfg.input)
  const outputDir = path.resolve(cfg.output)

  console.log(chalk.cyan.bold('\n=== Watermark Foto — GPS Overlay Tool ===\n'))

  if (!fs.existsSync(inputDir)) {
    console.error(chalk.red(`✗ Folder input tidak ditemukan: ${inputDir}`))
    process.exit(1)
  }
  fs.mkdirSync(outputDir, { recursive: true })

  const files = fs.readdirSync(inputDir).filter(f => /\.(jpe?g)$/i.test(f))
  if (!files.length) {
    console.log(chalk.yellow('Tidak ada file JPEG ditemukan.'))
    return
  }

  console.log(chalk.green(`Ditemukan ${files.length} foto di '${cfg.input}'`))
  console.log(chalk.gray(`Output → '${cfg.output}' | Panel: ${cfg.panel}% | Zoom: ${cfg.zoom} | Lang: ${cfg.lang}\n`))

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    process.stdout.write(`[${i + 1}/${files.length}] ${chalk.white(file)} ... `)
    try {
      await processPhoto(path.join(inputDir, file), path.join(outputDir, file), cfg)
      console.log(chalk.green('✓ selesai'))
    } catch (err) {
      console.log(chalk.red(`✗ SKIP (${err.message})`))
    }
    // Nominatim rate-limit: 1 req/sec
    if (i < files.length - 1) await sleep(1100)
  }

  console.log(chalk.green.bold('\n✓ Semua selesai!'))
}

main().catch(e => {
  console.error(chalk.red.bold('\n✗ Error:'), e.message)
  process.exit(1)
})
