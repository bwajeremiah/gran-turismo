/* GT7 voice coach: plays the mp3 clips in /static/audio/ when the server says so.
 * - Gets events from /ws/voice (separate from the telemetry socket)
 * - Clips with no mp3 (speeds, distances, anything missing) use the device voice
 * - Higher-priority calls (e.g. "Brake now") interrupt lower ones
 * - Stale calls are dropped so you never hear advice for a corner you already passed
 */
(function () {
  'use strict';

  var AUDIO_DIR = '/static/audio/';
  var CLIP_NAMES = [
    'brake_later', 'brake_now', 'brake_to', 'trail_brake_good', 'trail_brake',
    'more_throttle', 'apply_throttle', 'hold_speed', 'good_speed', 'carry_more_speed',
    'shift_up', 'shift_down', 'upshift_limit', 'downshift',
    'pit_in', 'recording_lap', 'comparing',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
    'in', 'meters'
  ];
  var STALE_MS = 1500;   // drop calls older than this
  var GAP_MS = 120;      // pause between calls
  var MAX_QUEUE = 4;
  var TTS_RATE = 1.15;

  var player = new Audio();
  player.preload = 'auto';
  var blobs = {};        // clip name -> object URL
  var queue = [];
  var current = null;    // {ev, cancelled, finish}
  var unlocked = false;
  var muted = false;
  var ws = null;
  var btn = null;

  try { muted = localStorage.getItem('gt7voice') === 'off'; } catch (e) {}

  /* ---------- playback ---------- */

  function speak(text, job) {
    return new Promise(function (resolve) {
      if (!window.speechSynthesis || !text) { resolve(); return; }
      var u = new SpeechSynthesisUtterance(text);
      u.rate = TTS_RATE;
      u.onend = resolve;
      u.onerror = resolve;
      job.finish = resolve;
      window.speechSynthesis.speak(u);
    });
  }

  function playPart(part, job) {
    if (part.clip && blobs[part.clip]) {
      return new Promise(function (resolve) {
        job.finish = resolve;
        player.onended = resolve;
        player.onerror = resolve;
        player.src = blobs[part.clip];
        var p = player.play();
        if (p && p.catch) { p.catch(resolve); }
      });
    }
    return speak(part.text, job);
  }

  function stopCurrent() {
    if (!current) { return; }
    current.cancelled = true;
    try { player.pause(); } catch (e) {}
    if (window.speechSynthesis) { window.speechSynthesis.cancel(); }
    if (current.finish) { current.finish(); }
  }

  function runEvent(ev) {
    var job = { ev: ev, cancelled: false, finish: null };
    var i = 0;
    current = job;

    function done() {
      if (current === job) { current = null; }
      setTimeout(pump, GAP_MS);
    }
    function next() {
      if (job.cancelled || i >= ev.parts.length) { done(); return; }
      playPart(ev.parts[i++], job).then(next);
    }
    next();
  }

  function pump() {
    if (muted || !unlocked) { queue = []; return; }
    var now = Date.now();
    queue = queue.filter(function (e) { return now - e.t < STALE_MS; });
    if (!queue.length) { return; }
    queue.sort(function (a, b) { return (b.priority - a.priority) || (a.t - b.t); });

    if (current) {
      if (queue[0].priority > current.ev.priority) {
        var urgent = queue.shift();
        stopCurrent();
        runEvent(urgent);
      }
      return;
    }
    runEvent(queue.shift());
  }

  function enqueue(ev) {
    if (!ev || !ev.parts) { return; }
    ev.t = Date.now();
    queue.push(ev);
    if (queue.length > MAX_QUEUE) {
      queue.sort(function (a, b) { return b.priority - a.priority; });
      queue.length = MAX_QUEUE;
    }
    pump();
  }

  /* ---------- loading / unlocking ---------- */

  function makeSilentWav() {
    var n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function s(o, str) { for (var i = 0; i < str.length; i++) { v.setUint8(o + i, str.charCodeAt(i)); } }
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true);
    v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  function loadClips() {
    var loaded = 0;
    var jobs = CLIP_NAMES.map(function (name) {
      return fetch(AUDIO_DIR + name + '.mp3')
        .then(function (r) { return r.ok ? r.blob() : null; })
        .then(function (b) {
          if (b && b.size > 0) { blobs[name] = URL.createObjectURL(b); loaded++; }
        })
        .catch(function () {});
    });
    return Promise.all(jobs).then(function () {
      var missing = CLIP_NAMES.filter(function (n) { return !blobs[n]; });
      if (missing.length) {
        console.info('[voice] no mp3 for (using device voice instead): ' + missing.join(', '));
      }
      return loaded;
    });
  }

  function unlock() {
    // Must run inside the tap so iOS allows audio later.
    player.src = makeSilentWav();
    var p = player.play();
    if (p && p.catch) { p.catch(function () {}); }
    if (window.speechSynthesis) {
      var u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
    unlocked = true;
    muted = false;
    try { localStorage.setItem('gt7voice', 'on'); } catch (e) {}
    setLabel('\uD83D\uDD0A Loading voice\u2026');
    loadClips().then(function (n) {
      setLabel('\uD83D\uDD0A Voice on');
      btn.title = n + ' of ' + CLIP_NAMES.length + ' clips found';
      enqueue({ id: 'test', priority: 5, parts: [{ clip: 'good_speed', text: 'Voice on' }] });
    });
  }

  /* ---------- UI ---------- */

  function setLabel(t) { if (btn) { btn.textContent = t; } }

  function onButton() {
    if (!unlocked) { unlock(); return; }
    muted = !muted;
    try { localStorage.setItem('gt7voice', muted ? 'off' : 'on'); } catch (e) {}
    if (muted) {
      queue = [];
      stopCurrent();
      setLabel('\uD83D\uDD07 Voice off');
    } else {
      setLabel('\uD83D\uDD0A Voice on');
    }
  }

  function buildButton() {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '\uD83D\uDD08 Tap to enable voice';
    btn.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99999;' +
      'padding:10px 16px;border-radius:999px;border:1px solid rgba(255,255,255,.35);' +
      'background:rgba(20,20,20,.88);color:#fff;font:600 14px -apple-system,system-ui,sans-serif;' +
      'cursor:pointer;-webkit-tap-highlight-color:transparent;';
    btn.addEventListener('click', onButton);
    document.body.appendChild(btn);
  }

  /* ---------- server connection ---------- */

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws/voice');
    ws.onmessage = function (m) {
      try {
        var d = JSON.parse(m.data);
        (d.events || []).forEach(enqueue);
      } catch (e) {}
    };
    ws.onclose = function () { setTimeout(connect, 2000); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  function init() { buildButton(); connect(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
