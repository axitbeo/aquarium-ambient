/* Aquarium Player (V3)
 * - Video library: two muted <video> elements crossfade (A/B). The outgoing video stays fully
 *   opaque underneath until the incoming one has rendered a frame and faded in: never black.
 * - Sound: independent music + ambience channels, each with Loop One / Loop All / Shuffle.
 *   Volume goes through Web Audio gain nodes (iOS ignores media.volume); native fallback.
 * - Offline: media is cached per item on request (never automatically) in the permanent
 *   'aquarium-media-v1' cache, keyed by `file?v=N` from library.js.
 * Depends on library.js (self.AQUARIUM_LIBRARY) and markup in index.html.
 */
(() => {
  'use strict';
  const LIB = self.AQUARIUM_LIBRARY || { videos: [], sounds: [] };
  const MEDIA_CACHE = 'aquarium-media-v1';        // must match service-worker.js
  const STORE_KEY = 'aquarium-player';
  const FADE_MS = 1600;                           // keep in sync with .video-bg transition
  const LEAD_S = 3;                               // begin next video this long before the end
  const MODES = [['one', 'Loop One'], ['all', 'Loop All'], ['shuffle', 'Shuffle']];
  const body = document.body;

  const lists = {
    video: LIB.videos || [],
    music: (LIB.sounds || []).filter(s => s.type === 'music'),
    ambience: (LIB.sounds || []).filter(s => s.type === 'ambience')
  };
  const allItems = [...lists.video, ...lists.music, ...lists.ambience];
  const byId = new Map(allItems.map(i => [i.id, i]));
  const abs = p => new URL(p, location.href).href;
  const keyOf = (item, file = item.file) => abs(file + '?v=' + (item.v || 1));
  const pathOf = url => url.split('?')[0];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const mb = n => n ? (n / 1048576 < 10 ? (n / 1048576).toFixed(1) : Math.round(n / 1048576)) + ' MB' : '';

  // ---------- Persisted preferences ----------
  const defaults = {
    sound: false,
    video: { id: lists.video[0] && lists.video[0].id, mode: 'all' },
    music: { on: true, id: lists.music[0] && lists.music[0].id, mode: 'all', vol: 0.6 },
    ambience: { on: true, id: lists.ambience[0] && lists.ambience[0].id, mode: 'one', vol: 0.8 }
  };
  const state = JSON.parse(JSON.stringify(defaults));
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) ['video', 'music', 'ambience'].forEach(k => Object.assign(state[k], saved[k]));
    state.sound = saved ? !!saved.sound : localStorage.getItem('aquarium-sound') === 'on'; // V2 key
  } catch (_) {}
  // Selections whose entries were removed from library.js fall back to the first entry.
  ['video', 'music', 'ambience'].forEach(k => {
    if (!lists[k].some(i => i.id === state[k].id)) state[k].id = defaults[k].id;
    if (!MODES.some(m => m[0] === state[k].mode)) state[k].mode = defaults[k].mode;
  });
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      localStorage.setItem('aquarium-sound', state.sound ? 'on' : 'off');
    } catch (_) {}
  }

  // ---------- Media cache ----------
  const hasCaches = 'caches' in self;
  let cached = new Map();          // cached url -> size in bytes
  const probe = {};                // id -> 'available' | 'missing' | 'offline' | 'error'
  const sizes = {};                // id -> server size from HEAD
  const progress = {};             // id -> percent while downloading
  const failed = new Set();        // ids whose download failed
  const broken = new Set();        // ids that failed to play this session

  async function refreshCache() {
    if (!hasCaches) return;
    try {
      const cache = await caches.open(MEDIA_CACHE);
      const next = new Map();
      for (const req of await cache.keys()) {
        const res = await cache.match(req);
        next.set(req.url, +(res && res.headers.get('Content-Length')) || 0);
      }
      cached = next;
    } catch (_) {}
  }
  const cachedVersionOf = item => { // any cached revision of this item's main file
    const p = abs(item.file);
    for (const url of cached.keys()) if (pathOf(url) === p) return url;
    return null;
  };
  function cacheState(item) {
    if (cached.has(keyOf(item))) return 'cached';
    return cachedVersionOf(item) ? 'update' : null;
  }
  // Prefer the exact cached revision, then an older cached revision (works offline), then network.
  const playUrl = item => cached.has(keyOf(item)) ? keyOf(item) : (cachedVersionOf(item) || keyOf(item));
  const isPlayable = item => !broken.has(item.id) && !(probe[item.id] === 'missing' && !cacheState(item));
  function statusOf(item) {
    if (progress[item.id] != null) return 'downloading';
    const c = cacheState(item);
    if (c) return c;
    if (probe[item.id] === 'missing') return 'missing';
    if (probe[item.id] === 'offline') return 'offline';   // unreachable, not necessarily missing
    if (broken.has(item.id)) return 'missing';
    if (failed.has(item.id)) return 'error';
    return 'available';
  }

  // HEAD-check items that aren't cached (only while the panel is open) to find missing files.
  async function probeAll() {
    await Promise.all(allItems.map(async item => {
      if (cacheState(item) === 'cached') return;
      try {
        const r = await fetch(keyOf(item), { method: 'HEAD', cache: 'no-store' });
        probe[item.id] = r.ok ? 'available' : r.status === 404 ? 'missing' : 'error';
        if (r.ok) broken.delete(item.id);        // e.g. failed while offline; reachable again now
        if (+r.headers.get('Content-Length')) sizes[item.id] = +r.headers.get('Content-Length');
      } catch (_) { probe[item.id] = 'offline'; }
    }));
    render();
  }

  const TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg',
    m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const typeOf = file => TYPES[file.split('.').pop().toLowerCase()] || 'application/octet-stream';

  async function fetchToCache(cache, url, file, onProgress) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) { const e = new Error(res.status); e.status = res.status; throw e; }
    const total = +res.headers.get('Content-Length') || 0;
    let blob;
    if (onProgress && total && res.body && res.body.getReader) {
      const reader = res.body.getReader(); const chunks = []; let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length; onProgress(Math.min(99, Math.floor(got / total * 100)));
      }
      blob = new Blob(chunks, { type: typeOf(file) });
    } else blob = new Blob([await res.arrayBuffer()], { type: typeOf(file) });
    await cache.put(url, new Response(blob, { headers: { 'Content-Type': typeOf(file), 'Content-Length': String(blob.size) } }));
  }

  async function download(item) {
    if (!hasCaches || progress[item.id] != null) return;
    progress[item.id] = 0; failed.delete(item.id); render();
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      const cache = await caches.open(MEDIA_CACHE);
      await fetchToCache(cache, keyOf(item), item.file, pct => {
        if (pct !== progress[item.id]) { progress[item.id] = pct; updateBadge(item); }
      });
      if (item.poster) await fetchToCache(cache, keyOf(item, item.poster), item.poster).catch(() => {});
      // User-initiated update: drop only the older revisions of this same item.
      const own = [abs(item.file), item.poster && abs(item.poster)];
      const keep = [keyOf(item), item.poster && keyOf(item, item.poster)];
      for (const url of cached.keys()) if (own.includes(pathOf(url)) && !keep.includes(url)) await cache.delete(url);
      broken.delete(item.id); probe[item.id] = 'available';
    } catch (e) {
      if (e && e.status === 404) probe[item.id] = 'missing'; else failed.add(item.id);
    }
    delete progress[item.id];
    await refreshCache(); render();
  }

  async function removeItem(item) {
    if (!confirm('Remove "' + item.title + '" from offline storage?')) return;
    const cache = await caches.open(MEDIA_CACHE);
    const own = [abs(item.file), item.poster && abs(item.poster)];
    for (const url of cached.keys()) if (own.includes(pathOf(url))) await cache.delete(url);
    await refreshCache(); render();
  }

  // Cached files no longer referenced by library.js. Never removed without the user's OK.
  function orphans() {
    const known = new Set();
    allItems.forEach(i => { known.add(abs(i.file)); if (i.poster) known.add(abs(i.poster)); });
    return [...cached.keys()].filter(url => !known.has(pathOf(url)));
  }
  async function removeOrphans() {
    const list = orphans();
    if (!list.length || !confirm('Remove ' + list.length + ' unused offline file(s)?')) return;
    const cache = await caches.open(MEDIA_CACHE);
    for (const url of list) await cache.delete(url);
    await refreshCache(); render();
  }

  // ---------- Playlist order ----------
  const history = { video: [], music: [], ambience: [] };
  // `avoid`: an extra id to skip (e.g. the item still playing when a replacement failed).
  function pick(kind, curId, dir, avoid) {
    const items = lists[kind].filter(isPlayable);
    if (!items.length) return null;
    if (state[kind].mode === 'shuffle') {
      if (dir < 0 && history[kind].length) {
        const prevId = history[kind].pop();
        const prev = items.find(i => i.id === prevId);
        if (prev) return prev;
      }
      const pool = items.filter(i => i.id !== curId && i.id !== avoid);   // never repeat the current item
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : items[0];
    }
    const idx = items.findIndex(i => i.id === curId);
    if (idx < 0) return items[0];
    return items[(idx + dir + items.length) % items.length];
  }
  function remember(kind, id) {
    if (!id) return;
    history[kind].push(id);
    if (history[kind].length > 20) history[kind].shift();
  }

  // ---------- Video player ----------
  const vA = document.getElementById('video');
  const vB = document.getElementById('videoB');
  let front = vA, back = vB;        // front = visible element
  let currentVideo = null;
  let switching = false, queued = null, blockedVideo = null, videoReadyTimer;
  [vA, vB].forEach(v => {
    v.muted = true; v.defaultMuted = true; v.volume = 0;   // videos never make sound
    v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    v.addEventListener('timeupdate', onVideoTime);
    v.addEventListener('ended', e => { if (e.target === front && !switching) nextVideo(1, true); });
  });
  const videoAllowed = () => !body.classList.contains('motion-paused') && !document.hidden;

  function waitForFrame(v, cb) {
    if (v.requestVideoFrameCallback) { v.requestVideoFrameCallback(() => cb()); return; }
    const t = () => { if (v.currentTime > 0) { v.removeEventListener('timeupdate', t); cb(); } };
    v.addEventListener('timeupdate', t);
  }

  function playVideo(item, attempts = 0) {
    if (!item) { if (!currentVideo) fallbackToCss(); return; }
    if (switching) { queued = item; return; }
    switching = true;
    const incoming = back, outgoing = front;
    let settled = false;
    // Give up on files that never start, but not while autoplay is merely blocked (waits for a tap).
    const timer = setTimeout(() => { if (blockedVideo !== item) fail(); }, 15000);
    const cleanup = () => { clearTimeout(timer); incoming.removeEventListener('error', fail); incoming.removeEventListener('playing', onPlaying); };
    function onPlaying() { waitForFrame(incoming, reveal); }
    function fail() {
      if (settled) return; settled = true; cleanup();
      incoming.removeAttribute('src'); incoming.load();
      broken.add(item.id); switching = false; render();
      const curId = currentVideo && currentVideo.id;
      const alt = pick('video', item.id, 1, curId);
      // Never "switch" to the video that is already playing: just keep it running instead.
      if (alt && alt.id !== item.id && alt.id !== curId && attempts < lists.video.length) playVideo(alt, attempts + 1);
      else if (!currentVideo) fallbackToCss();
      else if (front.paused && videoAllowed()) front.play().catch(() => {});
    }
    function reveal() {
      if (settled) return; settled = true; cleanup();
      remember('video', currentVideo && currentVideo.id);
      currentVideo = item; state.video.id = item.id; save();
      incoming.classList.add('front', 'incoming');           // fades in ON TOP of the opaque outgoing
      front = incoming; back = outgoing;
      if (!body.classList.contains('video-on')) {
        body.classList.add('video-on');
        clearTimeout(videoReadyTimer);
        videoReadyTimer = setTimeout(() => body.classList.add('video-ready'), FADE_MS + 200);
      }
      setTimeout(() => {
        incoming.classList.remove('incoming');
        outgoing.classList.remove('front');                    // now hidden beneath the new video
        setTimeout(() => {
          outgoing.pause(); outgoing.removeAttribute('src'); outgoing.load();   // free the decoder
          switching = false; render();
          if (queued) { const q = queued; queued = null; if (q.id !== currentVideo.id) playVideo(q); }
        }, FADE_MS);
      }, FADE_MS + 100);
    }
    incoming.addEventListener('error', fail);
    incoming.addEventListener('playing', onPlaying);
    incoming.loop = state.video.mode === 'one';
    incoming.src = playUrl(item);
    if (!videoAllowed()) { blockedVideo = item; return; }
    const p = incoming.play();
    if (p && p.catch) p.catch(err => { if (err && err.name === 'NotAllowedError') blockedVideo = item; });
  }
  function onVideoTime(e) {
    const v = e.target;
    if (v !== front || switching || state.video.mode === 'one' || !v.duration) return;
    if (v.duration - v.currentTime < LEAD_S) nextVideo(1, true);
  }
  function nextVideo(dir) { playVideo(pick('video', currentVideo ? currentVideo.id : state.video.id, dir)); }
  function fallbackToCss() {
    clearTimeout(videoReadyTimer);
    body.classList.remove('video-on', 'video-ready');
  }
  function resumeVideo() {
    if (!videoAllowed()) return;
    if (blockedVideo && switching) {               // autoplay was blocked: retry inside this gesture
      blockedVideo = null; back.play().catch(() => {});
      return;
    }
    if (front.getAttribute('src') && front.paused) front.play().catch(() => {});
    if (switching && back.getAttribute('src') && back.paused) back.play().catch(() => {});
  }
  function pauseVideo() { vA.pause(); vB.pause(); }

  // ---------- Audio channels ----------
  const AC = self.AudioContext || self.webkitAudioContext;
  let ctx = null;
  const nativeVolume = (() => { try { const a = new Audio(); a.volume = 0.5; return a.volume === 0.5; } catch (_) { return false; } })();
  // Must be called from a user gesture the first time (iOS).
  function ensureCtx() {
    if (!AC) return null;
    if (!ctx) { try { ctx = new AC(); } catch (_) { return null; } }
    if (ctx.state !== 'running') { try { ctx.resume(); } catch (_) {} }
    return ctx;
  }
  const volumeSupported = () => !!AC || nativeVolume;

  function makeChannel(kind) {
    const el = new Audio();
    el.preload = 'auto';
    let gain = null, buffer = null, bufferId = null, source = null;
    const item = () => byId.get(state[kind].id);
    const wanted = () => state.sound && state[kind].on && !document.hidden;

    function connect() {                    // route the element through a gain node once
      if (gain || !ensureCtx()) return;
      try {
        gain = ctx.createGain();
        gain.connect(ctx.destination);
        ctx.createMediaElementSource(el).connect(gain);
        el.volume = 1;
      } catch (_) { gain = null; }
    }
    function setLevel(v, ramp = 0.3) {
      if (gain) {
        const t = ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(v, t + ramp);
      } else if (nativeVolume) el.volume = v;
    }
    // Gapless: short loops decoded in memory with leading/trailing encoder silence trimmed.
    const useBuffer = it => it && it.gapless && state[kind].mode === 'one' && gain;
    function decode(it) {
      if (bufferId === it.id && buffer) return Promise.resolve(buffer);
      return fetch(playUrl(it)).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(data => new Promise((ok, bad) => ctx.decodeAudioData(data, ok, bad)))
        .then(buf => { buffer = buf; bufferId = it.id; return buf; });
    }
    function loopPoints(buf) {
      const d = buf.getChannelData(0), max = Math.floor(buf.sampleRate * 0.1), th = 1e-3;
      let s = 0, e = d.length - 1;
      while (s < max && Math.abs(d[s]) < th) s++;
      while (d.length - 1 - e < max && e > s && Math.abs(d[e]) < th) e--;
      return [s / buf.sampleRate, (e + 1) / buf.sampleRate];
    }
    function stopBuffer() { if (source) { try { source.stop(); } catch (_) {} source.disconnect(); source = null; } }
    function startBuffer(it) {
      decode(it).then(buf => {
        if (!wanted() || item() !== it || !useBuffer(it)) return;
        stopBuffer();
        const [ls, le] = loopPoints(buf);
        source = ctx.createBufferSource();
        source.buffer = buf; source.loop = true; source.loopStart = ls; source.loopEnd = le;
        source.connect(gain); source.start(0, ls);
        setLevel(state[kind].vol);
      }).catch(() => { buffer = null; bufferId = null; playElement(it); }); // fall back to <audio>
    }
    function playElement(it) {
      stopBuffer();
      const url = playUrl(it);
      if (el.src !== url) el.src = url;
      el.loop = state[kind].mode === 'one';
      setLevel(state[kind].vol);
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
    }
    function play() {
      const it = item();
      if (!it || !wanted()) return;
      connect();
      if (useBuffer(it)) { el.pause(); startBuffer(it); } else playElement(it);
    }
    function stop() { el.pause(); stopBuffer(); }
    function select(it, dir = 0) {
      if (!it) { stop(); render(); return; }
      if (dir >= 0 && state[kind].id !== it.id) remember(kind, state[kind].id);
      const changed = state[kind].id !== it.id;
      state[kind].id = it.id; save(); render();
      if (!wanted()) return;
      if (changed && gain && (!el.paused || source)) {     // short fade between tracks
        setLevel(0, 0.25);
        setTimeout(() => { stop(); play(); }, 280);
      } else play();
    }
    el.addEventListener('ended', () => { if (state[kind].mode !== 'one') select(pick(kind, state[kind].id, 1), 1); });
    el.addEventListener('error', () => {
      const it = item();
      if (!el.getAttribute('src') || !it) return;
      broken.add(it.id); render();
      const alt = pick(kind, it.id, 1);
      if (alt && alt.id !== it.id) select(alt, 1); else stop();
    });
    return {
      play, stop, select, setLevel,
      next: dir => select(pick(kind, state[kind].id, dir), dir),
      sync: () => (wanted() ? play() : stop()),
      setMode: () => { el.loop = state[kind].mode === 'one'; if (wanted()) { stop(); play(); } },
      isPlaying: () => !el.paused || !!source
    };
  }
  const channels = { music: makeChannel('music'), ambience: makeChannel('ambience') };
  const soundButton = document.getElementById('soundButton');

  function setSound(on) {
    state.sound = on; save();
    if (on) ensureCtx();
    channels.music.sync(); channels.ambience.sync();
    soundButton.textContent = on ? 'Sound off' : 'Sound on';
    render();
  }
  soundButton.textContent = state.sound ? 'Sound off' : 'Sound on';
  soundButton.addEventListener('click', () => setSound(!state.sound));

  // Every tap: resume an interrupted/suspended AudioContext, retry blocked playback,
  // and (first tap) restore the saved "sound on" preference. iOS requires the gesture.
  document.addEventListener('pointerdown', e => {
    resumeVideo();
    if (e.target.closest('#soundButton')) return;
    if (state.sound) {
      ensureCtx();
      ['music', 'ambience'].forEach(k => { if (state[k].on && !channels[k].isPlaying()) channels[k].play(); });
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseVideo(); channels.music.stop(); channels.ambience.stop();
      if (ctx && ctx.suspend) ctx.suspend().catch(() => {});
    } else {
      resumeVideo();
      if (state.sound) { ensureCtx(); channels.music.sync(); channels.ambience.sync(); }
    }
  });

  // ---------- Player panel ----------
  const panel = document.getElementById('player');
  const panelBody = document.getElementById('playerBody');
  const panelFoot = document.getElementById('playerFoot');
  let tab = 'video';
  const isOpen = () => body.classList.contains('panel-open');

  const LABELS = { available: 'Available', cached: 'Cached', update: 'Update available', missing: 'Missing',
    downloading: 'Downloading', offline: 'Not downloaded', error: 'Download failed' };
  function badgeText(item, s) {
    return s === 'downloading' ? 'Downloading ' + progress[item.id] + '%' : LABELS[s];
  }
  function actionsHtml(item, s) {
    const id = esc(item.id);
    const size = mb(sizes[item.id] || cached.get(keyOf(item)) || 0);
    if (!hasCaches) return '';
    if (s === 'available' || s === 'error') return `<button class="pact" data-act="dl" data-id="${id}">${s === 'error' ? 'Retry' : 'Download'}${size ? ' · ' + size : ''}</button>`;
    if (s === 'update') return `<button class="pact" data-act="dl" data-id="${id}">Update</button><button class="pact ghost" data-act="rm" data-id="${id}">Remove</button>`;
    if (s === 'cached') return `<button class="pact ghost" data-act="rm" data-id="${id}">Remove${size ? ' · ' + size : ''}</button>`;
    return '';
  }
  function badgeHtml(item) {
    const s = statusOf(item);
    return `<span class="badge s-${s}" data-badge="${esc(item.id)}">${badgeText(item, s)}</span>`;
  }
  function modesHtml(kind) {
    return `<div class="seg" role="group" aria-label="Playback mode">` + MODES.map(([m, label]) =>
      `<button data-act="mode" data-kind="${kind}" data-mode="${m}" class="${state[kind].mode === m ? 'on' : ''}">${label}</button>`).join('') + `</div>`;
  }
  function transportHtml(kind) {
    return `<div class="transport"><button data-act="prev" data-kind="${kind}" aria-label="Previous">‹ Prev</button>` +
      `<button data-act="next" data-kind="${kind}" aria-label="Next">Next ›</button></div>`;
  }
  function videoTab() {
    const cards = lists.video.map(item => {
      const s = statusOf(item);
      const cur = currentVideo ? currentVideo.id === item.id : state.video.id === item.id;
      const thumb = item.poster ? `<img src="${esc(keyOf(item, item.poster))}" alt="" loading="lazy" onerror="this.remove()">` : '';
      return `<div class="card${cur ? ' current' : ''}">
        <button class="card-main" data-act="select" data-kind="video" data-id="${esc(item.id)}" ${s === 'missing' ? 'disabled' : ''}>
          <span class="thumb">${thumb}${cur ? '<span class="now">Now playing</span>' : ''}</span>
          <span class="ctitle">${esc(item.title)}</span></button>
        <div class="cmeta">${badgeHtml(item)}${actionsHtml(item, s)}</div></div>`;
    }).join('');
    return `<div class="prow">${modesHtml('video')}${transportHtml('video')}</div><div class="cards">${cards || '<p class="pnote">No videos in library.js</p>'}</div>`;
  }
  function soundTab(kind) {
    const st = state[kind];
    const rows = lists[kind].map(item => {
      const s = statusOf(item);
      const cur = st.id === item.id;
      return `<li class="track${cur ? ' current' : ''}">
        <button class="track-main" data-act="select" data-kind="${kind}" data-id="${esc(item.id)}" ${s === 'missing' ? 'disabled' : ''}>
          <span class="tdot"></span><span class="ttitle">${esc(item.title)}</span></button>
        <div class="tmeta">${badgeHtml(item)}${actionsHtml(item, s)}</div></li>`;
    }).join('');
    const vol = volumeSupported()
      ? `<label class="vol"><span>Volume</span><input type="range" min="0" max="1" step="0.01" value="${st.vol}" data-act="vol" data-kind="${kind}"></label>`
      : `<span class="pnote">Volume: use the iPad volume buttons</span>`;
    const master = state.sound ? '' : `<p class="pnote">Sound is off. <button class="pact" data-act="sound">Turn sound on</button></p>`;
    return `${master}<div class="prow"><button class="switch${st.on ? ' on' : ''}" data-act="toggle" data-kind="${kind}" aria-pressed="${st.on}">
        <span class="knob"></span>${kind === 'music' ? 'Music' : 'Ambience'} ${st.on ? 'on' : 'off'}</button>${vol}</div>
      <div class="prow">${modesHtml(kind)}${transportHtml(kind)}</div>
      <ul class="tracks">${rows || '<p class="pnote">No tracks in library.js</p>'}</ul>`;
  }
  async function renderFoot() {
    let total = 0; cached.forEach(n => total += n);
    let text = hasCaches ? 'Offline media: ' + (mb(total) || '0 MB') : 'Offline storage unavailable in this browser';
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (est.quota) text += ' · about ' + mb(Math.max(0, est.quota - est.usage)) + ' available';
      }
    } catch (_) {}
    const o = orphans();
    panelFoot.innerHTML = esc(text) + (o.length ? ` · <button class="pact ghost" data-act="orphans">Remove ${o.length} unused</button>` : '');
  }
  function render() {
    if (!isOpen()) return;
    panel.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    const scroll = panelBody.scrollTop;
    panelBody.innerHTML = tab === 'video' ? videoTab() : soundTab(tab);
    panelBody.scrollTop = scroll;
    renderFoot();
  }
  function updateBadge(item) {          // progress updates without re-rendering (no image reloads)
    const el = panel.querySelector(`[data-badge="${item.id}"]`);
    if (el) el.textContent = badgeText(item, 'downloading');
  }
  function openPanel() {
    body.classList.add('panel-open');
    panel.setAttribute('aria-hidden', 'false');
    render();
    refreshCache().then(render).then(probeAll);
  }
  function closePanel() {
    body.classList.remove('panel-open');
    panel.setAttribute('aria-hidden', 'true');
  }
  document.getElementById('playerButton').addEventListener('click', openPanel);
  document.getElementById('playerClose').addEventListener('click', closePanel);
  document.getElementById('playerScrim').addEventListener('click', closePanel);
  panel.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));

  panel.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'INPUT') return;
    const kind = b.dataset.kind, item = byId.get(b.dataset.id), act = b.dataset.act;
    if (act === 'dl' && item) download(item);
    else if (act === 'rm' && item) removeItem(item);
    else if (act === 'orphans') removeOrphans();
    else if (act === 'sound') setSound(true);
    else if (act === 'mode') {
      state[kind].mode = b.dataset.mode; save();
      if (kind === 'video') front.loop = state.video.mode === 'one'; else channels[kind].setMode();
      render();
    } else if (act === 'toggle') {
      state[kind].on = !state[kind].on; save();
      if (state[kind].on && state.sound) ensureCtx();
      channels[kind].sync(); render();
    } else if (act === 'prev' || act === 'next') {
      const dir = act === 'next' ? 1 : -1;
      if (kind === 'video') nextVideo(dir); else channels[kind].next(dir);
    } else if (act === 'select' && item) {
      if (kind === 'video') { broken.delete(item.id); if (!currentVideo || item.id !== currentVideo.id) playVideo(item); }
      else { broken.delete(item.id); if (state.sound) ensureCtx(); channels[kind].select(item); }
    }
  });
  panel.addEventListener('input', e => {
    const r = e.target;
    if (r.dataset.act !== 'vol') return;
    state[r.dataset.kind].vol = +r.value;
    channels[r.dataset.kind].setLevel(+r.value, 0.05);
  });
  panel.addEventListener('change', e => { if (e.target.dataset.act === 'vol') save(); });

  // ---------- Public hooks for the existing inline controls ----------
  window.aquariumPlayer = {
    setMotion(paused) { if (paused) pauseVideo(); else resumeVideo(); },
    // Read-only snapshot for debugging (e.g. Safari Web Inspector: aquariumPlayer.status()).
    status: () => ({
      video: currentVideo && currentVideo.id, switching, sound: state.sound, audioContext: ctx ? ctx.state : 'none',
      music: { id: state.music.id, on: state.music.on, playing: channels.music.isPlaying(), mode: state.music.mode },
      ambience: { id: state.ambience.id, on: state.ambience.on, playing: channels.ambience.isPlaying(), mode: state.ambience.mode },
      broken: [...broken]
    })
  };

  // ---------- Start ----------
  refreshCache().then(() => {
    playVideo(byId.get(state.video.id) || lists.video[0]);
  });
})();
