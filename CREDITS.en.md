# Credits and licences

The code of Exedra and everything drawn in it programmatically (the hall, the balustrade, the vault with its coffers and little domes, the reading desks, the books on the shelves, the bound volumes) — Anastasiia Chestnykh. The code is licensed under AGPL-3.0-or-later; the author’s own texts and design under CC BY-SA 4.0 (details in README and LICENSE).

Other people’s materials — each under its own licence. What was changed is noted alongside.

## 3D models (Sketchfab, CC BY 4.0)

| What | Author | Source | Changes |
|---|---|---|---|
| Victorian typewriter | Tijerín Art Studio | https://sketchfab.com/3d-models/victorian-typewriter-cbfcb0e1d8c74f02bde4cfa7b92115f9 | the keys were separated and can be pressed, the carriage moves, type bars and a sheet were added |
| vintage desk lamp | Noah (Noahouou) | https://sketchfab.com/3d-models/vintage-desk-lamp-b8e13a49528e4231a0512bb5f18f07e5 | the shade glass glows from within, the chain can be pulled and swings; the same lamp is on the tables of the hall, with simplified copies in the distance (`bankers-lamp-mid.glb`, `bankers-lamp-far.glb`) |
| Antique Desk | Matthew Collings | https://sketchfab.com/3d-models/antique-desk-c491f647da5947978ba8113951ee2efc | the drawers of the pedestals were made to slide out (copies of the top drawers) |
| Antique wooden bookcase — Game model | Lorenzo Drago | https://sketchfab.com/3d-models/antique-wooden-bookcase-game-model-75aa9519195647d99cf1e2d4863dbe87 | multiplied along the walls, the painted rows of books replaced with individual volumes |
| Потолочная розетка ДР-109 D452mm (ceiling rosette) | Dikart (dikart.ru) | https://sketchfab.com/3d-models/109-d452mm-3a04e09cc27d4de9941a4eca353c1daf | simplified to 1.4k triangles, gilded; in the coffers of the vault |
| ДС-254 252x244х80mm (keystone) | Dikart (dikart.ru) | https://sketchfab.com/3d-models/254-252x24480mm-be89e3659b2c4ecdb04e8fbc182df054 | simplified to 3k triangles; at the tops of the windows |
| Kapitell 19th century | gussbronze | https://sketchfab.com/3d-models/kapitell-19th-century-3ff25dd3b0ff405c9ca1e4ac02f297ad | simplified to 3k triangles, fitted to the width and depth of the pilaster, repainted to look like lime plaster |
| Порезка ДП-114 46х20mm (ов) (egg-and-dart) | Dikart (dikart.ru) | https://sketchfab.com/3d-models/114-4620mm-7239336439f845f0bea82ca207dc844e | simplified to 500 triangles, repeated as a band under the vault |
| Средник ДС-223 467x90х31mm (hanging swags) | Dikart (dikart.ru) | https://sketchfab.com/3d-models/223-467x9031mm-0735126ee42f413b85235c35f3e79544 | simplified to 5k triangles; by the cartouche in the far end |
| Фриз ДФ-77 287х46mm (tulips) | Dikart (dikart.ru) | https://sketchfab.com/3d-models/77-28746mm-3cf5dcf1eb4f46b682023fe19eeb3c62 | simplified to 6k triangles, mirrored on the left; by the cartouche in the far end |
| Средник ДС-260 1181x289х67mm (arched garland) | Dikart (dikart.ru) | https://sketchfab.com/3d-models/260-1181x28967mm-94dde33f099e4a428cd6502c71179c42 | simplified to 8k triangles; above the painting in the near end |
| Reloj Antiguo (round wall clock) | Crea (crea.cr) | https://sketchfab.com/3d-models/2476e040e03e485190008cbe3838c43a | empty nodes and light sources removed, textures as JPEG, the glass is a plain transparent material instead of a refracting one; the hands, on their own axis, show the hall’s time; it hangs on the back wall of the gallery |
| Owl of Athena (scan) | Danzer | https://sketchfab.com/3d-models/owl-of-athena-f3aabd68e95b473d9375d830e6f04dce | simplified to 31k triangles, the material made opaque and non-emissive, textures as JPEG; stands on the catalogue cabinet — a choice instead of the boar |
| Battiporta – Musei Vaticani (door knocker — a lion’s head with a ring, scan) | Fernando Closs (fcloss) | https://sketchfab.com/3d-models/0bf3ecacd69740e197803bd53302d1d5 | cut down to the head with its mane and the ring (the door surface around it removed), the back closed, simplified to 17k triangles, 1024 px textures, relief baked from the original; on the door it is one and a half times larger than the real thing, one on each leaf (`tools/models/knocker.py`) |
| Victorian Wall Lamp (sconces on the pilasters of the back wall) | Javier Carceller | https://sketchfab.com/3d-models/victorian-wall-lamp-027b8a1418c14f6495d284934e85e483 | textures reduced to 1024 px and saved as JPEG; scaled down to 32 cm, the glass glows warm by the model’s emission map |
| Wood Stand Book Reader (book stand) | Francesco Coldesina | https://sketchfab.com/3d-models/wood-stand-book-reader-2abc1d53da3a45b387f32efbad1ff045 | split into the base, the frame, the strut and the toothed bar with the hinge axes (the tilt follows the notches of the bar); the colour of the scan was darkened with levels to match the hall’s chocolate and rosewood, the metalness of the wood removed, the relief weakened, the hinges are brass (`tools/models/stand_build.py`, `assets/models/bookstand/notes.md`); the hall uses the “chocolate” version (`src/stand.js`), the “rosewood” version is not used yet |

CC BY 4.0 licence: https://creativecommons.org/licenses/by/4.0/

## Paperweights

- Mouse: “Bronze mouse sculpture (1) – LdM”, Emm (edemaistre), CC BY 4.0 — https://sketchfab.com/3d-models/bronze-mouse-sculpture-1-ldm-117e0039568c4a1cbca64ee2fa56eb5a. Simplified to 16k triangles, colour and relief baked; the blue-grey texture of the scan was desaturated and toned to bronze.
- Terrier: “brass paperweight – ww2 blitz rescue”, oxlade-3d, CC BY 4.0 — https://sketchfab.com/3d-models/brass-paperweight-ww2-blitz-rescue-db828b91503a40f9a1f7f67ab7849bdd. Simplified to 16k triangles.
- Donkey: “Medieval Gilded Donkey Figurine”, The Hunt Museum, CC0 — https://sketchfab.com/3d-models/medieval-gilded-donkey-figurine-ce17a1e1356e4ca38f769e54bf329450. The vertex colour of the scan was baked into a texture, 23.5k triangles.
- Malachite of the slab: the photograph “Malachite Veneer Details”, Kalamansi123, CC0 — https://commons.wikimedia.org/wiki/File:Malachite_Veneer_Details.jpg (reduced to 1024 pixels wide).

The models were taken from the open Objaverse mirror (allenai/objaverse on Hugging Face).

## 3D models (Poly Haven, CC0)

| What | Author | Source | Changes |
|---|---|---|---|
| Green Chair 01 (the chairs in the hall) | Kirill Sannikov | https://polyhaven.com/a/GreenChair_01 | 1k textures; placed by the reading desks, the upholstery recoloured in different tones; the armchair was turned into a chair: the armrests removed, their traces in the textures painted over |
| Chandelier 03 (chandeliers) | Kirill Sannikov | https://polyhaven.com/a/Chandelier_03 | 1k textures; the crystal is a plain transparent material, the candles glow |
| Fancy Picture Frame 01 (gilded frame) | Rob Tuytel, Rico Cilliers | https://polyhaven.com/a/fancy_picture_frame_01 | 1k textures; the field holds Hofmann’s “Idyll” |
| Ornate Mirror 01 (arched frame) | James Ray Cock | https://polyhaven.com/a/ornate_mirror_01 | 1k textures; an arch-shaped painting over the mirror |

## 3D scans of museum objects (Muzea Małopolski, CC0)

| What | Where kept | Source | Changes |
|---|---|---|---|
| Terrestrial globe by Johann Gabriel Doppelmayr, Nuremberg, 1728 | Jagiellonian University Museum, Collegium Maius (inv. 4119) | https://sketchfab.com/3d-models/21f7d2b8d4c743c4a15fe7103460c186, https://muzea.malopolska.pl/en/objects-list/2727 | simplified to 38k triangles, textures as JPEG; enlarged to a metre high, stands by the back wall of the gallery |
| Celestial globe by Doppelmayr, Nuremberg, after 1744 | same (inv. 4120) | https://sketchfab.com/3d-models/341fa8a777e94883841409438756f747, https://muzea.malopolska.pl/en/objects-list/2725 | simplified to 45k triangles, textures as JPEG; enlarged to the size of the terrestrial one — a pair of the same height |
| Raven (Corvus corax) on a branch, scan of a taxidermy specimen | Tomek Nature Museum, Ciężkowice (Muzea Małopolski) | https://sketchfab.com/3d-models/common-raven-ec9c0ac738fd4495af334ea2092e8d89 | a 384k-triangle mesh turned into a 40k one, colour and relief baked into 2048 px textures; the plumage darkened; stands on a carved shelf above the left catalogue cabinet, next to the barometer |
| “Boar” — a plaster cast of an ancient figure (the Florentine “Porcellino”) | Muzea Małopolski (Virtual Museums of Małopolska) | https://sketchfab.com/3d-models/wild-boar-a-plaster-cast-of-an-antique-figure-34a9f999ce2f4e47a13b05b65473ad23 | simplified to 44k triangles, the material changed from “gloss — specularity” to an ordinary matte one with the same texture, textures as JPEG; scaled down to 72 cm in length, stands on the catalogue cabinet |

## The corner under the balcony

Licences as on the source pages on the day of the search (2026-11-21). Details of the processing — `assets/models/lounge/notes.md`, scripts — `tools/models/lounge/`.

| What | Author | Licence | Source | Changes |
|---|---|---|---|---|
| Big Leather Chair (Outdated) (club armchairs) | Ashe | CC BY 4.0 | https://sketchfab.com/3d-models/big-leather-chair-outdated-7c8b8b8c7e4c494fa908eac4ae725092 | turned to face +z, scale 0.78, 1024 px textures, the leather made more matte and darker |
| Old Victorian Leather Sofa (sofa) | Oleksandr Tserkovniy | CC BY 4.0 | https://sketchfab.com/3d-models/old-victorian-leather-sofa-beaff7cdb8504373a22f3bbd6b2dd07d | from centimetres to metres (length 2.1 m), 1024 px textures, the leather more matte |
| Gothic Coffee Table (coffee table) | Ulan Cabanilla | CC0 1.0 | https://polyhaven.com/a/gothic_coffee_table | 1k textures instead of 2k, simplified to 14k triangles, a single file |
| Round Wooden Table 02 (side table) | Ulan Cabanilla | CC0 1.0 | https://polyhaven.com/a/round_wooden_table_02 | 1k textures, a single file |
| Fine Persian Heriz Carpet (rug) | mfb64 | CC BY 4.0 | https://sketchfab.com/3d-models/fine-persian-heriz-carpet-e198f1099ac34274ae2c867226adde79 | 628k triangles replaced with a flat sheet of 689; the 1024 px photograph of the rug sharpened, the normal relief and the fringe of strips with a cut-out texture — made anew |
| 1920s Standing Floor Lamps Type A (two floor lamps, variants 3 and 5 of 5) | Mad_Lobster_Workshop | CC BY 4.0 | https://sketchfab.com/3d-models/1920s-standing-floor-lamps-type-a-ca1cf1c435ec4012b9b6d5128333ad83 | each variant in its own file, scale 0.856 (height 1.62 m), 512 px textures |
| Pathé-Baby 9.5mm film projector (projector) | timvanderheijden | CC BY 4.0 | https://sketchfab.com/3d-models/pathe-baby-95mm-film-projector-f3835e19358c48e2b38e582c336a1bb3 | from millimetres to metres (22 cm), simplified to 20k triangles, 2048 px textures |
| Wooden chess (chess) | igi (igor.cvitko) | CC BY 4.0 | https://sketchfab.com/3d-models/wooden-chess-e359783c98394128956e25c6e1c9b39c | from centimetres to metres (board 43 cm), 1024 px textures, a single mesh |
| [FREE] Dyspis Lutescens - Potted Palm (palm) | AllQuad | CC BY 4.0 (Creative Commons Attribution) | https://sketchfab.com/3d-models/free-dyspis-lutescens-potted-palm-92f75abd656049608248cf76a8c88136 | the black pot removed; the plant simplified to 11.5k triangles, a second, smaller one added, rotated; leaves with alpha cut-out, relief and roughness maps dropped, colour muted |
| Ornate planter (jardinière) | matousekfoto | CC BY 4.0 | https://sketchfab.com/3d-models/ornate-planter-09f6f7f5adc94702b2b272497ebf736b | scale 0.50 m high; scan 125k → 5k triangles, colour and normals baked from the full mesh into 1024 px textures; the palm and the jardinière are a single file, `palm.glb` |
| Antique Copper Boiling Tubs (a copper tub as a planter, `palm-b.glb`) | Mad_Lobster_Workshop | CC BY 4.0 (Sketchfab: “CC Attribution”) | https://sketchfab.com/3d-models/antique-copper-boiling-tubs-246030bc6b204705a002723a063c27c3 | from a set of six variants, “Brass Refurbished” without the lid was taken; scale — body height 0.46 m (width 0.86 m, 1.0 m with the handles); 13.5k → 5.8k triangles, 1024 px textures (JPEG); the soil inside is a mesh of our own |
| Hidden Town in 3D Green Glazed Flower Pot (a green pot as a planter, `palm-c.glb`) | Emily Rink | CC BY 4.0 (Sketchfab: “CC Attribution”) | https://sketchfab.com/3d-models/hidden-town-in-3d-green-glazed-flower-pot-f274e26e62b34540a0a394c815fc2ea5 | the pot with its saucer as in the scan, scale — height 0.50 m; 24.8k → 6.4k triangles, 1024 px textures (JPEG); the soil inside is a mesh of our own |
| “Versailles” box (planter, `palm-a.glb`) | assembled by us from bars (`tools/models/lounge/palm_calm_build.py`) | — | — | the texture is the same as the hall’s wood: Poly Haven, Smoked Walnut Veneer (Jenelle van Heerden), CC0 (`assets/textures/walnut-*.jpg`); the colour is a “dark rosewood” multiplier |
| Pathé-Baby, il cinematografo in ogni famiglia (poster, 1928; `assets/textures/poster-pathe-baby.jpg`) | Achille Mauzan (work); photo by Sailko | public domain (Commons: PD-Art / PD-old-auto, author † 1952) | https://commons.wikimedia.org/wiki/File:Achille_luciano_mauzan_per_mauzan_morzenti,_path%C3%A8-baby_il_cinematografo_in_ogni_famiglia,_milano_1928.jpg | cropped to the edge of the sheet and the perspective straightened, 1400 × 1982; not retouched |
| Teatro Opera, 3.ª Exposición de Radio, Fonografía y Cinematografía (poster, Buenos Aires, 1930; `assets/textures/poster-mauzan-opera-1930.jpg`) | Achille Mauzan (work); scan by BnF / Gallica btv1b9016199x | public domain (author † 1952: in Argentina life + 70 years; in the USA published in 1930; on Commons CC0) | https://commons.wikimedia.org/wiki/File:Teatro_Opera_16_al_25_de_mayo,_3a_exposicion_de_Radio,_fonografias_y_cinematografia_affiche,_Achille_Mauzan.jpg | cropped to the edge of the sheet (without the photographic background and the colour scale), reduced to 2048 px; the drawing untouched |
| «Истерзанныя души» (“Tormented Souls”, film poster, D. I. Kharitonov, Moscow, 1917; `assets/textures/poster-kalmanson-1917.jpg`) | Mikhail Kalmanson (work, † c. 1924) | public domain (Russia: life + 70 years; USA: published before 1931; Commons: PD-old-95-expired) | https://commons.wikimedia.org/wiki/File:1917._Кальмансон._Плакат_«Истерзанные_души».jpg | cropped to the edge of the sheet (without the photographic background), reduced to 2048 px; the drawing untouched |
| Pathé 9.5mm film reels (a brass lid “PATHÉ 9m/m5” on a stand and a lying box with a reel, `reels.glb`) | timvanderheijden | CC BY 4.0 (Sketchfab: “CC Attribution”) | https://sketchfab.com/3d-models/pathe-95mm-film-reels-a939c4c9f14a4f29800279f9417c725d | two objects taken from a photogrammetry of a still life on black cloth, the cloth and the other objects removed, the mesh simplified to 21.6k triangles, normals recomputed, texture 4096 → 1024 px, the material changed from “unlit” to ordinary (metalness 0.25, roughness 0.6), the objects moved into one group, view multiplier ×1.6 (as for the projector) |

## Sounds (Wikimedia Commons)

| What | Author | Licence | Changes |
|---|---|---|---|
| Smith-Corona Prestige Auto 12 typing (key strikes) | lonemonk | CC BY 3.0 | cut into separate strikes |
| WWS Typewriter (carriage return) | Work With Sounds | CC BY 4.0 | the carriage return cut out |
| typewriter-ding-near-mono (bell) | _stubb | CC0 | trimmed |
| Wooden desk drawer (drawer) | hugh | public domain | the pulling out and pushing in cut out |
| Turning a page (page) | planish | public domain | trimmed |
| Clickick switch (lamp switch) | stephan | public domain | trimmed |
| WWS Super8MovieProjector8211Projection (projector clatter, Sankyo Sound 502) | Work With Sounds / La Fonderie | CC BY 4.0 | a 10 s section cut out, the seam joined with a crossfade, mono, loudness levelled (`assets/sounds/projector-loop.ogg`); https://commons.wikimedia.org/wiki/File:WWS_Super8MovieProjector8211Projection.ogg |

## Films (Wikimedia Commons)

Films of the selection with a free licence that requires crediting the author (the rest are public domain or CC0):

| What | Author | Licence | Page |
|---|---|---|---|
| Amalia (1914), the first feature-length film of Argentina — in the selection as “Amalia” | Museo del Cine Pablo Ducrós Hicken (digitisation, the “Nitrato argentino” project) | CC BY 3.0 | https://commons.wikimedia.org/wiki/File:Nitrato_argentino_-_Amalia_(1914).webm |

The remaining films of the film library (`assets/cinema/catalog.json`, `commons-index.json`) are not stored in the project: they play straight from Wikimedia Commons, and the licence and author are shown on the screen from the data of the file’s page at the moment of showing (details — `assets/cinema/README.md`).

## Sounds of the book (Freesound and Wikimedia Commons)

Recordings of real books and paper; the originals were downloaded from Freesound (a user login) and Commons; everything is CC0 or public domain, credit is not required and is given out of respect for the authors. The changes are the same everywhere: a piece with the event cut out, mixed down to mono 44.1 kHz, the bass below 60 Hz and the end trimmed with a smooth fade, the loudness levelled (no effects); for the recordings marked “top cut”, the harsh highs were additionally softly cut. The files are in `assets/sounds/book/`, the wiring is in `src/booksound.js`.

| What | Author | Licence | Page | Where used |
|---|---|---|---|---|
| Turning pages in a book | Mateusz_Chenc | CC0 | https://freesound.org/people/Mateusz_Chenc/sounds/519102/ | a leaf, takes 1–3 (`leaf-1…3`, three leaves from the recording) |
| Quiet Page Turn – 2, 3, 4, 6, 8 | SpaceJoe | CC0 | https://freesound.org/people/SpaceJoe/sounds/484962/ (also 484963, 484964, 484966, 484968) | a leaf, takes 4–8 (`leaf-4…8`; 8 — top cut at 5.5 kHz) |
| Pages- Turning and Riffling | Hephaestus | CC0 | https://freesound.org/people/Hephaestus/sounds/232167/ | a flip-through, fast (`riffle-1`, bass cut below 150 Hz) |
| turningpages_book_soundsample | KHoeppel | CC0 | https://freesound.org/people/KHoeppel/sounds/785844/ | a flip-through, medium (`riffle-2`) |
| flipping through pages | vladnegrila | CC0 | https://freesound.org/people/vladnegrila/sounds/339963/ | a flip-through, slow (`riffle-3`, top cut at 7 kHz) |
| Book, Paper, Pages, assorted (PDSounds, record no. 231) | stephan | public domain | https://commons.wikimedia.org/wiki/File:Book_paper_pages_assorted.ogg | a flip-through, dense (`riffle-4`, top cut at 6 kHz) |
| Book_open.mp3 (opening a Bible) | envirOmaniac2 | CC0 | https://freesound.org/people/envirOmaniac2/sounds/393844/ | opening a book (`open-1`) |
| Soft Cover Book Open 3 | yossirafa100 | CC0 | https://freesound.org/people/yossirafa100/sounds/638380/ | opening a book, quiet (`open-2`) |
| book_close.mp3 | envirOmaniac2 | CC0 | https://freesound.org/people/envirOmaniac2/sounds/393842/ | closing a book (`close-1`) |
| Close book | SoundsForHim | CC0 | https://freesound.org/people/SoundsForHim/sounds/399669/ | closing a book (`close-2`) |
| cm_samples_book_close | assrel | CC0 | https://freesound.org/people/assrel/sounds/123819/ | closing a book (`close-3`) |
| Putting down book and pen v2 | focuss87 | CC0 | https://freesound.org/people/focuss87/sounds/842601/ | a book being put down on the table (`put-1`) |
| Putting a Large Book Down | rylandbrooks | CC0 | https://freesound.org/people/rylandbrooks/sounds/387929/ | a book being put down on the table (`put-2`) |

## Ceiling painting

- Ludwig von Hofmann (default): “Idyll”, 1894–95 (Belvedere, Vienna; the painting is public domain, the photograph — Belvedere, Wien, photo by Johannes Stoll, CC BY-SA 4.0) — https://commons.wikimedia.org/wiki/File:Ludwig_von_Hofmann_-_Idyll_(M%C3%A4nnlicher_und_weiblicher_Halbakt_in_der_Landschaft)_-_7990_-_Kunsthistorisches_Museum.jpg; “Notturno”, 1897 (Neue Pinakothek, Munich; the painting is public domain, the photograph with the frame — Allie Caulfield, CC BY 2.0) — https://commons.wikimedia.org/wiki/File:Ludwig_von_Hofmann_-_Notturno.jpg. Reduced to 1200 pixels; pieces go in the little domes of the vault, “Idyll” — in the gilded frame on the back wall of the gallery.
- Pierre Puvis de Chavannes: “The Sacred Grove, Beloved of the Arts and the Muses”, 1884–89 (Art Institute of Chicago; public domain) — https://commons.wikimedia.org/wiki/File:Pierre_Puvis_de_Chavannes_-_The_Sacred_Grove,_Beloved_of_the_Arts_and_the_Muses_-_1922.445_-_Art_Institute_of_Chicago.jpg; “Between Art and Nature”, 1890–95 (Metropolitan Museum of Art; CC0) — https://commons.wikimedia.org/wiki/File:Inter_artes_et_naturam_(Between_Art_and_Nature)_MET_DT201007.jpg. Reduced to 2400 pixels; pieces go in the little domes, “Between Art and Nature” in full — in the field under the arch of the near end.
- The painting on the back wall of the gallery (next to “Idyll”; public domain, reduced to 1600 pixels): Arnold Böcklin, “In Spring”, 1873 (National Gallery of Victoria, Melbourne) — https://commons.wikimedia.org/wiki/File:Arnold_B%C3%B6cklin_-_Im_Fr%C3%BChling_(1873).jpg — in the arched frame.

The second set for the little domes — a choice with the “decor” button (reduced to 1200 pixels, pieces go in the little domes):
- “Russian skies”: Rylov, “Blue Expanse”, 1918 (public domain) — https://commons.wikimedia.org/wiki/File:Rylov_Blue_ExpanseFXD.jpg; Kuindzhi, “Cloud” (public domain) — https://commons.wikimedia.org/wiki/File:Kuindzhi_Cloud_1898_1908.jpg; Kuindzhi, “Cloud over a Mountain Valley” (public domain) — https://commons.wikimedia.org/wiki/File:0796Ha._%D0%9A%D1%83%D0%B8%D0%BD%D0%B4%D0%B6%D0%B8_%D0%90.%D0%98._%D0%9E%D0%B1%D0%BB%D0%B0%D0%BA%D0%BE_%D0%BD%D0%B0%D0%B4_%D0%B3%D0%BE%D1%80%D0%BD%D0%BE%D0%B9_%D0%B4%D0%BE%D0%BB%D0%B8%D0%BD%D0%BE%D0%B9.jpg; Levitan, “The Lake” (public domain) — https://commons.wikimedia.org/wiki/File:The_Lake_(detail,_retouch)_by_Isaac_Levitan_in_the_State_Russian_Museum.jpg.

## Maps on the globes (public domain)

Old maps, reprojected into a “longitude — latitude” unwrapping (8192 × 4096; at an ordinary view a reduced 4096 × 2048 is loaded).

- Terrestrial: Cornelis de Jode, “Hemispherium ab aequinoctiali linea, ad circulum poli arctici / antarctici”, Antwerp, 1593 (a coloured copy; scan by Barry Lawrence Ruderman Antique Maps) — https://commons.wikimedia.org/wiki/File:Hemispheriu_ab_Aequinoctiali_Linea,_ad_Circulu_Poli_Atarctici_-_colored.jpg — the two polar hemispheres merged into a single unwrapping.
- Celestial: Andreas Cellarius, “Haemisphaerium stellatum boreale antiquum” and “… australe antiquum”, “Harmonia Macrocosmica”, Amsterdam, 1660 (coloured copies; scans by Barry Lawrence Ruderman Antique Maps) — https://commons.wikimedia.org/wiki/File:Celestial_chart_by_Andreas_Cellarius_-_Haemisphaerium_Stellatum_Boreale_Antiquum.jpg, https://commons.wikimedia.org/wiki/File:Celestial_chart_by_Andreas_Cellarius_-_Haemisphaerium_Stellatum_Australe_Antiquum.jpg

The celestial charts are drawn as the sky is seen on a globe from the outside (a mirror image of the sky); the positions of the stars were checked against a catalogue.

## Plain window glass

The windows are round panes (Butzenscheiben) in lead, in a bottle-green tone (the side windows and the fan window in the end). The glass is a piece of a photograph of a round window of the parish church in Reichenau (Carinthia): “Reichenau Pfarrkirche — Fenster 4”, Wolfgang Sauber, CC BY-SA 4.0 — https://commons.wikimedia.org/wiki/File:Reichenau_Pfarrkirche_-_Fenster_4.jpg. Changes: the middle was cut out without the blue rim (`assets/glass/plain-butzen.jpg`, the same CC BY-SA 4.0 licence); in the window the piece is repeated in mirror image, under a common green tone, the bar at the springing of the arch and the lead rim are drawn on top (`src/glass.js`); the bars of the fan window are gilded, as real bodies (`src/ceiling.js`). The modified photograph is distributed on the same terms (CC BY-SA 4.0).

## Textures and paper

- Wood (frieze, cornice, railings, panelling, tables): Poly Haven, Smoked Walnut Veneer (Jenelle van Heerden), CC0 — https://polyhaven.com/a/smoked_walnut_veneer
- Damask of the back wall: Poly Haven, Floral Jacquard (colormass, Rico Cilliers), CC0 — https://polyhaven.com/a/floral_jacquard; the tone is the green of the vault coffers
- Herringbone parquet: Poly Haven, Herringbone Parquet (Sergej Majboroda, Jenelle van Heerden), CC0 — https://polyhaven.com/a/herringbone_parquet
- Lime plaster texture on the vault and the stucco: Poly Haven, Plastered Wall 02 (Charlotte Baglioni), CC0 — https://polyhaven.com/a/plastered_wall_02
- Wood of the door in the far end (the leaves and the surround): Poly Haven, Dark Wood (Dimitrios Savva, Dario Barresi, Rico Cilliers), CC0 — https://polyhaven.com/a/dark_wood
- Leather of the books on the shelves, of the back cover and of the spine of the folders (grain and relief): ambientCG Leather029, CC0.
- The folder for sheets — the cover with the embossed griffin and the inside with the motto “Beharrlichkeit führt zum Ziel”: a folder by Georg Hulbe (Hamburg, 1902), The Metropolitan Museum of Art, inv. 2000.421.1, the museum’s photographs, CC0 (Open Access) — https://www.metmuseum.org/art/collection/search/210313. Only a cut-out was made from the photographs; the relief of the embossing was derived from the brightness of the photograph (`tools/models/tooled_cover.py`).
- Bindings of the book (`assets/bindings/<id>/`, registry `src/bindings.js`, preparation — `tools/bindings/prepare.py`): photographs of bindings from the collection of the Metropolitan Museum of Art (gift of Jayne Wrightsman, 2008), all CC0 (Open Access), not retouched (cropping, a mirror image for the back cover of Bozerian, scale; the leather of the board edges is an averaged piece of the cover field): the covers, the spine and the endpaper of each are photographs of one and the same book.
  - `mm` — red morocco with a gilt border, Marius Michel et fils, Paris (1876 edition), A. Hamilton’s “Mémoires du comte de Grammont”, no. 681556 — https://www.metmuseum.org/art/collection/search/681556 (endpaper — red-burgundy marbled paper, from photograph ef2)
  - `noel` — red morocco with a coat of arms, “L’office de Noël”, Versailles, 1768 (calligrapher Baudouin), no. 681259 — https://www.metmuseum.org/art/collection/search/681259 (endpaper — “comb” marbling)
  - `tel` — red morocco, binder Jean Claude Bozerian, Fénelon’s “Les aventures de Télémaque”, Paris, 1790, no. 681128 — https://www.metmuseum.org/art/collection/search/681128 (endpaper — pale-blue moiré)
  - `mol` — green morocco, “Œuvres de Molière”, Paris, 1773, no. 681563 — https://www.metmuseum.org/art/collection/search/681563 (endpaper — “feather” marbling)
  - `rag` — dark-green morocco, “De’ ragguagli di Parnaso”, Amsterdam, Blaeu, 1669, binding by Simier, no. 681546 — https://www.metmuseum.org/art/collection/search/681546 (endpaper — “tortoiseshell” paper)
  - The binder is named only where the museum names him; the licence is taken from the museum’s data (`isPublicDomain: true`, photographs of such objects are published as Open Access / CC0).
- The titles on the spines are real editions of the 16th to early 20th centuries (public domain as titles); the list with full titles, authors and years — `docs/books/titles.json`.
- Baize of the tables in the lower hall: nap relief — Poly Haven, Caban, CC0 — https://polyhaven.com/a/caban; felt irregularities (converted to grey, the colour is the green of the hall) — ambientCG Fabric034, CC0 — https://ambientcg.com/a/Fabric034
- Paper relief: ambientCG Paper, CC0.
- Paper of the sheets: a clean sheet from the edition I. A. Bunin, “The Gentleman from San Francisco”, Paris, 1920 (Internet Archive, gospodinizsanfra00buni, leaf n215), public domain; the tone brought to that of the previous paper, the shadow of the spine trimmed off, a dark stroke in the upper right corner covered.
- The previous paper (`?paper=chekhov`) and the marks of the sheets — the speck and the rusty spots: a clean page from the edition A. P. Chekhov, “Muzhiki” (“The Peasants”), Berlin, publisher I. P. Ladyzhnikov, 1920 (Internet Archive, muzhikirazskazyi00chek), public domain; the colour evened out.

## Fonts

- PT Mono — ParaType, SIL Open Font License 1.1.
- Old Standard TT — Alexey Kryukov, SIL Open Font License 1.1.
- Cormorant Garamond — Christian Thalmann, SIL Open Font License 1.1.
- Abril Fatface — TypeTogether (Veronika Burian, José Scaglione), SIL Open Font License 1.1: the “Typewriter” lettering on the typewriter’s back panel, redrawn sharp.

For now the fonts are loaded from Google Fonts; before publication they should be put into the project together with OFL.txt.

## Libraries

- three.js r170 — MIT, © three.js authors (`vendor/three/LICENSE`).
- pdf.js (pdfjs-dist 6.5.438) — Apache-2.0, © Mozilla Foundation and the pdf.js authors (`vendor/pdfjs/LICENSE`; what was taken from the package — `vendor/pdfjs/VERSION.txt`): draws the pages of the PDF put into the book. Alongside it lie its font tables (`cmaps`, `standard_fonts`), colour profiles and the JBIG2 and JPEG 2000 decoders — each with its own licence in the same folder.
- FFmpeg 9.0.2 in WebAssembly via libav.js 6.11.9 (Yahweasel) — LGPL-2.1-or-later (FFmpeg, © Fabrice Bellard and the FFmpeg authors; the libav.js wrapper — ISC-like), `vendor/libav/` (the licence — `LICENSE-LGPL-2.1.txt`, how it was built and how to rebuild — `README.md` in the same folder): decodes the sound of films that Chrome does not play by itself (AC-3, E-AC-3, DTS, TrueHD ...), see `src/filmaudio.js`, and the picture of old video files (AVI with Xvid/DivX, MJPEG, MPEG-2 from DVD, DV, H.263, H.264 in AVI/MPEG-PS/TS), see `src/filmvideo.js`. Built from demuxers, audio and video decoders (and libswscale) only, with no GPL parts and no “nonfree”.
