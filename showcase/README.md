# Undesign Showcase

Satu proyek showcase untuk situs, API Agent, dan bundle WebAssembly Undesign. Halaman situs berbahasa Inggris untuk juri internasional; panduan ini berbahasa Indonesia. Client browser berada di `apps/undesign-web` pada repo Undesign dan memakai relay hanya jika feature opt-in diaktifkan.

## Isi dan perilaku

- `/` adalah halaman showcase responsif dengan demo video opsional (`public/demo.mp4`), fitur Design/Motion/Agent, panduan juri, privasi, dan kredit FigCraft.
- `/app/` adalah shell aplikasi yang memuat runtime WebAssembly jika bundle Trunk yang asli telah dipasang. Tanpa bundle, halaman menampilkan shell uji statis yang diberi label jelas—bukan aplikasi Rust. Di layar kecil, halaman menyarankan penggunaan desktop.
- `POST /api/session` menerbitkan atau memperbarui sesi browser anonim bertanda tangan tanpa database sesi, identitas akun, atau penyimpanan browser. Cookie sesi bersifat `HttpOnly` dan `SameSite=Strict`; token CSRF berumur pendek dikembalikan di respons.
- `POST /api/agent` hanya menerima permintaan dengan sesi, token CSRF, origin yang persis cocok, dan `X-User-Key` BYO nonkosong. Tidak ada kunci provider bersama atau default di server. Semua pemanggilan, termasuk BYO, melewati kuota.
- Relay hanya mendukung Meta pada endpoint tetap `https://api.meta.ai/v1/chat/completions`. Model dikirim sesuai ID yang dipilih pengguna. Payload Chat Completions mendukung riwayat pesan `system`/`user`/`assistant`/`tool`, `tool_calls`, `tools`, `tool_choice`, serta `stream: false`; `response_format` bersifat opsional.
- `GET /api/health` hanya mengembalikan boolean kesiapan, tanpa nilai rahasia, model, atau key.
- Konten dan tautan situs dipusatkan di `showcase/content.json`. Tes berada di `tests/` dan tidak dimasukkan ke bundle produksi.

## Jalankan dan uji lokal

Gunakan Node.js 22 atau yang lebih baru. Dari direktori ini:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run preview
```

Buka `http://127.0.0.1:4173/` setelah build untuk memeriksa hasil produksi frontend. `npm test` hanya menggunakan upstream, DNS, sesi, dan kuota tiruan lokal; tes tidak membuat panggilan jaringan ke Meta, Supabase, atau Vercel dan tidak memerlukan kredensial. Server Vite hanya menyajikan frontend, bukan fungsi API. Pengembangan lokal API dapat memakai server fungsi lokal yang sesuai, tetapi konfigurasi loopback lokal tidak boleh dipakai untuk produksi.

**Relay ini belum dideploy. Tidak ada deployment, kredensial provider sungguhan, atau panggilan jaringan eksternal yang digunakan dalam tugas pengembangan ini.** Contoh environment hanya berisi placeholder.

## Keamanan dan konfigurasi server

Salin nama variabel dari `.env.example` ke pengaturan environment server yang terlindungi. Semua nilainya adalah placeholder. Jangan commit rahasia, memasukkan key ke frontend atau `content.json`, atau menyediakan provider key di sisi server.

Produksi harus menggunakan HTTPS dan mengisi semua hal berikut; bila tidak, endpoint sesi/agent gagal tertutup:

| Variabel | Fungsi dan syarat |
| --- | --- |
| `PUBLIC_ORIGIN` | Satu origin kanonis HTTPS, misalnya `https://showcase.example`; origin permintaan harus sama persis. Tidak ada allow-list CORS atau refleksi origin. |
| `SESSION_SECRET` | Rahasia acak kuat minimal 32 byte untuk tanda tangan sesi dan CSRF. |
| `IP_HASH_SECRET` | Rahasia acak minimal 32 byte yang **berbeda** dari `SESSION_SECRET`; hanya HMAC IP yang dipakai pada kuota, bukan IP mentah. |
| `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` | Koneksi HTTPS ke proyek Supabase untuk kuota persisten. Kredensial service-role hanya berada di server. Kuota memori lokal tidak pernah menjadi fallback produksi. |
| `RATE_LIMIT_PER_MIN` | Batas permintaan per IP-hash per menit; default 6. Berlaku sama untuk setiap key BYO. |
| `DAILY_BUDGET_REQUESTS` | Batas global per hari UTC; default 100 dan berlaku untuk semua panggilan. |
| `MAX_COMPLETION_TOKENS` | Batas atas token keluaran jika payload memilikinya; default 2000. Model tidak ditetapkan oleh server. |

Cookie sesi produksi memakai atribut `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, dan masa berlaku terbatas. CSRF dikaitkan secara kriptografis dengan sesi dan memiliki masa berlaku lebih pendek. Klien harus mengirim token respons sesi pada header `X-CSRF-Token` di setiap panggilan agent. Cookie bukan identitas akun dan tidak disimpan dalam local/session storage.

Agent selalu memerlukan `X-User-Key` yang dikirim untuk permintaan saat itu. Key tidak dicatat atau dikembalikan dan tidak pernah jatuh kembali ke kredensial server. Pastikan log reverse proxy, APM, atau observability Anda juga tidak merekam header sensitif. Upstream dikunci ke host/path Meta, DNS harus menghasilkan alamat publik saja, koneksi HTTPS dipatok ke IP yang divalidasi sambil mempertahankan verifikasi sertifikat untuk nama host, redirect ditolak, serta waktu dan ukuran request/response dibatasi. Error provider dan detail internal disanitasi.

Jalankan `supabase/migrations/0001_usage_counters.sql` pada proyek pilihan sebelum produksi. Tabel menyimpan hash IP ber-HMAC untuk bucket menit dan counter harian global; IP mentah tidak disimpan. Fungsi RPC mereservasi kuota secara atomik. RLS aktif dan akses publik ditolak. Validasi lokal boleh memakai store memori, tetapi konfigurasi produksi wajib memakai store persisten yang tersedia; jika kuota tak dapat direservasi, permintaan gagal tertutup.

Health endpoint hanya mengungkap status kesiapan boolean. Status `ok: false` berarti konfigurasi belum memenuhi persyaratan; health tidak mengungkap rahasia atau nilai model/key.

## Pasang bundle WebAssembly Trunk

Build WebAssembly dari checkout Undesign. Feature `agent-relay` mati secara default; tanpa feature itu, pengaturan provider browser tetap dinonaktifkan. Aktifkan feature hanya untuk Showcase yang API relay-nya telah dikonfigurasi dan memenuhi semua syarat produksi di atas. Di lingkungan yang memiliki Rust, target `wasm32-unknown-unknown`, dan Trunk:

```sh
cd /path/to/undesign/apps/undesign-web
trunk build --release --features agent-relay --public-url /app/
```

Konfigurasi Trunk repo menulis hasil ke `/path/to/undesign/dist/web/`. Dari root paket showcase ini, pasang hasil build asli dengan installer agar entrypoint `/app/runtime.html` dan penanda runtime dibuat dengan benar:

```sh
npm run install:wasm -- /path/to/undesign/dist/web
```

Installer menyalin aset hasil build ke `public/app/`. Jangan membuat sendiri `runtime.html` atau file Trunk tiruan. Setelah memasang bundle, jalankan ulang `npm run build`. Jika build Trunk gagal atau belum dilakukan, shell uji tetap diberi label dan bukan runtime Rust.

## Vercel

Paket ini dapat dijadikan proyek Vercel dengan **Root Directory = `showcase`**, Node.js 22, build command `npm run build`, dan output direktori `dist`. Fungsi Node berasal dari `api/`; `vercel.json` mengatur MIME `application/wasm`, cache aset ber-hash, SPA fallback, serta header keamanan/CSP. Jika nantinya dideploy, isi seluruh konfigurasi produksi di atas terlebih dahulu dan jangan gunakan fallback kuota memori. Paket/relay ini **belum dideploy** dan perilaku Vercel pada deployment nyata belum diverifikasi.

Video demo bersifat opsional: letakkan file yang disediakan pemilik sebagai `public/demo.mp4`. Jika file belum ada, halaman menampilkan keadaan kosong yang dirancang tanpa menggagalkan build.

## Batasan yang belum diverifikasi

Feature browser `agent-relay` bersifat opt-in dan hanya mendukung endpoint Meta tetap; model dan API key harus diberikan pengguna. Native builds tetap memakai endpoint OpenAI-compatible yang pengguna konfigurasi sendiri. Client browser meminta sesi anonim same-origin dan baru mengirim prompt, konteks halaman aktif, serta key BYO saat pengguna menekan Send. Tidak ada koneksi provider pada Connect, dan key tidak disimpan di browser storage.

Kode/tes lokal memverifikasi integrasi client/proxy dan batas keamanan, tetapi relay ini belum dideploy. Konfigurasi environment produksi, migrasi pada proyek Supabase nyata, konektivitas endpoint Meta, kuota akun provider, serta perilaku Vercel setelah deployment belum diverifikasi. Tidak ada layanan eksternal atau kredensial sungguhan yang dipakai dalam pengujian lokal.
