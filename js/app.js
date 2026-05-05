(function () {
  var HISTORY_KEY = 'qrlink_history';
  var historyList = [];

  var stream = null;
  var scanning = false;
  var currentQRUrl = '';
  var scannedUrl = '';
  /** requestAnimationFrame id for QR decode loop */
  var scanRafId = null;
  var lastQrScanTs = 0;
  /** Min ms between decode passes — keeps mobiles smooth while scanning ~12–15 fps */
  var QR_SCAN_INTERVAL_MS = 72;

  // Prevent auto-zoom on iOS input focus
  function preventIOSZoom() {
    if (typeof document === 'undefined') return;
    var inputs = document.querySelectorAll('input[type="text"], input[type="url"], input[type="email"], input[type="number"], textarea');
    inputs.forEach(function(input) {
      input.addEventListener('focus', function() {
        var fontSize = window.getComputedStyle(this).fontSize;
        if (parseInt(fontSize) < 16) {
          this.style.fontSize = '16px';
        }
      });
      input.addEventListener('blur', function() {
        this.style.fontSize = '';
      });
    });
  }

  // Handle orientation changes
  function handleOrientationChange() {
    if (typeof window === 'undefined') return;
    window.addEventListener('orientationchange', function() {
      setTimeout(function() {
        // Recalculate QR size on orientation change
        if (typeof window.updateQrPreview === 'function' && currentQRUrl) {
          window.updateQrPreview(currentQRUrl);
        }
      }, 100);
    });
  }

  function $(id) {
    return document.getElementById(id);
  }

  function loadHistoryFromStorage() {
    try {
      historyList = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      if (!Array.isArray(historyList)) historyList = [];
    } catch (e) {
      historyList = [];
    }
  }

  function showToast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function () {
      t.classList.remove('show');
    }, 2200);
  }

  function syncCameraChrome() {
    var box = $('camera-box');
    var btn = $('camera-btn');
    if (!box || !btn) return;
    var live = !!stream;
    box.classList.toggle('has-stream', live);
    btn.classList.toggle('is-live', live);
    if (!live && btn && btn.dataset) delete btn.dataset.starting;
  }

  function switchTab(tab) {
    var keys = ['generate', 'scan', 'history'];
    var idx = keys.indexOf(tab);
    document.querySelectorAll('.tab').forEach(function (t, i) {
      var on = i === idx;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    keys.forEach(function (k) {
      var p = $('panel-' + k);
      if (!p) return;
      var active = k === tab;
      p.classList.toggle('active', active);
      p.hidden = !active;
    });
    if (tab !== 'scan' && stream) stopCamera();
    if (tab === 'history') renderHistoryList();
  }

  function generateQRFromInput() {
    var input = $('url-input');
    if (!input) return;
    var url = input.value.trim();
    if (!url) {
      showToast('Enter a URL first');
      return;
    }
    currentQRUrl = url;
    var display = $('qr-display');
    if (display) {
      display.removeAttribute('hidden');
      display.style.display = 'flex';
    }
    var label = $('qr-url-label');
    if (label) label.textContent = url;
    if (typeof window.updateQrPreview === 'function') {
      var ok = window.updateQrPreview(url);
      if (!ok) showToast('Could not build QR preview');
    }
  }

  function onDownloadQr() {
    var ok =
      typeof window.downloadQrPng === 'function' ? window.downloadQrPng('qrcode') : false;
    showToast(ok ? 'Downloaded' : 'Nothing to download yet');
  }

  function onCopyQrLink() {
    if (!currentQRUrl) {
      showToast('Generate a QR first');
      return;
    }
    navigator.clipboard.writeText(currentQRUrl).then(
      function () {
        showToast('Link copied');
      },
      function () {
        showToast('Could not copy');
      }
    );
  }

  function saveToHistory(type) {
    var url = type === 'generate' ? currentQRUrl : scannedUrl;
    if (!url) return;
    var entry = { url: url, type: type, time: Date.now() };
    historyList.unshift(entry);
    if (historyList.length > 50) historyList.pop();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(historyList));
    showToast('Saved to history');
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function timeAgo(ts) {
    var diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
  }

  function renderMiniQR(canvas, text) {
    if (typeof QRCode === 'undefined') return;
    var div = document.createElement('div');
    div.style.cssText = 'position:absolute;left:-9999px;';
    document.body.appendChild(div);
    try {
      new QRCode(div, { text: text, width: 40, height: 40, correctLevel: QRCode.CorrectLevel.L });
      setTimeout(function () {
        var src = div.querySelector('canvas');
        if (src) {
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, 40, 40);
          ctx.drawImage(src, 0, 0, 40, 40);
        }
        document.body.removeChild(div);
      }, 80);
    } catch (e) {
      if (div.parentNode) document.body.removeChild(div);
    }
  }

  function renderHistoryList() {
    var list = $('history-list');
    if (!list) return;
    if (!historyList.length) {
      list.innerHTML =
        '<div class="history-empty">Nothing saved yet.<br />Generate or scan a QR code, then tap Save.</div>';
      return;
    }
    list.innerHTML = historyList
      .map(function (e, i) {
        return (
          '<div class="history-item" role="button" tabindex="0" data-history-i="' +
          i +
          '">' +
          '<div class="history-thumb"><canvas id="hthumb-' +
          i +
          '" width="40" height="40"></canvas></div>' +
          '<div class="history-info">' +
          '<div class="history-url">' +
          escapeHtml(e.url) +
          '</div>' +
          '<div class="history-meta">' +
          '<span class="badge ' +
          (e.type === 'generate' ? 'badge-gen' : 'badge-scan') +
          '">' +
          (e.type === 'generate' ? 'Generated' : 'Scanned') +
          '</span>' +
          timeAgo(e.time) +
          '</div></div></div>'
        );
      })
      .join('');

    historyList.forEach(function (e, i) {
      setTimeout(function () {
        var c = $('hthumb-' + i);
        if (c) renderMiniQR(c, e.url);
      }, i * 20);
    });
  }

  function loadHistoryItem(i) {
    var e = historyList[i];
    if (!e) return;
    if (e.type === 'generate') {
      $('url-input').value = e.url;
      currentQRUrl = e.url;
      switchTab('generate');
      generateQRFromInput();
    } else {
      scannedUrl = e.url;
      switchTab('scan');
      var sr = $('scan-result');
      var su = $('scan-url');
      if (sr) {
        sr.removeAttribute('hidden');
        sr.style.display = 'block';
      }
      if (su) su.textContent = e.url;
    }
  }

  function clearHistory() {
    historyList = [];
    localStorage.setItem(HISTORY_KEY, '[]');
    renderHistoryList();
    showToast('History cleared');
  }

  /** Try rear camera first, then front, then generic — covers desktop without environment cam. */
  async function acquireVideoStream() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function')
      throw new Error('unsupported');
    var constraints = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
      { video: { facingMode: 'environment' } },
      { video: { facingMode: 'user' } },
      { video: true },
    ];
    var lastErr;
    for (var i = 0; i < constraints.length; i++) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints[i]);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('no stream');
  }

  /** attemptBoth covers light-on-dark QR; fallback is plain decode. */
  function decodeWithJsQR(data, w, h) {
    var dec = typeof window !== 'undefined' ? window.jsQR : null;
    if (typeof dec !== 'function') return null;
    try {
      var code = dec(data, w, h, { inversionAttempts: 'attemptBoth' });
      if (code && code.data) return code;
    } catch (e) {}
    try {
      var plain = dec(data, w, h);
      if (plain && plain.data) return plain;
    } catch (e2) {}
    try {
      var inv = dec(data, w, h, { inversionAttempts: 'onlyInvert' });
      if (inv && inv.data) return inv;
    } catch (e3) {}
    return null;
  }

  /** Longest side cap — enough detail without crushing small codes with blur/downscale artefacts */
  var MAX_SCAN_LONG_SIDE = 1280;

  function scaleForBounds(sw, sh) {
    var long = Math.max(sw, sh);
    if (!long || long <= MAX_SCAN_LONG_SIDE) return 1;
    return MAX_SCAN_LONG_SIDE / long;
  }

  /**
   * Draw a region of the video into canvas and decode. Resets canvas size → must re-fetch 2d context.
   */
  function decodeRegion(video, canvas, sx, sy, rw, rh) {
    var sc = scaleForBounds(rw, rh);
    var tw = Math.max(2, Math.floor(rw * sc));
    var th = Math.max(2, Math.floor(rh * sc));

    canvas.width = tw;
    canvas.height = th;

    var ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!ctx) return null;

    ctx.imageSmoothingEnabled = false;
    if ('mozImageSmoothingEnabled' in ctx) ctx.mozImageSmoothingEnabled = false;
    if ('webkitImageSmoothingEnabled' in ctx) ctx.webkitImageSmoothingEnabled = false;
    if ('msImageSmoothingEnabled' in ctx) ctx.msImageSmoothingEnabled = false;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'low';

    try {
      ctx.drawImage(video, sx, sy, rw, rh, 0, 0, tw, th);
      var img = ctx.getImageData(0, 0, tw, th);
      return decodeWithJsQR(img.data, tw, th);
    } catch (drawErr) {
      return null;
    }
  }

  /** Full frame then tighter center crops (helps when the code is small in the viewfinder). */
  function scanVideoForQrCode(video, canvas) {
    var vw = video.videoWidth;
    var vh = video.videoHeight;
    if (!vw || !vh) return null;

    var crops = [{ frac: 0.55 }, { frac: 0.38 }];

    var i,
      cw,
      ch,
      csx,
      csy,
      code = null;

    code = decodeRegion(video, canvas, 0, 0, vw, vh);
    if (code) return code;

    for (i = 0; i < crops.length; i++) {
      var frac = crops[i].frac;
      cw = vw * frac;
      ch = vh * frac;
      csx = (vw - cw) / 2;
      csy = (vh - ch) / 2;
      code = decodeRegion(video, canvas, csx, csy, cw, ch);
      if (code) return code;
    }

    return null;
  }

  function stopScanLoop() {
    if (scanRafId != null) {
      cancelAnimationFrame(scanRafId);
      scanRafId = null;
    }
  }

  function scanLoop() {
    scanRafId = null;
    if (!scanning || !stream) return;
    if (document.visibilityState === 'hidden') return;
    var now =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
    if (now - lastQrScanTs >= QR_SCAN_INTERVAL_MS) {
      lastQrScanTs = now;
      scanFrameOnce();
    }
    scanRafId = requestAnimationFrame(scanLoop);
  }

  function startScanLoop() {
    stopScanLoop();
    if (!scanning || !stream) return;
    scanRafId = requestAnimationFrame(scanLoop);
  }

  function waitForVideoReady(video, timeoutMs) {
    return new Promise(function (resolve) {
      if (!video) {
        resolve();
        return;
      }
      function readyEnough() {
        return video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2;
      }
      if (readyEnough()) {
        resolve();
        return;
      }
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        video.removeEventListener('loadedmetadata', tryResolve);
        video.removeEventListener('loadeddata', tryResolve);
        video.removeEventListener('canplay', tryResolve);
        clearTimeout(timer);
        resolve();
      }
      function tryResolve() {
        if (readyEnough()) finish();
      }
      video.addEventListener('loadedmetadata', tryResolve);
      video.addEventListener('loadeddata', tryResolve);
      video.addEventListener('canplay', tryResolve);
      var timer = setTimeout(finish, timeoutMs || 8000);
    });
  }

  function toastForCameraError(e) {
    var name = e && e.name ? e.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError')
      showToast('Camera blocked — allow access in browser settings.');
    else if (name === 'NotFoundError' || name === 'OverconstrainedError')
      showToast('No usable camera — check devices or cables.');
    else if (name === 'NotReadableError')
      showToast('Camera is busy — close other apps using it.');
    else if (name === 'unsupported')
      showToast('Camera needs HTTPS or localhost.');
    else showToast('Could not open camera.');
  }

  async function toggleCamera() {
    if (stream) {
      stopCamera();
      return;
    }
    var cb = $('camera-btn');
    if (cb && cb.dataset.starting === '1') return;
    if (cb) {
      cb.dataset.starting = '1';
      cb.disabled = true;
      cb.setAttribute('aria-busy', 'true');
      cb.textContent = 'Starting…';
    }
    try {
      stream = await acquireVideoStream();

      if (typeof window.jsQR !== 'function') {
        stream.getTracks().forEach(function (t) {
          t.stop();
        });
        stream = null;
        throw new Error('noscan');
      }

      var video = $('video');
      if (video) {
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.muted = true;
        video.setAttribute('muted', '');
        video.playsInline = true;
        video.srcObject = stream;
        await video.play().catch(function () {});
        await waitForVideoReady(video, 8000);
      }

      if (!video || !video.videoWidth) {
        stream.getTracks().forEach(function (t) {
          t.stop();
        });
        stream = null;
        throw new Error('novideo');
      }

      if (cb) {
        cb.textContent = 'Stop camera';
        cb.disabled = false;
        cb.removeAttribute('aria-busy');
        delete cb.dataset.starting;
      }
      scanning = true;
      startScanLoop();
      syncCameraChrome();
    } catch (e) {
      stopScanLoop();
      if (cb) {
        cb.textContent = 'Start camera';
        cb.disabled = false;
        cb.removeAttribute('aria-busy');
        delete cb.dataset.starting;
      }
      stream = null;
      scanning = false;
      if (e && e.message === 'noscan')
        showToast('QR reader failed to load. Check connection and refresh the page.');
      else if (e && e.message === 'novideo')
        showToast('Camera preview not ready yet — try Stop, then Start again.');
      else toastForCameraError(e);
      syncCameraChrome();
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
      stream = null;
    }
    scanning = false;
    stopScanLoop();
    var cb = $('camera-btn');
    if (cb) {
      cb.textContent = 'Start camera';
      cb.disabled = false;
      cb.removeAttribute('aria-busy');
      delete cb.dataset.starting;
    }
    var video = $('video');
    if (video) {
      video.srcObject = null;
    }
    syncCameraChrome();
  }

  function scanFrameOnce() {
    var video = $('video');
    if (!scanning || !stream || document.visibilityState === 'hidden') return;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    var canvas = $('scan-canvas');
    if (!canvas || typeof window.jsQR !== 'function') return;

    var code = scanVideoForQrCode(video, canvas);

    if (code && code.data) {
      scannedUrl = code.data;
      var sr = $('scan-result');
      var su = $('scan-url');
      if (sr) {
        sr.removeAttribute('hidden');
        sr.style.display = 'block';
      }
      if (su) su.textContent = code.data;
      stopCamera();
      showToast('QR code detected');
    }
  }

  function openScannedLink() {
    if (scannedUrl) window.open(scannedUrl, '_blank', 'noopener,noreferrer');
  }

  /** WireCustomize + swatches */
  var PRESETS = {
    classic: { dots: 'square', corners: 'square', cornerDot: 'square' },
    soft: { dots: 'rounded', corners: 'rounded', cornerDot: 'dot' },
    dots: { dots: 'dots', corners: 'dot', cornerDot: 'dot' },
    bold: { dots: 'square', corners: 'extra-rounded', cornerDot: 'dot' },
  };

  function applyShapePreset(key) {
    var p = PRESETS[key];
    if (!p) return;
    var d = $('qr-dots-type');
    var sq = $('qr-corners-square');
    var dq = $('qr-corners-dot');
    if (d) d.value = p.dots;
    if (sq) sq.value = p.corners;
    if (dq) dq.value = p.cornerDot;
    refreshStyleAfterChange();
    syncPresetChipState();
  }

  function shapesMatchPreset(presetKey) {
    var p = PRESETS[presetKey];
    if (!p) return false;
    var d = $('qr-dots-type');
    var sq = $('qr-corners-square');
    var dq = $('qr-corners-dot');
    if (!d || !sq || !dq) return false;
    return d.value === p.dots && sq.value === p.corners && dq.value === p.cornerDot;
  }

  function syncPresetChipState() {
    document.querySelectorAll('.preset-chip[data-preset]').forEach(function (btn) {
      var key = btn.getAttribute('data-preset');
      var match = !!key && shapesMatchPreset(key);
      btn.setAttribute('aria-pressed', match ? 'true' : 'false');
    });
  }

  function refreshStyleAfterChange() {
    if (typeof window.saveQrStylePrefs === 'function') window.saveQrStylePrefs();
    if (typeof window.refreshQrPreviewIfNeeded === 'function')
      window.refreshQrPreviewIfNeeded(currentQRUrl);
  }

  function syncQrMarginLabel() {
    var m = $('qr-margin');
    var mv = $('qr-margin-val');
    if (m && mv) mv.textContent = m.value + ' px';
  }

  function wireCustomizeControls() {
    syncQrMarginLabel();
    syncPresetChipState();

    document.querySelectorAll('.preset-chip[data-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-preset');
        if (key) applyShapePreset(key);
      });
    });

    var fg = $('qr-fg');
    var fgSwatches = document.querySelectorAll('[data-fg-swatch]');
    fgSwatches.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var c = btn.getAttribute('data-fg-swatch');
        if (fg && c) fg.value = c;
        if (typeof window.syncSwatchAria === 'function') window.syncSwatchAria();
        refreshStyleAfterChange();
      });
    });

    if (fg) {
      fg.addEventListener('input', function () {
        if (typeof window.syncSwatchAria === 'function') window.syncSwatchAria();
        refreshStyleAfterChange();
      });
    }

    var bgTransparent = $('qr-bg-transparent');
    var bgPicker = $('qr-bg');
    if (bgTransparent) {
      bgTransparent.addEventListener('change', function () {
        if (typeof window.updateBgControlsState === 'function')
          window.updateBgControlsState();
        refreshStyleAfterChange();
      });
    }
    if (bgPicker) {
      bgPicker.addEventListener('input', function () {
        refreshStyleAfterChange();
      });
    }

    ['qr-dots-type', 'qr-corners-square', 'qr-corners-dot', 'qr-margin', 'qr-error-correction'].forEach(
      function (id) {
        var node = $(id);
        if (!node) return;
        var handler = function () {
          refreshStyleAfterChange();
          if (['qr-dots-type', 'qr-corners-square', 'qr-corners-dot'].indexOf(id) !== -1)
            syncPresetChipState();
        };
        node.addEventListener('change', handler);
        if (id === 'qr-margin') {
          node.addEventListener('input', function () {
            syncQrMarginLabel();
            handler();
          });
        }
      }
    );
  }

  function wireScanVisibilityPause() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        stopScanLoop();
      } else if (scanning && stream) {
        startScanLoop();
      }
    });
  }

  function wireMainButtons() {
    $('tab-generate') &&
      $('tab-generate').addEventListener('click', function () {
        switchTab('generate');
      });
    $('tab-scan') &&
      $('tab-scan').addEventListener('click', function () {
        switchTab('scan');
      });
    $('tab-history') &&
      $('tab-history').addEventListener('click', function () {
        switchTab('history');
      });

    var genBtn = $('btn-generate');
    if (genBtn) genBtn.addEventListener('click', generateQRFromInput);

    var dl = $('btn-download-qr');
    if (dl) dl.addEventListener('click', onDownloadQr);
    var sav = $('btn-save-qr');
    if (sav)
      sav.addEventListener('click', function () {
        saveToHistory('generate');
      });
    var copy = $('btn-copy-link');
    if (copy) copy.addEventListener('click', onCopyQrLink);

    var camBtn = $('camera-btn');
    if (camBtn) camBtn.addEventListener('click', toggleCamera);
    $('btn-open-scan') &&
      $('btn-open-scan').addEventListener('click', openScannedLink);
    $('btn-save-scan') &&
      $('btn-save-scan').addEventListener('click', function () {
        saveToHistory('scan');
      });

    $('btn-clear-history') &&
      $('btn-clear-history').addEventListener('click', clearHistory);

    var listRoot = $('history-list');
    if (listRoot) {
      listRoot.addEventListener('click', function (ev) {
        var row = ev.target.closest('[data-history-i]');
        if (!row) return;
        var i = parseInt(row.getAttribute('data-history-i'), 10);
        if (!isNaN(i)) loadHistoryItem(i);
      });
      listRoot.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        var row = ev.target.closest('[data-history-i]');
        if (!row) return;
        ev.preventDefault();
        var i = parseInt(row.getAttribute('data-history-i'), 10);
        if (!isNaN(i)) loadHistoryItem(i);
      });
    }
  }

  function init() {
    loadHistoryFromStorage();

    var saved = typeof window.loadQrStylePrefs === 'function' ? window.loadQrStylePrefs() : {};
    if (saved && typeof window.applyQrStylePrefsToForm === 'function')
      window.applyQrStylePrefsToForm(saved);
    else {
      if (typeof window.updateBgControlsState === 'function') window.updateBgControlsState();
      if (typeof window.syncSwatchAria === 'function') window.syncSwatchAria();
    }

    // Mobile optimizations
    preventIOSZoom();
    handleOrientationChange();

    wireCustomizeControls();
    wireMainButtons();
    wireScanVisibilityPause();

    window.addEventListener('resize', function () {
      if (typeof window.refreshQrPreviewIfNeeded === 'function')
        window.refreshQrPreviewIfNeeded(currentQRUrl);
    });

    switchTab('generate');
    syncCameraChrome();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /** Optional: expose for debugging */
  window.__qrApp = {
    generateQRFromInput,
    switchTab,
  };
})();
