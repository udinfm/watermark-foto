# Watermark Foto — GPS Overlay Tool

Aplikasi CLI untuk menambahkan overlay informasi GPS ke foto JPEG, mirip dengan tampilan **GPS Map Camera**. Overlay berisi thumbnail peta, nama lokasi, alamat lengkap, koordinat, dan waktu pengambilan foto.

## Contoh Output

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│                    [ foto asli ]                        │
│                                                         │
├──────────────┬──────────────────────────────────────────┤
│              │  Nama Lokasi (bold)                      │
│  [PETA OSM]  │  Alamat lengkap...                       │
│              │  Lat -0.020472° Long 109.327086°         │
│              │  Senin, 09/06/2026 09:30 GMT+07:00       │
└──────────────┴──────────────────────────────────────────┘
```

> Peta menggunakan **OpenStreetMap** (gratis, tanpa API key)

---

## Struktur Folder

```
watermark-foto/          ← repo ini (folder apps/)
├── src/
│   └── index.js         ← main app
├── package.json
├── .gitignore
└── README.md

[di luar repo]
├── sources/             ← foto sumber (input)
├── hasil/               ← foto hasil (output)
└── contoh/              ← contoh referensi output
```

---

## Instalasi

**Prasyarat:** Node.js v18+

```bash
cd apps
npm install
```

> Jika muncul error SSL (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`), jalankan dulu:
> ```bash
> npm config set strict-ssl false
> npm install
> ```

---

## Cara Pakai

### Perintah dasar (dari root folder proyek)

```bash
node apps/src/index.js --input sources --output hasil
```

### Dari dalam folder `apps/`

```bash
node src/index.js --input ../sources --output ../hasil
```

### Semua opsi

```bash
node src/index.js [opsi]
```

| Opsi | Singkat | Default | Keterangan |
|------|---------|---------|------------|
| `--input` | `-i` | `sources` | Folder foto sumber |
| `--output` | `-o` | `hasil` | Folder foto output |
| `--panel` | `-p` | `28` | Tinggi panel bawah (% dari tinggi foto) |
| `--zoom` | `-z` | `15` | Zoom level peta OSM (14–17 direkomendasikan) |
| `--lang` | `-l` | `id` | Bahasa nama hari: `id` (Indonesia) atau `en` (English) |
| `--help` | `-h` | — | Tampilkan bantuan |

### Contoh penggunaan

```bash
# Default — panel 28%, bahasa Indonesia
node src/index.js -i ../sources -o ../hasil

# Panel lebih kecil, zoom lebih detail, bahasa Inggris
node src/index.js -i ../sources -o ../hasil -p 20 -z 16 -l en

# Tentukan folder lain
node src/index.js --input D:/foto/liburan --output D:/foto/liburan-watermark
```

---

## Syarat Foto

- Format: `.jpg` / `.jpeg`
- Foto **harus memiliki data GPS di EXIF** (diambil dengan GPS aktif)
- Foto tanpa GPS akan di-skip otomatis

---

## Cara Kerja

1. **Baca EXIF** — ambil koordinat GPS dan waktu dari metadata foto
2. **Reverse geocode** — kirim koordinat ke [Nominatim](https://nominatim.openstreetmap.org/) untuk dapat nama lokasi & alamat
3. **Ambil peta** — fetch tile OpenStreetMap (3×3 grid), stitch, crop di koordinat target
4. **Buat panel** — render panel gelap dengan peta + teks menggunakan SVG
5. **Composite** — tempel panel ke bagian bawah foto, simpan ke folder output

---

## Catatan

- **Rate limit Nominatim:** 1 request/detik — untuk foto banyak, proses akan otomatis jeda antar foto
- **Cache tile:** tile peta di-cache selama sesi berjalan, koordinat yang sama tidak di-fetch ulang
- **Kualitas output:** JPEG 92%, EXIF metadata asli dipertahankan
- **Atribusi:** output menyertakan teks `© OpenStreetMap contributors` sesuai lisensi ODbL

---

## Lisensi

ISC — [Very Shafrudin](mailto:very.shafrudin@gmail.com)
