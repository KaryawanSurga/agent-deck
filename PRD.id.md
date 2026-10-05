# PRD — Agent Deck (Bahasa Indonesia)

**Status:** v0.2.0 siap rilis
**Owner:** KaryawanSurga
**Update terakhir:** 2026-10-05

## 1. Ringkasan

Agent Deck adalah mission control lokal untuk pekerjaan agent yang berjalan lama. Alat ini menjalankan agent yang dikonfigurasi sebagai proses anak lewat transport pipe atau PTY, men-stream output-nya ke dashboard web live lewat Server-Sent Events, melaporkan status live (running, idle, exited, failed, stopped), mengirim notifikasi webhook saat run selesai, dan bisa menghentikan run. State tersimpan lokal; dependency runtime wajib nol.

## 2. Masalah

- Run agent yang panjang tidak terlihat sampai selesai atau gagal; kegagalan baru ketahuan terlambat.
- Job paralel berarti banyak terminal tanpa status bersama, tanpa riwayat, dan tanpa cara standar menghentikan proses yang lepas kendali.
- Dashboard agent hosted butuh akun, eksposur jaringan, atau platform.
- Process manager yang ada (pm2, systemd) tidak dirancang untuk tampilan berorientasi agent: kesegaran output, deteksi idle, log per run.

## 3. Target pengguna

- Developer yang menjalankan coding agent dalam mode print, test suite, dan job data.
- Pembuat agent yang butuh lapisan observabilitas lokal tanpa platform.
- Tim yang menstandarkan cara job agent dijalankan dan dipantau di workstation.

## 4. Tujuan (v0.2.0)

1. Mendefinisikan agent di config JSON sederhana dan menjalankannya dari CLI atau dashboard.
2. Men-stream stdout/stderr live ke browser tanpa dependency eksternal.
3. Melaporkan status jujur: running, idle (diam lebih lama dari window), exited, failed, stopped.
4. Menyimpan sesi dan log secara lokal; memulihkan sesi yang tertinggal dari proses sebelumnya.
5. Menyediakan paritas CLI: `init`, `list`, `run`, `logs`, `serve`.
6. Nol dependency runtime wajib dan bind ke loopback secara default.
7. Mendukung sesi PTY lewat paket opsional, dengan mode gagal yang jelas tanpa mengganggu agent pipe.
8. Mengirim payload webhook saat sesi mencapai status terminal.
9. Menyediakan command perawatan: `export` sesi beserta log-nya dan `prune` state lama.

## 5. Bukan tujuan

- Kontrol akses multi-user, akun, atau eksposur remote.
- Penjadwalan terdistribusi atau orkestrasi multi-mesin (roadmap).
- Menggantikan sistem CI atau orchestrator container.
- Instalasi sebagai service Windows.
- Retry atau jaminan pengiriman webhook di v0.2.0.

## 6. User story

- Sebagai developer, saya menjalankan agent dan melihat output-nya live di browser.
- Sebagai operator, saya ingin menghentikan agent yang lepas kendali dari tampilan yang sama.
- Sebagai developer, saya ingin tahu job gagal tanpa menunggu di terminal.
- Sebagai anggota tim, saya ingin melihat job mana yang running, idle, atau selesai di mesin ini.

## 7. Kebutuhan fungsional

| ID | Kebutuhan |
| --- | --- |
| FR1 | Config JSON mendefinisikan agent (command, args, cwd, env, description) dan window idle. |
| FR2 | `run <agent>` spawn proses, stream output ke terminal, dan mencerminkan hasil agent di exit code. |
| FR3 | `serve` menghosting dashboard dan API di loopback dengan port/host yang bisa diatur. |
| FR4 | Output live sampai ke dashboard lewat Server-Sent Events dengan event snapshot, session, dan output. |
| FR5 | Status: running, idle (output terakhir > idleAfterMs), exited (kode 0), failed (non-zero atau spawn error), stopped (di-kill atau dipulihkan). |
| FR6 | Sesi dan log per sesi tersimpan di `.agent-deck/`; riwayat dibatasi 100 sesi; tail dibatasi baris dan byte. |
| FR7 | Sesi yang tertinggal running dari proses sebelumnya ditandai stopped saat start. |
| FR8 | Stop mematikan pohon proses (taskkill di Windows, SIGTERM di lainnya) dan menandai sesi stopped. |
| FR9 | `list` dan `logs` memberi akses CLI ke agent, sesi, dan tail log, dengan `--json` untuk `list`. |
| FR10 | Dashboard menampilkan agent dengan tombol start, sesi dengan status dot, panel output live, dan tombol stop. |
| FR11 | `"pty": true` (config) atau `--pty` (CLI) menjalankan agent lewat pseudo-terminal saat paket opsional terpasang; jika tidak, sesi gagal dengan pesan yang actionable. |
| FR12 | `notifyUrl` menerima POST JSON berisi ringkasan sesi saat transisi exited, failed, dan stopped; kegagalan pengiriman dilaporkan tanpa memengaruhi sesi. |
| FR13 | `export <session-id>` mencetak record sesi dan log-nya sebagai JSON; `--out` menulis ke file. |
| FR14 | `prune [--days <n>]` menghapus sesi selesai beserta log-nya yang lebih lama dari window dan mempertahankan yang sedang berjalan. |
| FR15 | Sesi mencatat transport-nya, dan dashboard menandai sesi PTY. |

## 8. Kebutuhan non-fungsional

- Nol dependency runtime wajib; Node >= 20. Dukungan PTY adalah dependency opsional di balik satu modul.
- Hanya lokal secara default (`127.0.0.1`); tanpa telemetry.
- Format file deterministik: indeks sesi JSON ditulis atomik (file temp + rename).
- Error dikembalikan sebagai JSON dengan pesan actionable; dashboard tidak pernah membuat server crash.
- Pengiriman webhook fire-and-forget dengan timeout 5 detik; sesi tidak pernah menunggu.
- Test mencakup proses anak sungguhan di kedua transport, API, SSE, notifikasi, command perawatan, dan CLI.

## 9. Metrik sukses

- Diadopsi sebagai cara default memantau job agent di workstation.
- Issue/PR yang meminta sesi PTY, notifikasi, atau worktree (validasi roadmap).
- Install npm dan star GitHub naik dari minggu ke minggu.
- Disebut berpasangan dengan tool CLI agent.

## 10. Catatan teknis

- `node:http` melayani dashboard sekaligus SSE; tanpa lapisan WebSocket.
- Lapisan transport spawn mengekspos satu interface `AgentProcess`: `spawnPipe` (child_process, kill pohon proses) dan `spawnPty` (dynamic import opsional, dimuat saat dibutuhkan).
- `child_process.spawn` dengan stdio pipa; chunk output di-append ke file log per sesi dan disiarkan ke subscriber.
- Penulisan indeks sesi di-throttle saat streaming dan dipaksa saat perubahan status terminal.
- Kill memakai `taskkill /T /F` di Windows untuk menjangkau pohon proses gaya `npx`, SIGTERM di lainnya; sesi PTY di-kill lewat handle PTY.
- Notifikasi webhook lewat `notifyTerminal`, yang tidak pernah throw dan mengembalikan status pengiriman.
- `prune` menghapus file state dan log sambil mempertahankan sesi yang berjalan.
- Dashboard hanya memakai textContent, jadi output proses tidak pernah bisa menyuntik markup ke halaman.

## 11. Rencana rilis

- **v0.1.0** — config, run/list/logs/serve, dashboard, SSE, status, recovery (rilis 2026-10-03).
- **v0.2.0** — sesi PTY, notifikasi webhook, export, prune (rilis 2026-10-05).
- **v0.3.0** — worktree per sesi, task queue dengan gate, agent multi-mesin lewat SSH.

## 12. Pertanyaan terbuka

- Perlukah deteksi idle juga mempertimbangkan aktivitas CPU, bukan hanya kesegaran output?
- Perlukah `stop` diekspos lewat file kontrol lokal kecil supaya proses CLI mana pun bisa menghentikan sesi milik dashboard?
- Perlukah pengiriman webhook di-retry dengan backoff, dan perlukah payload signing?
- Perlukah dashboard bisa mengirim input ke sesi PTY, atau tetap read-only di v0.3?
