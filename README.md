# Watermark Foto — GPS Overlay Tool

Aplikasi CLI untuk menambahkan overlay informasi GPS ke foto JPEG, mirip tampilan **GPS Map Camera**. Data diambil otomatis dari EXIF foto, peta menggunakan **OpenStreetMap** (gratis, tanpa API key).

## Contoh Output

Foto asli akan ditambahkan panel di bagian bawah seperti ini:

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│                    [ foto asli ]                        │
│                                                         │
├──────────────┬──────────────────────────────────────────┤
│              │  Kecamatan Pontianak Kota,               │
│  [PETA OSM]  │  Kalimantan Barat, Indonesia             │
│              │  Jl. Khw. Hasyim No.249, Pontianak...   │
│              │  Lat -0.020472°  Long 109.327086°        │
│              │  Senin, 09/06/2026 09:30 GMT+07:00       │
└──────────────┴──────────────────────────────────────────┘
```

---

## Struktur Aplikasi

```
apps/
├── index.js               ← entry point, jalankan file ini
├── package.json
├── .gitignore
├── README.md
└── src/
    ├── cli/
    │   └── prompts.js     ← pertanyaan interaktif ke user (inquirer)
    ├── process/
    │   └── watermark.js   ← logika overlay: buat panel + tempel ke foto
    └── utils/
        └── helpers.js     ← fungsi bantu: baca EXIF, geocode, fetch tile peta
```

---

## Instalasi

**Prasyarat:** Node.js v18+

```bash
cd apps
npm install
```

> Jika muncul error SSL (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`):
> ```bash
> npm config set strict-ssl false
> npm install
> ```

---

## Cara Pakai

Jalankan dari dalam folder `apps/`:

```bash
node index.js
```

App akan menanyakan beberapa hal secara interaktif:

```
Step 1: Konfigurasi
? Folder foto sumber:                      → path ke folder berisi foto .jpg
? Folder output:                           → path folder penyimpanan hasil
? Tinggi panel bawah (% dari tinggi foto): → ukuran panel, default 28%
? Zoom level peta OSM:                     → 14 = tampilan luas, 17 = lebih detail
? Bahasa nama hari:                        → Indonesia atau English

Step 2: Scan Foto
✓ Ditemukan 4 foto

? Proses 4 foto sekarang? → konfirmasi sebelum mulai

Step 3: Memproses Foto
[1/4] IMG_20260609_093037.jpg ... ✓ selesai
[2/4] IMG_20260609_093104.jpg ... ✓ selesai
...
✓ Selesai!
```

---

## Syarat Foto

- Format: `.jpg` / `.jpeg`
- Foto **harus diambil dengan GPS aktif** — data koordinat tersimpan di EXIF
- Foto tanpa GPS akan di-skip otomatis dengan pesan error

---

## Cara Kerja (Ringkas)

| Langkah | Yang Terjadi |
|---------|-------------|
| 1 | Baca koordinat GPS & waktu dari EXIF foto |
| 2 | Kirim koordinat ke Nominatim → dapat nama lokasi & alamat |
| 3 | Fetch 9 tile peta dari CARTO (data OpenStreetMap) → stitch → crop di koordinat target |
| 4 | Render panel gelap: peta kiri + teks kanan (SVG) |
| 5 | Tempel panel ke bagian bawah foto → simpan ke folder output |

---

## Catatan

- **Rate limit Nominatim:** maksimal 1 request/detik, app otomatis jeda antar foto
- **Cache:** tile peta & hasil geocode di-cache, koordinat sama tidak di-fetch ulang
- **Output:** JPEG kualitas 92%, metadata EXIF asli dipertahankan
- **Atribusi:** output menyertakan `© OpenStreetMap contributors` sesuai lisensi ODbL

---

## Lisensi

ISC — [Very Shafrudin](mailto:very.shafrudin@gmail.com)
