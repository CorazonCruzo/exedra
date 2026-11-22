import { t } from './i18n.js';
// Плееры сайтов для проектора: ссылка → встраиваемый плеер (<iframe>) и управление им сообщениями (postMessage). У каждого сайта свой протокол;
// снаружи — один интерфейс, проектор (cinema.js) знает только его.
//
// site = {
//   name,                                  // для подписи «Идёт: …» и подсказок
//   parse(url: URL) → m | null,            // своя ли ссылка; m — что нужно плееру ({ id, start, … })
//   src(m, { sound, origin }) → string,    // адрес встраиваемого плеера: сразу играть; sound = false — начинать без звука
//   allow?: string,                        // атрибут allow у <iframe> (по умолчанию 'autoplay; encrypted-media')
//   connect(frame, m, on) → ctl,           // подключиться к плееру; on — куда сообщать разобранное:
//     on.ready()                           //   плеер ответил (команды доходят)
//     on.time(sec), on.duration(sec)       //   где сейчас и сколько всего (время между сообщениями проектор досчитывает сам)
//     on.state('playing' | 'paused' | 'ended')
//     on.error(text)                       //   показать нельзя — текст для подсказки (проектор выключится)
// }
// ctl = { message(data) — сообщение от этого плеера (источник уже проверен), play(), pause(), seek(sec), volume(0…1), mute(bool), dispose() }

const json = d => { if (typeof d !== 'string') return d; try { return JSON.parse(d); } catch { return null; } };
// Время из ссылки: ?t=90, ?t=1m30s, ?start=90, #t=1m30s
export function linkTime(u) {
  const t = u.searchParams.get('t') ?? u.searchParams.get('start') ?? (/[#&]t=([^&]+)/.exec(u.hash)?.[1] ?? '');
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
  return m && t ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

// — YouTube: IFrame API без его скрипта (тот же протокол через postMessage). Плеер отвечает, когда его «слушают»: просим, пока не ответит.
const YT_ERR = {
  2: t('web.yt.invalid'), 5: t('web.yt.noPlay'), 100: t('web.yt.gone'),
  101: t('web.yt.noEmbed'),
  150: t('web.yt.noEmbed'),
};
const youtube = {
  name: 'YouTube',
  parse(u) {
    const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, ''), part = u.pathname.split('/').filter(Boolean);
    let id = null;
    if (host === 'youtu.be') id = part[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (part[0] === 'watch') id = u.searchParams.get('v');
      else if (['shorts', 'embed', 'live', 'v'].includes(part[0])) id = part[1];
    }
    return id && /^[\w-]{11}$/.test(id) ? { id, start: linkTime(u) } : null;
  },
  src: (m, { sound, origin }) => `https://www.youtube-nocookie.com/embed/${m.id}?autoplay=1&playsinline=1&rel=0&iv_load_policy=3&hl=ru&cc_lang_pref=ru&enablejsapi=1&origin=${encodeURIComponent(origin)}${m.start ? '&start=' + m.start : ''}${sound ? '' : '&mute=1'}`,
  connect(f, m, on) {
    let heard = false, n = 0;
    const send = (func, args = []) => f.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' }), '*');
    const ask = () => { if (heard || n++ > 20 || !f.isConnected) return; f.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); setTimeout(ask, 250); };
    f.addEventListener('load', ask);
    return {
      message(raw) {
        const d = json(raw); if (!d) return;
        if (!heard) { heard = true; on.ready(); }
        if (d.info?.currentTime !== undefined) on.time(d.info.currentTime);
        if (d.info?.duration) on.duration(d.info.duration);
        if (d.event === 'onError') return on.error(YT_ERR[d.info] ?? t('web.yt.noPlay'));
        const st = d.event === 'onStateChange' ? d.info : d.event === 'infoDelivery' ? d.info?.playerState : undefined;
        if (st === 0) on.state('ended'); else if (st === 1) on.state('playing'); else if (st === 2) on.state('paused');
      },
      play: () => send('playVideo'), pause: () => send('pauseVideo'), seek: t => send('seekTo', [t, true]),
      volume: v => send('setVolume', [Math.round(v * 100)]), mute: on => send(on ? 'mute' : 'unMute'),
      dispose() { f.removeEventListener('load', ask); },
    };
  },
};

// Общее: команды, которые плеер принимает лишь после «готов», ждут в очереди: cmd(c) — отправить или отложить, first(c) — в начало очереди, flush() — плеер готов.
const waiting = send => { let q = [], ok = false; return { cmd: c => ok ? send(c) : q.push(c), first: c => q.unshift(c), flush() { ok = true; q.splice(0).forEach(send); } }; };
const hms = s => `${Math.floor(s / 3600)}h${Math.floor(s / 60) % 60}m${Math.floor(s) % 60}s`;
const hostOf = u => u.hostname.toLowerCase().replace(/^(www|m)\./, '');

// — Rutube: свой протокол сообщений, https://rutube.ru/info/embed/ (раздел «JS API»): команды { type: 'player:…', data }, события — JSON-строки.
// Команды принимаются после player:ready. Конец ролика на деле — состояние 'completed' (в документации 'stopped'). Без звука начинаем через autostartmute (параметра «mute» нет).
const rutube = {
  name: 'Rutube',
  parse(u) {
    if (hostOf(u) !== 'rutube.ru') return null;
    const part = u.pathname.split('/').filter(Boolean);
    const at = part[0] === 'video' && part[1] === 'private' ? 2 : part[0] === 'video' || part[0] === 'shorts' ? 1 : part[0] === 'play' && part[1] === 'embed' ? 2 : -1;
    const id = part[at]?.toLowerCase();
    return id && /^[0-9a-f]{32}$/.test(id) ? { id, key: u.searchParams.get('p') || '', start: linkTime(u) } : null;
  },
  src: (m, { sound }) => `https://rutube.ru/play/embed/${m.id}/?autoplay=true${sound ? '' : '&autostartmute=true'}${m.start ? '&t=' + m.start : ''}${m.key ? '&p=' + encodeURIComponent(m.key) : ''}`,
  connect(f, m, on) {
    const w = waiting(c => f.contentWindow?.postMessage(JSON.stringify(c), '*')), send = (type, data = {}) => w.cmd({ type, data });
    let heard = false, ready = false, done = false, t = 0, dur = 0;
    return {
      message(raw) {
        const d = json(raw); if (!d?.type?.startsWith('player:')) return;
        const x = d.data ?? {};
        if (d.type === 'player:ready') { ready = true; if (!heard) { heard = true; on.ready(); } w.flush(); return; }
        if (!heard) { heard = true; on.ready(); }   // событие ready могло пройти раньше нашей подписки — любое сообщение плеера доказывает, что канал работает
        if (d.type === 'player:currentTime') { on.time(t = +x.time); if (!ready) { ready = true; w.flush(); } }   // команды ждут ready; если его не было — хватит первого времени
        else if (d.type === 'player:durationChange') { if (+x.duration > 0) on.duration(dur = +x.duration); }
        else if (d.type === 'player:changeState') {   // на деле: playing, pause, completed (в документации — paused и stopped); реклама, перемотка, буферизация — не наше дело
          const st = { playing: 'playing', pause: 'paused', paused: 'paused', completed: 'ended', stopped: 'ended' }[x.state];
          if (st === 'playing') done = false;
          if (st === 'ended') done = true;
          if (st && (st !== 'paused' || !(done || dur - t < 1))) on.state(st);   // перед концом и после него плеер ещё «ставит на паузу» — это не пауза
        }
        else if (d.type === 'player:error') on.error(RT_ERR(x.text));
        else if (d.type === 'player:playOptionsLoaded') {   // ошибок «нет такого видео» плеер событием error не шлёт — показывает заглушку и присылает её описание в playOptions.detail
          const o = x.playOptions, det = o?.detail, ru = det?.languages?.find(l => l.lang === 'rus')?.title ?? o?.acl_access?.err_text;
          if (det || o?.acl_access?.allowed === false) on.error(RT_ERR(`${det?.name ?? o.acl_access.err_code} ${ru ?? ''}`, ru));
        }
      },
      play: () => send('player:play'), pause: () => send('player:pause'), seek: t => send('player:setCurrentTime', { time: t }),
      volume: v => send('player:setVolume', { volume: v }), mute: on => send(on ? 'player:mute' : 'player:unMute'), dispose() {},
    };
  },
};
const RT_ERR = (text = '', ru) => /not_?exist|не найден|удал|deleted|неправильная ссылка/i.test(text) ? t('web.notFound') : /embed|domain|referer|встра|домен/i.test(text) ? t('web.noEmbed')
  : ru && typeof ru === 'string' ? 'Rutube: ' + ru.replace(/\.$/, '') + '.' : t('web.rt.noPlay');

// — VK Видео: VK.VideoPlayer (https://dev.vk.ru/ru/widgets/video, videoplayer.js) без его скрипта. Страница video_ext.php с js_api=1 понимает объекты
// { method: 'init' | 'play' | 'pause' | 'seek' (time) | 'set_volume' (volume) | 'mute' | 'unmute' } и шлёт объекты { event: 'inited' | 'timeupdate' | 'started' |
// 'resumed' | 'paused' | 'ended' | 'error' | …, state, time, duration, volume, muted, errorCode }. Пока нет 'inited', команды ждут; 'init' повторяем.
const vk = {
  name: t('web.vk.name'),
  parse(u) {
    const host = hostOf(u);
    if (!/^(vk\.com|vk\.ru|vkvideo\.ru)$/.test(host)) return null;
    const start = linkTime(u), q = u.searchParams;
    if (/^\/video_ext\.php$/.test(u.pathname)) return /^-?\d+$/.test(q.get('oid') ?? '') && /^\d+$/.test(q.get('id') ?? '') ? { oid: q.get('oid'), id: q.get('id'), hash: q.get('hash') || '', start } : null;
    // video-1_2, clip-1_2, video?z=video-1_2%2Fpl_…, ключ доступа — третьей частью: video-1_2_a1b2c3
    const s = [u.pathname, q.get('z'), q.get('w')].map(x => /(?:video|clip)(-?\d+)_(\d+)(?:_([0-9a-f]+))?/i.exec(x ?? '')).find(Boolean);
    return s ? { oid: s[1], id: s[2], hash: s[3] || q.get('hash') || '', start } : null;
  },
  // Параметра «без звука» у плеера нет: без звука начинаем сами — сперва mute, потом play (autoplay=0), чтобы звук не прорвался.
  src: (m, { sound }) => `https://vk.com/video_ext.php?oid=${m.oid}&id=${m.id}${m.hash ? '&hash=' + encodeURIComponent(m.hash) : ''}&autoplay=${(m.quiet = !sound) ? 0 : 1}&js_api=1&hd=2${m.start ? '&t=' + hms(m.start) : ''}`,
  connect(f, m, on) {
    const w = waiting(c => f.contentWindow?.postMessage(c, '*')), send = (method, extra) => w.cmd({ method, ...extra });
    let heard = false, over = false, n = 0;
    // Страница «Видео недоступно» (закрытое, удалённое, без ключа) ничего не отвечает: если за 12 с на init никто не откликнулся — так и скажем.
    const ask = () => { if (heard || !f.isConnected) return; if (n++ > 48) return on.error(m.hash ? t('web.vk.closed') : t('web.vk.private')); f.contentWindow?.postMessage({ method: 'init' }, '*'); setTimeout(ask, 250); };
    f.addEventListener('load', ask);
    return {
      message(d) {
        d = json(d); if (!d?.event || over) return;
        // В конце ролика VK сам включает следующий (со звуком!) секунд через 8, а события 'ended' не шлёт: конец — когда время дошло до длины;
        // если же прилетел 'inited' другого ролика — следующий уже пошёл: тоже конец, а ему ставим паузу и глушим.
        const next = heard && d.event === 'inited' && d.videoId && d.videoId !== `${m.oid}_${m.id}`;
        if (next || d.event === 'ended' || (d.event === 'timeupdate' && d.duration > 1 && d.time >= d.duration - .1)) {
          over = true; if (next) { send('pause'); send('mute'); } return on.state('ended');
        }
        if (!heard) { heard = true; on.ready(); if (m.quiet) { w.first({ method: 'play' }); w.first({ method: 'mute' }); } w.flush(); }
        if (Number.isFinite(d.time) && d.event !== 'error') on.time(d.time);
        if (d.duration > 0) on.duration(d.duration);
        if (d.event === 'started' || d.event === 'resumed') on.state('playing'); else if (d.event === 'paused') on.state('paused');
        else if (d.event === 'error') on.error(VK_ERR(d.errorCode));
      },
      play: () => send('play'), pause: () => send('pause'), seek: t => send('seek', { time: t }),
      volume: v => send('set_volume', { volume: v }), mute: on => send(on ? 'mute' : 'unmute'), dispose() { f.removeEventListener('load', ask); },
    };
  },
};
const VK_ERR = code => t('web.vk.error', { code });

// — Vimeo: https://developer.vimeo.com/player/sdk/embed — сообщения { method, value } плееру (после его 'ready'; подписки — { method: 'addEventListener', value: событие }),
// от плеера — { event, data } и { method, value } в ответ на запрос. Время приходит событием timeupdate (около 4 раз в секунду) вместе с длиной.
const VIMEO_EVENTS = ['play', 'playing', 'pause', 'ended', 'timeupdate', 'durationchange', 'error', 'loaded'];
const vimeo = {
  name: 'Vimeo',
  parse(u) {
    const host = hostOf(u), part = u.pathname.split('/').filter(Boolean);
    let id, h = u.searchParams.get('h') || '';
    if (host === 'player.vimeo.com') { if (part[0] !== 'video') return null; id = part[1]; }
    else if (host === 'vimeo.com') {
      // vimeo.com/123, vimeo.com/123/hash, vimeo.com/channels/x/123, groups/x/videos/123, showcase|album/x/video/123
      const i = part.findIndex((p, k) => /^\d+$/.test(p) && (k === 0 || ['channels', 'groups', 'showcase', 'album', 'ondemand'].includes(part[0]) && k >= 2 && (part[k - 1] === 'video' || part[k - 1] === 'videos' || k === 2)));
      if (i < 0) return null;
      id = part[i]; if (!h && /^[0-9a-f]{8,}$/i.test(part[i + 1] ?? '')) h = part[i + 1];
    } else return null;
    return /^\d+$/.test(id ?? '') ? { id, h, start: linkTime(u) } : null;
  },
  src: (m, { sound }) => `https://player.vimeo.com/video/${m.id}?${m.h ? 'h=' + m.h + '&' : ''}autoplay=1&playsinline=1&dnt=1${sound ? '' : '&muted=1'}${m.start ? '#t=' + m.start + 's' : ''}`,
  connect(f, m, on) {
    const send = (method, value) => f.contentWindow?.postMessage(JSON.stringify({ method, value }), '*');
    let heard = false, done = false, n = 0;
    const listen = () => { VIMEO_EVENTS.forEach(e => send('addEventListener', e)); send('getDuration'); };
    const ask = () => { if (heard || n++ > 20 || !f.isConnected) return; listen(); setTimeout(ask, 250); };
    f.addEventListener('load', ask);
    return {
      message(raw) {
        const d = json(raw); if (!d || (!d.event && !d.method)) return;
        if (!heard) { heard = true; on.ready(); }
        if (d.event === 'ready') listen();
        else if (d.method === 'getDuration') { if (d.value > 0) on.duration(d.value); }
        else if (d.event === 'timeupdate' || d.event === 'playProgress') { on.time(d.data?.seconds); if (d.data?.duration > 0) on.duration(d.data.duration); }   // на подписку timeupdate плеер отвечает событием playProgress
        else if (d.event === 'durationchange') { if (d.data?.duration > 0) on.duration(d.data.duration); }
        else if (d.event === 'play' || d.event === 'playing') { done = false; on.state('playing'); }
        else if (d.event === 'pause') { if (!done && !(d.data?.duration - d.data?.seconds < .5)) on.state('paused'); }   // после конца плеер сам «ставит на паузу» в начале — это не пауза
        else if (d.event === 'ended' || d.event === 'finish') { done = true; on.state('ended'); }   // 'finish' — прежнее имя события в ответ на подписку 'ended'
        else if (d.event === 'error') on.error(VIMEO_ERR(d.data));
      },
      play: () => send('play'), pause: () => send('pause'), seek: t => send('setCurrentTime', t),
      volume: v => send('setVolume', v), mute: on => send('setMuted', on), dispose() { f.removeEventListener('load', ask); },
    };
  },
};
const VIMEO_ERR = x => x?.name === 'PrivacyError' ? t('web.noEmbed') : x?.name === 'NotFoundError' ? t('web.notFound') : t('web.vimeo.noPlay');

export const SITES = [youtube, rutube, vk, vimeo];

// Ссылка из поля «ссылка на видео»: { site, m } — плеер сайта; { direct } — сам видеофайл по адресу (идёт в сцену, как файл с компьютера); null — не ссылка.
// Своё ли — решает сайт; что не узнал ни один, считается прямой ссылкой на файл (не видео — проектор так и скажет).
export function parseVideoLink(text) {
  let s = String(text ?? '').trim(); if (!s || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  let u; try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
  for (const site of SITES) { const m = site.parse(u); if (m) return { site, m }; }
  return { direct: u.href };
}
