(function (global) {
  var STORAGE_STYLE = 'qrlink_style_prefs';
  var qrInstance = null;

  function el(id) {
    return document.getElementById(id);
  }

  function getPixelSize() {
    var panel = el('panel-generate');
    var w = panel ? panel.clientWidth : 320;
    var cap = Math.min(280, Math.floor(window.innerWidth - 48));
    var raw = Math.floor(Math.min(cap, w - 36));
    return Math.max(160, Math.min(280, raw));
  }

  /** @returns {{
   * fg: string, bgTransparent: boolean, bg: string,
   * dotsType: string, cornersSquareType: string, cornersDotType: string,
   * margin: number, qrErrorCorrection: string
   * }} */
  function readPrefsFromForm() {
    var margin = parseInt(el('qr-margin').value, 10);
    var ecEl = el('qr-error-correction');
    var ec = ecEl ? ecEl.value : 'M';
    return {
      fg: el('qr-fg').value || '#0f172a',
      bgTransparent: el('qr-bg-transparent').checked,
      bg: el('qr-bg').value || '#ffffff',
      dotsType: el('qr-dots-type').value || 'square',
      cornersSquareType: el('qr-corners-square').value || 'square',
      cornersDotType: el('qr-corners-dot').value || 'square',
      margin: isFinite(margin) ? Math.max(0, Math.min(24, margin)) : 10,
      qrErrorCorrection: ec || 'M',
    };
  }

  /** @param {Record<string, unknown>} p */
  function writePrefsToForm(p) {
    if (!p || typeof p !== 'object') return;
    if (p.fg != null && el('qr-fg')) el('qr-fg').value = String(p.fg);
    if (p.bgTransparent != null && el('qr-bg-transparent')) el('qr-bg-transparent').checked = !!p.bgTransparent;
    if (p.bg != null && el('qr-bg')) el('qr-bg').value = String(p.bg);
    if (p.dotsType != null && el('qr-dots-type')) el('qr-dots-type').value = String(p.dotsType);
    if (p.cornersSquareType != null && el('qr-corners-square')) el('qr-corners-square').value = String(p.cornersSquareType);
    if (p.cornersDotType != null && el('qr-corners-dot')) el('qr-corners-dot').value = String(p.cornersDotType);
    if (p.margin != null && el('qr-margin')) el('qr-margin').value = String(Math.max(0, Math.min(24, Number(p.margin))));
    if (p.qrErrorCorrection != null && el('qr-error-correction')) el('qr-error-correction').value = String(p.qrErrorCorrection);
  }

  global.loadQrStylePrefs = function () {
    try {
      var raw = global.localStorage.getItem(STORAGE_STYLE);
      if (!raw) return {};
      var o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : {};
    } catch (e) {
      return {};
    }
  };

  global.saveQrStylePrefs = function () {
    try {
      global.localStorage.setItem(STORAGE_STYLE, JSON.stringify(readPrefsFromForm()));
    } catch (e) {}
  };

  global.applyQrStylePrefsToForm = function (prefs) {
    writePrefsToForm(prefs);
    global.updateBgControlsState();
    global.syncSwatchAria();
  };

  global.collectQrStylePrefs = readPrefsFromForm;

  /** Map transparent background */
  function backgroundColor(pref) {
    if (pref.bgTransparent) return 'rgba(255,255,255,0)';
    return pref.bg;
  }

  /**
   * @param {string} data
   * @param {number} sizePx
   * @param {{ fg: string, bgTransparent: boolean, bg: string, dotsType: string,
   *   cornersSquareType: string, cornersDotType: string, margin: number,
   *   qrErrorCorrection: string }} prefs
   */
  function buildOptions(data, sizePx, prefs) {
    var fg = prefs.fg;
    var margin = prefs.margin;

    var opts = {
      type: 'canvas',
      shape: 'square',
      width: sizePx,
      height: sizePx,
      margin: margin,
      data: data,
      qrOptions: {
        errorCorrectionLevel: prefs.qrErrorCorrection,
      },
      imageOptions: { hideBackgroundDots: true, imageSize: 0.4, margin: 0 },
      dotsOptions: {
        type: prefs.dotsType,
        color: fg,
      },
      cornersSquareOptions: {
        type: prefs.cornersSquareType,
        color: fg,
      },
      cornersDotOptions: {
        type: prefs.cornersDotType,
        color: fg,
      },
      backgroundOptions: {
        color: backgroundColor(prefs),
        round: 0,
      },
    };
    return opts;
  }

  global.updateQrPreview = function (data) {
    var mount = el('qr-mount');
    if (!mount || !data || typeof data !== 'string') return false;
    if (typeof QRCodeStyling !== 'function') {
      console.warn('QRCodeStyling missing');
      return false;
    }
    var size = getPixelSize();
    var prefs = readPrefsFromForm();
    mount.innerHTML = '';
    var opts = buildOptions(data, size, prefs);
    qrInstance = new QRCodeStyling(opts);
    qrInstance.append(mount);
    return true;
  };

  global.refreshQrPreviewIfNeeded = function (currentUrl) {
    var disp = el('qr-display');
    if (!disp || disp.style.display === 'none') return;
    if (!currentUrl) return;
    global.updateQrPreview(currentUrl);
  };

  global.downloadQrPng = function (baseName) {
    if (!qrInstance) return false;
    var name = (baseName || 'qrcode').replace(/\.[^/.]+$/, '');
    qrInstance.download({ name: name, extension: 'png' });
    return true;
  };

  /** Enable/disable BG color picker + wrapper */
  global.updateBgControlsState = function () {
    var trans = el('qr-bg-transparent');
    var bgInput = el('qr-bg');
    var wrap = el('qr-bg-wrap');
    if (!trans || !bgInput || !wrap) return;
    var off = !!trans.checked;
    bgInput.disabled = off;
    wrap.classList.toggle('is-disabled', off);
  };

  global.syncSwatchAria = function () {
    var fg = el('qr-fg');
    if (!fg) return;
    var v = (fg.value || '').toLowerCase();
    document.querySelectorAll('[data-fg-swatch]').forEach(function (btn) {
      var bc = btn.getAttribute('data-fg-swatch');
      btn.setAttribute('aria-current', bc && bc.toLowerCase() === v ? 'true' : 'false');
    });
  };

  /** @returns {typeof getPixelSize} */
  global.getQrPixelSize = getPixelSize;
})(typeof window !== 'undefined' ? window : globalThis);
