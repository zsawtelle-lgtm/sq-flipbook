/*!
 * sq-flipbook.js — self-hosted PDF flipbook for Squarespace code blocks
 * Renders a PDF with PDF.js, flips it with StPageFlip (page-flip, MIT).
 *
 * Usage (one code block, Business plan or higher):
 *   <div class="sq-flipbook" data-pdf="/s/owners-manual.pdf"></div>
 *   <script src="https://cdn.jsdelivr.net/gh/USER/REPO@1/sq-flipbook.js" defer><\/script>
 *
 * Optional data- attributes on the div:
 *   data-cover="true"      first and last page are hard covers (default true)
 *   data-scale="1.5"       render sharpness multiplier, 1–2 (default 1.5)
 *   data-shadow="0.6"      flip shadow opacity 0–1 (default 0.6)
 *   data-speed="800"       flip duration in ms (default 800)
 *   data-download="true"   show a Download button (default true)
 *   data-max-width="1100"  max book width in px (default 1100)
 *   data-accent="#0057b8"  control color (default: inherits currentColor)
 */
(function () {
  'use strict';

  var PDFJS_URL   = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  var PDFJS_WORKER= 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  var PAGEFLIP_URL= 'https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.min.js';

  /* ---------- styles (injected once) ---------- */
  var CSS = [
    '.sq-flipbook{--sqfb-accent:currentColor;--sqfb-bg:transparent;position:relative;width:100%;max-width:var(--sqfb-max,1100px);margin:0 auto;font-family:inherit;color:inherit}',
    '.sq-flipbook__stage{position:relative;background:var(--sqfb-bg)}',
    '.sq-flipbook__book{position:relative;width:100%;margin:0 auto}',
    /* static spine shadow, only in two-page (landscape) mode */
    '.sq-flipbook__spine{position:absolute;top:0;bottom:0;left:50%;width:80px;transform:translateX(-50%);pointer-events:none;z-index:2;opacity:0;transition:opacity .25s;',
      'background:linear-gradient(90deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.10) 44%,rgba(0,0,0,.22) 50%,rgba(0,0,0,.10) 56%,rgba(0,0,0,0) 100%)}',
    '.sq-flipbook--landscape .sq-flipbook__spine{opacity:1}',
    '.sq-flipbook--flipping .sq-flipbook__spine{opacity:0}',
    '.sq-flipbook__loading{display:flex;align-items:center;justify-content:center;gap:12px;min-height:240px;font-size:.9em;opacity:.7}',
    '.sq-flipbook__bar{height:3px;width:160px;background:rgba(127,127,127,.25);border-radius:2px;overflow:hidden}',
    '.sq-flipbook__bar i{display:block;height:100%;width:0;background:var(--sqfb-accent);transition:width .2s}',
    '.sq-flipbook__error{padding:24px;text-align:center;opacity:.8}',
    '.sq-flipbook__controls{display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:14px;font-size:.9em}',
    '.sq-flipbook__controls button,.sq-flipbook__controls a{appearance:none;background:none;border:1px solid rgba(127,127,127,.35);border-radius:999px;color:var(--sqfb-accent);cursor:pointer;font:inherit;line-height:1;padding:8px 14px;display:inline-flex;align-items:center;gap:6px;text-decoration:none;transition:border-color .15s,background .15s}',
    '.sq-flipbook__controls button:hover,.sq-flipbook__controls a:hover{border-color:var(--sqfb-accent)}',
    '.sq-flipbook__controls button:focus-visible,.sq-flipbook__controls a:focus-visible{outline:2px solid var(--sqfb-accent);outline-offset:2px}',
    '.sq-flipbook__controls button[disabled]{opacity:.35;cursor:default}',
    '.sq-flipbook__count{padding:0 10px;font-variant-numeric:tabular-nums;opacity:.8;min-width:80px;text-align:center}',
    '.sq-flipbook__controls svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    /* fullscreen */
    '.sq-flipbook:fullscreen{max-width:none;background:#1c1c1c;color:#fff;padding:24px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center}',
    '.sq-flipbook:fullscreen .sq-flipbook__book{max-width:min(96vw,calc((100vh - 110px) * var(--sqfb-spread-ratio,1.4)))}',
    '@media (prefers-reduced-motion:reduce){.sq-flipbook__spine{transition:none}}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('sq-flipbook-css')) return;
    var s = document.createElement('style');
    s.id = 'sq-flipbook-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- script loader ---------- */
  var pending = {};
  function loadScript(src, test) {
    if (test()) return Promise.resolve();
    if (pending[src]) return pending[src];
    pending[src] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = res;
      s.onerror = function () { rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
    return pending[src];
  }

  var ICONS = {
    prev: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
    full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16"/></svg>'
  };

  /* ---------- one book ---------- */
  function Flipbook(root) {
    this.root = root;
    this.pdfUrl = root.getAttribute('data-pdf');
    this.opts = {
      cover:    root.getAttribute('data-cover') !== 'false',
      scale:    Math.min(2, Math.max(1, parseFloat(root.getAttribute('data-scale')) || 1.5)),
      shadow:   parseFloat(root.getAttribute('data-shadow')) || 0.6,
      speed:    parseInt(root.getAttribute('data-speed'), 10) || 800,
      download: root.getAttribute('data-download') !== 'false',
      maxWidth: parseInt(root.getAttribute('data-max-width'), 10) || 1100,
      accent:   root.getAttribute('data-accent')
    };
    root.style.setProperty('--sqfb-max', this.opts.maxWidth + 'px');
    if (this.opts.accent) root.style.setProperty('--sqfb-accent', this.opts.accent);
    this.build();
    this.load();
  }

  Flipbook.prototype.build = function () {
    var r = this.root;
    r.innerHTML =
      '<div class="sq-flipbook__stage">' +
        '<div class="sq-flipbook__loading" role="status">' +
          '<span class="sq-flipbook__loading-text">Loading document</span>' +
          '<span class="sq-flipbook__bar"><i></i></span>' +
        '</div>' +
        '<div class="sq-flipbook__book" hidden></div>' +
        '<div class="sq-flipbook__spine"></div>' +
      '</div>' +
      '<div class="sq-flipbook__controls" hidden>' +
        '<button type="button" data-act="prev" aria-label="Previous page">' + ICONS.prev + '</button>' +
        '<span class="sq-flipbook__count" aria-live="polite"></span>' +
        '<button type="button" data-act="next" aria-label="Next page">' + ICONS.next + '</button>' +
        '<button type="button" data-act="full" aria-label="Full screen">' + ICONS.full + '</button>' +
        (this.opts.download
          ? '<a href="' + this.pdfUrl + '" download target="_blank" rel="noopener">' + ICONS.down + '<span>Download</span></a>'
          : '') +
      '</div>';
    this.$ = {
      loading:  r.querySelector('.sq-flipbook__loading'),
      loadText: r.querySelector('.sq-flipbook__loading-text'),
      bar:      r.querySelector('.sq-flipbook__bar i'),
      book:     r.querySelector('.sq-flipbook__book'),
      controls: r.querySelector('.sq-flipbook__controls'),
      count:    r.querySelector('.sq-flipbook__count'),
      prev:     r.querySelector('[data-act="prev"]'),
      next:     r.querySelector('[data-act="next"]'),
      full:     r.querySelector('[data-act="full"]')
    };
  };

  Flipbook.prototype.fail = function (msg) {
    this.$.loading.outerHTML = '<div class="sq-flipbook__error">' + msg +
      (this.pdfUrl ? ' <a href="' + this.pdfUrl + '" target="_blank" rel="noopener">Open the PDF</a>' : '') + '</div>';
  };

  Flipbook.prototype.load = function () {
    var self = this;
    if (!this.pdfUrl) return this.fail('No PDF set. Add data-pdf="/s/your-file.pdf".');

    Promise.all([
      loadScript(PDFJS_URL, function () { return !!window.pdfjsLib; }),
      loadScript(PAGEFLIP_URL, function () { return !!(window.St && window.St.PageFlip); })
    ])
    .then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return window.pdfjsLib.getDocument({ url: self.pdfUrl }).promise;
    })
    .then(function (pdf) { return self.render(pdf); })
    .then(function (pages) { self.mount(pages); })
    .catch(function (err) {
      console.error('[sq-flipbook]', err);
      self.fail('The document could not be displayed.');
    });
  };

  /* Render every page to an image URL. Sequential keeps memory flat. */
  Flipbook.prototype.render = function (pdf) {
    var self = this, total = pdf.numPages, urls = [], i = 1;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var baseWidth = Math.min(self.root.clientWidth || 900, self.opts.maxWidth) / 2; // one page = half the spread
    var pixelScale = self.opts.scale * dpr;

    function next() {
      if (i > total) return urls;
      return pdf.getPage(i).then(function (page) {
        var vp1 = page.getViewport({ scale: 1 });
        if (i === 1) { self.pageW = vp1.width; self.pageH = vp1.height; }
        var scale = (baseWidth * pixelScale) / vp1.width;
        var vp = page.getViewport({ scale: scale });
        var c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
          .then(function () { return toURL(c); })
          .then(function (url) {
            urls.push(url);
            page.cleanup();
            self.$.bar.style.width = Math.round((i / total) * 100) + '%';
            self.$.loadText.textContent = 'Loading page ' + i + ' of ' + total;
            i++;
            return next();
          });
      });
    }
    return next();
  };

  function toURL(canvas) {
    return new Promise(function (res) {
      if (canvas.toBlob) {
        canvas.toBlob(function (b) { res(b ? URL.createObjectURL(b) : canvas.toDataURL('image/jpeg', 0.9)); }, 'image/jpeg', 0.9);
      } else res(canvas.toDataURL('image/jpeg', 0.9));
    });
  }

  Flipbook.prototype.mount = function (urls) {
    var self = this, $ = this.$;
    var ratio = this.pageH / this.pageW;          // page aspect
    var spread = Math.min(this.root.clientWidth || 900, this.opts.maxWidth);
    var pageW = Math.round(spread / 2), pageH = Math.round(pageW * ratio);
    this.root.style.setProperty('--sqfb-spread-ratio', (2 / ratio).toFixed(3));

    $.loading.remove();
    $.book.hidden = false;
    $.controls.hidden = false;

    this.flip = new window.St.PageFlip($.book, {
      width: pageW,
      height: pageH,
      size: 'stretch',
      minWidth: 160,
      maxWidth: Math.round(this.opts.maxWidth / 2),
      minHeight: Math.round(160 * ratio),
      maxHeight: Math.round((this.opts.maxWidth / 2) * ratio),
      showCover: this.opts.cover,
      maxShadowOpacity: this.opts.shadow,
      flippingTime: this.opts.speed,
      usePortrait: true,
      mobileScrollSupport: true,
      autoSize: true,
      drawShadow: true
    });

    this.flip.loadFromImages(urls);
    this.total = urls.length;

    this.flip.on('flip', function (e) { self.update(e.data); });
    this.flip.on('changeOrientation', function (e) { self.orient(e.data); });
    this.flip.on('changeState', function (e) {
      self.root.classList.toggle('sq-flipbook--flipping', e.data !== 'read');
    });
    this.orient(this.flip.getOrientation());
    this.update(0);

    $.prev.addEventListener('click', function () { self.flip.flipPrev(); });
    $.next.addEventListener('click', function () { self.flip.flipNext(); });
    $.full.addEventListener('click', function () { self.fullscreen(); });
    this.root.setAttribute('tabindex', '0');
    this.root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { self.flip.flipNext(); e.preventDefault(); }
      if (e.key === 'ArrowLeft')  { self.flip.flipPrev(); e.preventDefault(); }
    });
    document.addEventListener('fullscreenchange', function () {
      setTimeout(function () { self.flip.update(); }, 60);
    });
  };

  Flipbook.prototype.orient = function (o) {
    this.root.classList.toggle('sq-flipbook--landscape', o === 'landscape');
    this.root.classList.toggle('sq-flipbook--portrait', o === 'portrait');
  };

  Flipbook.prototype.update = function (idx) {
    var t = this.total, label;
    if (this.flip.getOrientation() === 'portrait' || idx === 0 || idx === t - 1) {
      label = (idx + 1) + ' / ' + t;
    } else {
      label = (idx + 1) + '\u2013' + Math.min(idx + 2, t) + ' / ' + t; // idx is the left-hand page
    }
    this.$.count.textContent = label;
    this.$.prev.disabled = idx <= 0;
    this.$.next.disabled = idx >= t - 1;
  };

  Flipbook.prototype.fullscreen = function () {
    var r = this.root;
    if (document.fullscreenElement === r) { document.exitFullscreen(); return; }
    if (r.requestFullscreen) r.requestFullscreen();
    else if (r.webkitRequestFullscreen) r.webkitRequestFullscreen();
    else window.open(this.pdfUrl, '_blank'); // iOS Safari fallback
  };

  /* ---------- boot ---------- */
  function init() {
    injectCSS();
    var els = document.querySelectorAll('.sq-flipbook[data-pdf]:not([data-ready])');
    Array.prototype.forEach.call(els, function (el) {
      el.setAttribute('data-ready', '1');
      new Flipbook(el);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.SqFlipbook = { init: init };
})();
