# Undesign Showcase

Satu proyek showcase untuk situs, API Agent, dan bundle WebAssembly Undesign. Halaman situs berbahasa Inggris untuk juri internasional; panduan ini berbahasa Indonesia. Client browser berada di `apps/undesign-web` pada repo Undesign dan memakai relay hanya jika feature opt-in diaktifkan.

## Perilaku demo Agent

- Pengunjung dapat mencoba demo tanpa login dan tanpa memasukkan API key. Browser mengirim prompt/percakapan serta konteks halaman aktif hanya ketika pengguna menjalankan aksi Agent.
- Relay menggunakan satu provider key server-side dari `META_API_KEY`, dan mengunci endpoint ke `https://api.meta.ai/v1/chat/completions` serta model **Muse Spark 1.3 Contributor** (`muse-spark-1.3`). Provider key tidak dikirim ke browser, request body, Supabase, log, atau source code.
- Batas relay ditetapkan di kode: **6 request per IP per menit**, **100 request global per hari UTC**, dan **maksimum 2.000 output token per request**. Setiap request hanya menghasilkan satu completion.
- Relay meneruskan request ke provider dan tidak menyimpan prompt, percakapan, snapshot dokumen, atau komentar. Supabase hanya menerima HMAC IP dan counter kuota agregat per-IP/global; tidak ada cloud-project/comment storage atau sharing.
- Sesi anonim bertanda tangan dan token CSRF melindungi endpoint same-origin. Keduanya bukan akun/login dan tidak membuat identitas per-user.
- Native builds tetap memakai konfigurasi provider/key milik pengguna. Perubahan key server-side ini hanya untuk relay web Showcase.

## Jalankan dan uji lokal

Gunakan Node.js 22 atau yang lebih baru. Dari direktori ini:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run preview
```

Buka `http://127.0.0.1:4173/` setelah build untuk memeriksa hasil produksi frontend. `npm test` memakai upstream, DNS, sesi, dan kuota tiruan lokal; tes tidak membuat panggilan provider nyata dan tidak memerlukan kredensial. Server Vite hanya menyajikan frontend, bukan fungsi API. Jangan menaruh key provider nyata dalam file yang terlacak Git.

## Konfigurasi server

Salin nama variabel dari `.env.example` ke pengaturan environment server yang terlindungi. Nilai contoh hanya placeholder. Jangan commit rahasia atau memberi prefix `VITE_` pada provider key.

| Variabel | Fungsi dan syarat |
| --- | --- |
| `PUBLIC_ORIGIN` | Satu origin kanonis HTTPS; origin permintaan harus sama persis. |
| `SESSION_SECRET` | Rahasia acak kuat minimal 32 byte untuk sesi anonim dan CSRF. |
| `IP_HASH_SECRET` | Rahasia acak minimal 32 byte yang berbeda dari `SESSION_SECRET`; hanya HMAC IP yang disimpan. |
| `META_API_KEY` | Provider key untuk relay. Simpan hanya di environment server; jangan expose ke browser, database, log, atau source code. |
| `SUPABASE_URL` | URL HTTPS proyek Supabase yang menyimpan counter kuota. |
| `SUPABASE_SECRET_KEY` | Secret API Key `sb_secret_...` untuk RPC kuota dari server. Simpan hanya di environment server. |

Kode menetapkan model dan semua batas di atas; tidak ada environment setting untuk menaikkan limit. Produksi gagal tertutup bila key provider, konfigurasi sesi, origin, atau penyimpanan kuota durable tidak tersedia.

Di Supabase, migrasi `supabase/migrations/0001_usage_counters.sql` membuat counter IP per menit dan global per hari serta RPC reservasi atomik. Jalankan migrasi tersebut pada proyek target jika belum pernah diterapkan. Tabel menolak akses publik lewat RLS; hanya fungsi server dengan Secret API Key mengakses RPC. Tidak diperlukan Supabase Auth atau tabel kuota per-user.

Relay memakai sesi `HttpOnly`, `SameSite=Strict`, CSRF, pemeriksaan origin persis, HMAC IP, validasi body, dan endpoint provider tetap. DNS hanya boleh menghasilkan alamat publik; koneksi HTTPS dipatok ke IP tervalidasi sambil memeriksa hostname TLS, redirect ditolak, dan waktu/ukuran request-response dibatasi. Error provider dan detail internal disanitasi. `GET /api/health` hanya mengungkap status kesiapan boolean.

## Pasang bundle WebAssembly Trunk

Build WebAssembly dari checkout Undesign. Feature `agent-relay` mati secara default; tanpa feature itu, pengaturan provider browser tetap dinonaktifkan. Aktifkan feature hanya untuk Showcase yang relay-nya dikonfigurasi:

```sh
cd /path/to/undesign/apps/undesign-web
trunk build --release --features agent-relay --public-url /app/
```

Konfigurasi Trunk repo menulis hasil ke `/path/to/undesign/dist/web/`. Dari root paket Showcase, pasang hasil build asli:

```sh
npm run install:wasm -- /path/to/undesign/dist/web
```

Installer menyalin aset hasil build ke `public/app/`. Jangan membuat sendiri `runtime.html` atau file Trunk tiruan. Setelah bundle terpasang, jalankan ulang `npm run build`. Jika build Trunk belum dilakukan, shell uji tetap diberi label dan bukan runtime Rust.

## Vercel

Paket ini dapat dijadikan proyek Vercel dengan **Root Directory = `showcase`**, Node.js 22, build command `npm run build`, dan output direktori `dist`. Fungsi Node berasal dari `api/`; `vercel.json` mengatur MIME `application/wasm`, cache aset ber-hash, SPA fallback, serta header keamanan/CSP. Untuk Production, atur `META_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SESSION_SECRET`, `IP_HASH_SECRET`, dan `PUBLIC_ORIGIN` di Project Settings > Environment Variables. Pastikan migrasi kuota pertama sudah diterapkan; tidak ada login pengunjung yang diperlukan.

Video demo opsional berada di `public/demo.mp4`. Jika file belum ada, halaman menampilkan keadaan kosong tanpa menggagalkan build.
