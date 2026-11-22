# libav.js «filmav» — звук и картинка фильмов в браузере (FFmpeg в WebAssembly)

Свой вариант [libav.js](https://github.com/Yahweasel/libav.js) (Yahweasel): демуксеры, **аудио**- и **видео**-декодеры, без кодировщиков и без фильтров. Нужен, чтобы Chrome мог играть то, что он сам не декодирует: звук AC-3, E-AC-3 (в том числе Atmos — декодируется 5.1/7.1-основа), DTS (в том числе DTS-HD — ядро и расширение без потерь, что умеет FFmpeg), TrueHD/MLP — `src/filmaudio.js` (+ воркер `src/filmaudio-worker.js`); и картинку старых видеофайлов — AVI с Xvid/DivX/MSMPEG4, MJPEG, MPEG-1/2 (DVD VOB, `.mpg`), DV, H.263, а также H.264 в контейнерах, которые Chrome не открывает (AVI, MPEG-TS/PS) — `src/filmvideo.js` (+ воркер `src/filmvideo-worker.js`). Прежний вариант «filmaudio» (только звук, 2,2 МБ) — подмножество этого: звук декодируется бит-в-бит так же (проверено на AC-3, E-AC-3, DTS, TrueHD, FLAC, AAC, ALAC, MP3, Opus, PCM).

**Лицензия — LGPL-2.1-or-later** (FFmpeg: `LICENSE-LGPL-2.1.txt`; обёртка libav.js — ISC-подобная, текст в заголовках файлов). Сборка без GPL-частей и без «nonfree»: в `config.h` `CONFIG_GPL 0`, `CONFIG_NONFREE 0`, `CONFIG_VERSION3 0`. С проектом под AGPL-3.0-or-later совместима. Заголовки с лицензиями внутри `.mjs` не удалять. Исходный код — FFmpeg 9.0.2 (https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz) и libav.js 6.11.9 (npm `libav.js@6.11.9`, внутри — `sources/`) плюс наш небольшой патч `filmav.patch` (только доступ к полям структур FFmpeg из JS).

## Файлы

| файл | что | размер |
|---|---|---|
| `libav-6.11.9.0.2-filmav.mjs` | загрузчик (ES-модуль), его импортируют оба воркера | 29 КБ |
| `libav-6.11.9.0.2-filmav.wasm.mjs` | склейка Emscripten | 253 КБ |
| `libav-6.11.9.0.2-filmav.wasm.wasm` | сам FFmpeg | 3 836 КБ |
| итого | | 4,1 МБ (по gzip ≈ 1,5 МБ; было 2,2 МБ / 0,93 МБ) |
| `filmav.patch` | наш патч к исходникам libav.js (полный, к чистому пакету 6.11.9) | |
| `config-fragments.json`, `ffmpeg-config.txt` | набор «фрагментов» и итоговые флаги `./configure` FFmpeg | |

Все три лежат рядом: загрузчик находит остальные по своему адресу. Сервер должен отдавать `.wasm` как `application/wasm` (иначе браузер скомпилирует медленнее, но заработает).

## Что внутри

- Контейнеры (только чтение): Matroska/WebM (`matroska`), MP4/MOV (`mov`), AVI, MPEG-TS/M2TS (`mpegts`), MPEG-PS/VOB (`mpegps`), Ogg, FLAC, MP3, WAV, DV (`dv`), «голые» потоки AC-3, E-AC-3, DTS, TrueHD, AAC, MPEG-1/2 видео (`mpegvideo`), MPEG-4 видео (`m4v`), H.264 (`h264`). Последние три нужны не ради самих файлов, а потому что `mpegps` определяет кодек видео в MPEG-PS по «пробе» этих демуксеров (без них VOB-видео принималось за MP3).
- Видео-декодеры (программные): `mpeg4` (Xvid, DivX 4/5, MPEG-4 ASP; пакеты с «упакованными» B-кадрами распаковывает bsf `mpeg4_unpack_bframes`), `msmpeg4v1`, `msmpeg4v2`, `msmpeg4v3` (DivX ;-) 3, MP43), `wmv1`, `wmv2`, `h263`, `h263p`, `mjpeg`, `mpeg1video`, `mpeg2video`, `dvvideo`, `h264` (в том числе 10 бит, 4:2:2/4:4:4), `cinepak`, `msvideo1`, `rawvideo`.
- Аудио-декодеры: `ac3`, `eac3`, `dca` (DTS), `truehd`, `mlp`, `flac`, `aac`, `aac_latm`, `mp3float`, `mp2float`, `mp1float`, `opus` (встроенный в FFmpeg, не libopus), `vorbis`, `alac`, `adpcm_ms`, `adpcm_ima_wav` (старые AVI), `pcm_s8/u8/s16le/s16be/s24le/s24be/s32le/s32be/f32le/f32be/f64le/f64be/alaw/mulaw/dvd/bluray`.
- Разборщики (parsers): `ac3`, `dca`, `mlp`, `flac`, `aac`, `aac_latm`, `mpegaudio`, `opus`, `vorbis`, `mpeg4video`, `mpegvideo`, `h264`, `mjpeg`, `h263`. Парсер `dvd_nav` не нужен: служебные пакеты DVD (private stream 2) воркеры отбрасывают как «не видео».
- Библиотеки: libavformat, libavcodec, libavutil, libswresample (в нашем коде её не используем: микс в стерео и пересчёт частоты — в JS воркера звука), **libswscale** (воркер картинки переводит кадры не в 8-битном планарном YUV — 10 бит, RGB, серые, палитру — в 8-битный YUV; для остальных не вызывается).
- Не включено: HEVC, VP8/VP9/AV1 (их Chrome играет сам), VC-1/WMV3, WMA/ASF, FLV, RealVideo, Indeo, Theora, зашифрованное; zlib (в Matroska сжатые zlib-дорожки не читаются; сжатие заголовков — читается), сырой MLP-файл (внутри Matroska/M2TS MLP/TrueHD читается).
- Наш патч (`filmav.patch`) добавляет к `funcs.json`/`b-*.c` libav.js только чтение/запись полей: у `AVStream` — `disposition`, `avg_frame_rate`, `r_frame_rate`, `sample_aspect_ratio`; у `AVCodecParameters` — `channel_layout`/`channel_layouthi`, `field_order`, `video_delay`, `sample_aspect_ratio`; у `AVFrame` — `color_range`, `colorspace`; у `AVCodecContext` — `skip_frame`, `skip_idct`, `skip_loop_filter`, `flags2`.

## Как собрано (повторить)

Версии: libav.js 6.11.9 (FFmpeg 9.0.2, суффикс сборки `6.11.9.0.2`), Emscripten 7.0.1 (`ac0578743420bcbe9a4f77d0b6599c25f8d43702`), собрано 2026-11-22 на macOS arm64 (чистая сборка с нуля ≈ 2–3 минуты на M-серии). Флаги оптимизации и ASYNCIFY — как в `Makefile` libav.js (`-Oz`, `-s ASYNCIFY`, `ALLOW_MEMORY_GROWTH`), без потоков и без SIMD. Скорость при `-Oz` с запасом: Xvid 704×400 — ≈ 300–400 кадров/с (в воркере внутри Chrome), H.264 1080p — ≈ 70, 4K — ≈ 28 кадров/с (см. `docs/filmvideo-test/INTEGRATION.md`), поэтому `-O2/-O3` не понадобились.

```sh
# 1. Emscripten (официальный emsdk)
git clone https://github.com/emscripten-core/emsdk.git && cd emsdk
./emsdk install 7.0.1 && ./emsdk activate 7.0.1 && source ./emsdk_env.sh

# 2. Исходники libav.js 6.11.9 (git-архив лежит в npm-пакете)
npm pack libav.js@6.11.9 && tar xzf libav.js-6.11.9.tgz
mkdir src && tar xJf package/sources/libav.js.tar.xz -C src && cd src

# 3. Наш патч (доступ к полям структур FFmpeg из JS)
patch -p1 < /путь/к/vendor/libav/filmav.patch

# 4. Вариант: набор «фрагментов» конфигурации — config-fragments.json (рядом с этим файлом)
(cd configs && ./mkconfig.js filmav "$(cat /путь/к/vendor/libav/config-fragments.json)")
#    итоговые флаги ./configure FFmpeg для этого варианта — ffmpeg-config.txt (рядом);
#    общие флаги (--disable-everything, --disable-programs, --disable-network, ...) — mk/ffmpeg.mk libav.js

# 5. Сборка (сам скачает ffmpeg-9.0.2.tar.xz с ffmpeg.org и emfiberthreads; нужны make, m4, node)
npm install
make -j4 dist/libav-6.11.9.0.2-filmav.mjs dist/libav-6.11.9.0.2-filmav.wasm.mjs

# 6. Результат — dist/libav-6.11.9.0.2-filmav.{mjs,wasm.mjs,wasm.wasm} -> vendor/libav/
```

Чтобы добавить формат или кодек — дописать фрагмент (`demuxer-…`, `decoder-…`, `parser-…`, `bsf-…`) в `config-fragments.json` и повторить шаги 4–5 (пересборка с перенастройкой FFmpeg ≈ 2 минуты; если менялись только поля структур в патче — ≈ 10 секунд). Имена — как у FFmpeg (`ffmpeg -decoders`, `-demuxers`).
