/*!
 * sq-flipbook.js v1.4.0 — self-hosted PDF flipbook for Squarespace code blocks
 * Renders a PDF with PDF.js, flips it with StPageFlip (page-flip, MIT).
 * Icons: Heroicons v2 outline (MIT), same set as Will's Toolkit.
 *
 * Usage (one code block, Business plan or higher):
 *   <div class="sq-flipbook" data-pdf="/s/your-file.pdf"></div>
 *   <script src="https://cdn.jsdelivr.net/gh/zsawtelle-lgtm/sq-flipbook@1/sq-flipbook.js" defer><\/script>
 *
 * Optional data- attributes on the div:
 *   data-max-width="900"   max book width in px, two-page spread (default: fills the block)
 *   data-max-height="720"  max book height in px (default: none)
 *   data-align="center"    left | center | right (default center)
 *   data-accent="#0f3d80"  arrow + control color (default: site paragraph color)
 *   data-mobile-arrows="true"  single-page (mobile) view: true = arrows under the book,
 *                          overlay = arrows on the page edges, false = no arrows (swipe only)
 *   data-links="true"      make PDF links clickable (default true)
 *   data-download="true"   show the Download button (default true)
 *   data-fullscreen="true" show the Full screen button (default true)
 *   data-shadow="0.5"      flip shadow strength 0–1 (default 0.5)
 *   data-speed="700"       flip duration in ms (default 700)
 *   data-scale="1.5"       render sharpness 1–2 (default 1.5)
 *   data-relay="https://…" PDF relay URL (default: RELAY_URL below)
 */
(function () {
  'use strict';

  var PDFJS_URL    = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  var PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  var PAGEFLIP_URL = 'https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.min.js';
  // Cloudflare Worker that serves Squarespace /s/ PDFs with CORS headers.
  var RELAY_URL    = 'https://sq-flipbook-relay.zsawtelle.workers.dev';

  /* ---------- styles (injected once) ---------- */
  var CSS = [
    /* type + color inherit from the Squarespace theme, with safe fallbacks */
    '.sq-flipbook{--sqfb-accent:var(--paragraphMediumColor,currentColor);',
      '--sqfb-arrow-size:44px;--sqfb-arrow-stroke:1.5;--sqfb-controls-size:.9rem;--sqfb-controls-gap:18px;',
      '--sqfb-link-hover:rgba(255,220,0,.18);--sqfb-spine:.2;--sqfb-fullscreen-bg:var(--siteBackgroundColor,#fff);--sqfb-fullscreen-size:88;',
      'position:relative;width:100%;margin:0 auto;',
      'font-family:var(--body-font-font-family,inherit);font-weight:var(--body-font-font-weight,inherit);',
      'letter-spacing:var(--body-font-letter-spacing,inherit);font-style:var(--body-font-font-style,inherit);color:inherit}',
    '.sq-flipbook[data-align="left"]{margin-left:0}',
    '.sq-flipbook[data-align="right"]{margin-right:0}',
    '.sq-flipbook:focus{outline:none}',
    '.sq-flipbook:focus-visible{outline:2px solid var(--sqfb-accent);outline-offset:4px}',

    /* stage leaves room for the side arrows */
    '.sq-flipbook__stage{position:relative;padding:0 calc(var(--sqfb-arrow-size) + 12px)}',
    '.sq-flipbook--portrait:not(.sq-flipbook--mab-overlay) .sq-flipbook__stage{padding:0}',
    '.sq-flipbook__book{position:relative;width:100%;margin:0 auto}',
    '.sq-flipbook__page{background:#fff;overflow:hidden}',
    '.sq-flipbook__page img{display:block;width:100%;height:100%;object-fit:fill;pointer-events:none;user-select:none;-webkit-user-drag:none}',

    /* PDF links */
    '.sq-flipbook__link{position:absolute;z-index:2;display:block;border-radius:2px;cursor:pointer;transition:background-color .15s}',
    '.sq-flipbook__link:hover{background-color:var(--sqfb-link-hover)}',
    '.sq-flipbook__link:focus-visible{outline:2px solid var(--sqfb-accent);outline-offset:1px}',

    /* static spine shadow, two-page mode only */
    '.sq-flipbook__spine{position:absolute;top:0;bottom:0;left:50%;width:70px;transform:translateX(-50%);pointer-events:none;z-index:50;opacity:0;transition:opacity .2s;',
      'background:linear-gradient(90deg,transparent 0%,rgba(0,0,0,calc(var(--sqfb-spine) * .4)) 42%,rgba(0,0,0,var(--sqfb-spine)) 50%,rgba(0,0,0,calc(var(--sqfb-spine) * .4)) 58%,transparent 100%)}',
    '.sq-flipbook--landscape .sq-flipbook__spine{opacity:1}',
    '.sq-flipbook--flipping .sq-flipbook__spine{opacity:0}',

    /* side arrows: Heroicons arrow-left-circle / arrow-right-circle */
    '.sq-flipbook__arrow{position:absolute;top:50%;z-index:60;transform:translateY(-50%);appearance:none;background:none;border:0;padding:0;margin:0;',
      'width:var(--sqfb-arrow-size);height:var(--sqfb-arrow-size);color:var(--sqfb-accent);cursor:pointer;border-radius:50%;transition:opacity .15s,transform .15s}',
    '.sq-flipbook__arrow--prev{left:0}',
    '.sq-flipbook__arrow--next{right:0}',
    '.sq-flipbook__arrow svg{display:block;width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:var(--sqfb-arrow-stroke);stroke-linecap:round;stroke-linejoin:round}',
    '.sq-flipbook__arrow:hover{transform:translateY(-50%) scale(1.06)}',
    '.sq-flipbook__arrow:focus-visible{outline:2px solid var(--sqfb-accent);outline-offset:2px}',
    '.sq-flipbook__arrow[disabled]{opacity:.25;cursor:default;transform:translateY(-50%)}',
    '.sq-flipbook__nav{display:inline-flex;align-items:center;gap:14px}',
    '.sq-flipbook__nav .sq-flipbook__arrow{position:static;transform:none}',
    '.sq-flipbook__nav .sq-flipbook__arrow:hover{transform:scale(1.06)}',
    '.sq-flipbook__nav .sq-flipbook__arrow[disabled]{transform:none}',
    '.sq-flipbook--mab-false.sq-flipbook--portrait .sq-flipbook__arrow{display:none}',

    /* bottom bar: page count, full screen, download */
    '.sq-flipbook__controls{display:flex;align-items:center;justify-content:center;gap:var(--sqfb-controls-gap);flex-wrap:wrap;margin-top:16px;font-size:var(--sqfb-controls-size);line-height:1.2}',
    '.sq-flipbook__count{font-variant-numeric:tabular-nums;opacity:.75}',
    '.sq-flipbook__tool{appearance:none;background:none;border:0;padding:4px 0;margin:0;font:inherit;letter-spacing:inherit;color:var(--sqfb-accent);cursor:pointer;',
      'display:inline-flex;align-items:center;gap:6px;text-decoration:none}',
    '.sq-flipbook__tool:hover span{text-decoration:underline;text-underline-offset:3px}',
    '.sq-flipbook__tool:focus-visible{outline:2px solid var(--sqfb-accent);outline-offset:3px}',
    '.sq-flipbook__tool svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}',

    /* loading + error */
    '.sq-flipbook__loading{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:240px;font-size:.9rem;opacity:.7}',
    '.sq-flipbook__bar{height:2px;width:160px;background:rgba(127,127,127,.25);overflow:hidden}',
    '.sq-flipbook__bar i{display:block;height:100%;width:0;background:var(--sqfb-accent);transition:width .2s}',
    '.sq-flipbook__error{padding:24px;text-align:center;opacity:.8}',

    /* small screens: arrows overlay the page edges */
    '.sq-flipbook--mab-overlay.sq-flipbook--portrait .sq-flipbook__stage{padding:0}',
    '.sq-flipbook--mab-overlay.sq-flipbook--portrait .sq-flipbook__arrow{width:38px;height:38px;background:var(--siteBackgroundColor,#fff);box-shadow:0 1px 4px rgba(0,0,0,.18)}',
    '.sq-flipbook--mab-overlay.sq-flipbook--portrait .sq-flipbook__arrow--prev{left:6px}',
    '.sq-flipbook--mab-overlay.sq-flipbook--portrait .sq-flipbook__arrow--next{right:6px}',

    /* full screen */
    '.sq-flipbook:fullscreen{max-width:none!important;width:100vw;height:100vh;margin:0;background:var(--sqfb-fullscreen-bg);box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center}',
    '.sq-flipbook:fullscreen .sq-flipbook__stage{box-sizing:content-box;width:min(calc(var(--sqfb-fullscreen-size) * 1vw - 2 * (var(--sqfb-arrow-size) + 12px)),calc((var(--sqfb-fullscreen-size) * 1vh - 60px) * var(--sqfb-view-ratio,1.4)))}',
    '.sq-flipbook--portrait:fullscreen .sq-flipbook__stage{width:min(calc(var(--sqfb-fullscreen-size) * 1vw),calc((var(--sqfb-fullscreen-size) * 1vh - 60px) * var(--sqfb-view-ratio,.7)))}',
    '@media (prefers-reduced-motion:reduce){.sq-flipbook__spine,.sq-flipbook__arrow,.sq-flipbook__link{transition:none}}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('sq-flipbook-css')) return;
    var s = document.createElement('style');
    s.id = 'sq-flipbook-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

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

  // Heroicons v2 outline paths (24x24, stroke 1.5)
  var ICONS = {
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11.25 9-3 3m0 0 3 3m-3-3h7.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12.75 15 3-3m0 0-3-3m3 3h-7.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>',
    full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>'
  };

  function attr(el, name, def) {
    var v = el.getAttribute('data-' + name);
    return v === null || v === '' ? def : v;
  }

  /* ---------- one book ---------- */
  function Flipbook(root) {
    this.root = root;
    this.pdfUrl = attr(root, 'pdf', '');
    this.opts = {
      maxWidth:   parseInt(attr(root, 'max-width', 0), 10) || 0,
      maxHeight:  parseInt(attr(root, 'max-height', 0), 10) || 0,
      links:      attr(root, 'links', 'true') !== 'false',
      download:   attr(root, 'download', 'true') !== 'false',
      fullscreen: attr(root, 'fullscreen', 'true') !== 'false',
      shadow:     parseFloat(attr(root, 'shadow', 0.5)),
      speed:      parseInt(attr(root, 'speed', 700), 10),
      scale:      Math.min(2, Math.max(1, parseFloat(attr(root, 'scale', 1.5)))),
      relay:      attr(root, 'relay', RELAY_URL),
      mobileArrows: String(attr(root, 'mobile-arrows', 'true')).toLowerCase()
    };
    if (['true', 'false', 'overlay'].indexOf(this.opts.mobileArrows) < 0) this.opts.mobileArrows = 'true';
    root.classList.add('sq-flipbook--mab-' + this.opts.mobileArrows);
    var accent = attr(root, 'accent', '');
    if (accent) root.style.setProperty('--sqfb-accent', accent);
    if (this.opts.maxWidth) root.style.maxWidth = this.opts.maxWidth + 'px';
    this.build();
    this.load();
  }

  Flipbook.prototype.build = function () {
    var r = this.root, o = this.opts;
    r.innerHTML =
      '<div class="sq-flipbook__stage">' +
        '<div class="sq-flipbook__loading" role="status">' +
          '<span class="sq-flipbook__loading-text">Loading document</span>' +
          '<span class="sq-flipbook__bar"><i></i></span>' +
        '</div>' +
        '<div class="sq-flipbook__book" hidden></div>' +
        '<div class="sq-flipbook__spine" hidden></div>' +
        '<button type="button" class="sq-flipbook__arrow sq-flipbook__arrow--prev" aria-label="Previous page" hidden>' + ICONS.prev + '</button>' +
        '<button type="button" class="sq-flipbook__arrow sq-flipbook__arrow--next" aria-label="Next page" hidden>' + ICONS.next + '</button>' +
      '</div>' +
      '<div class="sq-flipbook__controls" hidden>' +
        '<span class="sq-flipbook__nav"><span class="sq-flipbook__count" aria-live="polite"></span></span>' +
        (o.fullscreen ? '<button type="button" class="sq-flipbook__tool" data-act="full">' + ICONS.full + '<span>Full screen</span></button>' : '') +
        (o.download ? '<a class="sq-flipbook__tool" href="' + this.pdfUrl + '" download target="_blank" rel="noopener">' + ICONS.down + '<span>Download</span></a>' : '') +
      '</div>';
    this.$ = {
      stage:    r.querySelector('.sq-flipbook__stage'),
      loading:  r.querySelector('.sq-flipbook__loading'),
      loadText: r.querySelector('.sq-flipbook__loading-text'),
      bar:      r.querySelector('.sq-flipbook__bar i'),
      book:     r.querySelector('.sq-flipbook__book'),
      spine:    r.querySelector('.sq-flipbook__spine'),
      prev:     r.querySelector('.sq-flipbook__arrow--prev'),
      next:     r.querySelector('.sq-flipbook__arrow--next'),
      controls: r.querySelector('.sq-flipbook__controls'),
      count:    r.querySelector('.sq-flipbook__count'),
      nav:      r.querySelector('.sq-flipbook__nav'),
      full:     r.querySelector('[data-act="full"]')
    };
  };

  Flipbook.prototype.fail = function (msg) {
    if (!this.$.loading) return;
    this.$.loading.outerHTML = '<div class="sq-flipbook__error">' + msg +
      (this.pdfUrl ? ' <a href="' + this.pdfUrl + '" target="_blank" rel="noopener">Open the PDF</a>' : '') + '</div>';
  };

  Flipbook.prototype.load = function () {
    var self = this;
    if (!this.pdfUrl) return this.fail('No PDF set. Add data-pdf="/s/your-file.pdf".');

    var abs = new URL(this.pdfUrl, window.location.href);
    var relayed = this.opts.relay + '?url=' + encodeURIComponent(abs.href);
    // Squarespace /s/ files always need the relay; anything else tries direct first.
    var useRelayFirst = abs.pathname.indexOf('/s/') === 0 && !!this.opts.relay;

    Promise.all([
      loadScript(PDFJS_URL, function () { return !!window.pdfjsLib; }),
      loadScript(PAGEFLIP_URL, function () { return !!(window.St && window.St.PageFlip); })
    ])
    .then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      var get = function (u) { return window.pdfjsLib.getDocument({ url: u }).promise; };
      if (useRelayFirst) return get(relayed);
      return get(abs.href).catch(function (err) {
        if (err && (err.name === 'MissingPDFException' || err.name === 'InvalidPDFException') || !self.opts.relay) throw err;
        return get(relayed);
      });
    })
    .then(function (pdf) { self.pdf = pdf; return self.render(pdf); })
    .then(function (pages) { self.mount(pages); })
    .catch(function (err) {
      console.error('[sq-flipbook]', err);
      var why = 'The document could not be displayed.';
      var n = (err && err.name) || '', m = (err && err.message) || '';
      if (n === 'MissingPDFException') why = 'PDF not found. Check the data-pdf path (case-sensitive).';
      else if (n === 'UnexpectedResponseException') why = 'The server returned an error for the PDF (' + (err.status || m) + ').';
      else if (n === 'InvalidPDFException') why = 'The file is not a valid PDF.';
      else if (/fetch|network|CORS/i.test(m) || n === 'UnknownErrorException') why = 'The browser blocked the PDF request.';
      self.fail(why);
    });
  };

  /* Resolve an internal PDF destination to a 0-based page index */
  Flipbook.prototype.destToIndex = function (dest) {
    var pdf = this.pdf;
    var p = typeof dest === 'string' ? pdf.getDestination(dest) : Promise.resolve(dest);
    return p.then(function (explicit) {
      if (!explicit || !explicit.length) return null;
      var ref = explicit[0];
      if (typeof ref === 'number') return ref;
      return pdf.getPageIndex(ref);
    }).catch(function () { return null; });
  };

  /* Render each page to an image and collect its link areas */
  Flipbook.prototype.render = function (pdf) {
    var self = this, total = pdf.numPages, pages = [], i = 1;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var pageCss = Math.max(320, Math.min(this.$.stage.clientWidth || 900, 1400) / 2);
    var px = pageCss * this.opts.scale * dpr;

    function next() {
      if (i > total) return pages;
      return pdf.getPage(i).then(function (page) {
        var vp1 = page.getViewport({ scale: 1 });
        if (i === 1) { self.pageW = vp1.width; self.pageH = vp1.height; }
        var vp = page.getViewport({ scale: px / vp1.width });
        var c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);

        var annots = self.opts.links ? page.getAnnotations({ intent: 'display' }) : Promise.resolve([]);
        return Promise.all([
          page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () { return toURL(c); }),
          annots
        ]).then(function (res) {
          var links = [];
          res[1].forEach(function (a) {
            if (a.subtype !== 'Link' || !a.rect) return;
            var href = a.url || a.unsafeUrl || null;
            if (!href && !a.dest) return;
            var r = vp1.convertToViewportRectangle(a.rect);
            var x1 = Math.min(r[0], r[2]), x2 = Math.max(r[0], r[2]);
            var y1 = Math.min(r[1], r[3]), y2 = Math.max(r[1], r[3]);
            links.push({
              l: x1 / vp1.width * 100, t: y1 / vp1.height * 100,
              w: (x2 - x1) / vp1.width * 100, h: (y2 - y1) / vp1.height * 100,
              href: href, dest: href ? null : a.dest
            });
          });
          pages.push({ src: res[0], links: links });
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

  Flipbook.prototype.buildPages = function (pages) {
    var self = this, frag = document.createDocumentFragment();
    pages.forEach(function (p, idx) {
      var pg = document.createElement('div');
      pg.className = 'sq-flipbook__page';
      var img = document.createElement('img');
      img.src = p.src; img.alt = 'Page ' + (idx + 1); img.draggable = false;
      pg.appendChild(img);
      p.links.forEach(function (L) {
        var a = document.createElement('a');
        a.className = 'sq-flipbook__link';
        a.style.cssText = 'left:' + L.l + '%;top:' + L.t + '%;width:' + L.w + '%;height:' + L.h + '%';
        if (L.href) {
          a.href = L.href;
          if (!/^(mailto|tel):/i.test(L.href)) { a.target = '_blank'; a.rel = 'noopener'; }
          a.setAttribute('aria-label', 'Link: ' + L.href);
        } else {
          a.href = '#';
          a.setAttribute('aria-label', 'Go to page');
          a.addEventListener('click', function (e) {
            e.preventDefault();
            self.destToIndex(L.dest).then(function (n) { if (n !== null && n !== undefined) self.flip.flip(n); });
          });
        }
        // keep clicks on links from reaching the flip engine
        ['mousedown', 'touchstart', 'pointerdown'].forEach(function (ev) {
          a.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true });
        });
        pg.appendChild(a);
      });
      frag.appendChild(pg);
    });
    this.$.book.appendChild(frag);
    return this.$.book.querySelectorAll('.sq-flipbook__page');
  };

  Flipbook.prototype.mount = function (pages) {
    var self = this, $ = this.$, o = this.opts;
    var ratio = this.pageH / this.pageW;                 // page height / width
    this.ratio = ratio;

    // Height cap -> width cap for the whole spread
    if (o.maxHeight) {
      var widthFromHeight = Math.round(o.maxHeight * 2 / ratio) + 112; // + arrow gutters
      var cur = o.maxWidth || Infinity;
      this.root.style.maxWidth = Math.min(cur, widthFromHeight) + 'px';
    }

    $.loading.remove();
    $.book.hidden = false;
    $.spine.hidden = false;
    $.prev.hidden = false;
    $.next.hidden = false;
    $.controls.hidden = false;

    var basePageW = 500, basePageH = Math.round(basePageW * ratio);
    this.flip = new window.St.PageFlip($.book, {
      width: basePageW,
      height: basePageH,
      size: 'stretch',
      minWidth: 280,                  // below 560px wide the book switches to single pages
      maxWidth: 4000,
      minHeight: Math.round(280 * ratio),
      maxHeight: Math.round(4000 * ratio),
      showCover: true,
      usePortrait: true,
      autoSize: true,
      drawShadow: true,
      maxShadowOpacity: isNaN(o.shadow) ? 0.5 : o.shadow,
      flippingTime: isNaN(o.speed) ? 700 : o.speed,
      useMouseEvents: false,          // no corner dragging; arrows, keys and swipe only
      showPageCorners: false,
      disableFlipByClick: true,
      mobileScrollSupport: true
    });
    this.flip.loadFromHTML(this.buildPages(pages));
    this.total = pages.length;

    this.flip.on('flip', function (e) { self.update(e.data); });
    this.flip.on('changeOrientation', function (e) { self.orient(e.data); });
    this.flip.on('changeState', function (e) {
      self.root.classList.toggle('sq-flipbook--flipping', e.data !== 'read');
    });
    this.orient(this.flip.getOrientation());
    this.update(0);

    $.prev.addEventListener('click', function () { self.flip.flipPrev(); });
    $.next.addEventListener('click', function () { self.flip.flipNext(); });
    if ($.full) $.full.addEventListener('click', function () { self.fullscreen(); });

    // keyboard
    this.root.setAttribute('tabindex', '0');
    this.root.addEventListener('keydown', function (e) {
      if (e.target.closest && e.target.closest('a,button') && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.key === 'ArrowRight') { self.flip.flipNext(); e.preventDefault(); }
      if (e.key === 'ArrowLeft')  { self.flip.flipPrev(); e.preventDefault(); }
    });

    // swipe on touch screens (replaces corner drag)
    var sx = 0, sy = 0, tracking = false;
    $.book.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { tracking = false; return; }
      tracking = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    $.book.addEventListener('touchend', function (e) {
      if (!tracking) return; tracking = false;
      var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) self.flip.flipNext(); else self.flip.flipPrev();
      }
    }, { passive: true });

    document.addEventListener('fullscreenchange', function () {
      setTimeout(function () { self.flip.update(); }, 80);
    });
  };

  Flipbook.prototype.orient = function (o) {
    var $ = this.$, portrait = o === 'portrait';
    this.root.classList.toggle('sq-flipbook--landscape', !portrait);
    this.root.classList.toggle('sq-flipbook--portrait', portrait);
    // visible width / height, used to size full screen
    this.root.style.setProperty('--sqfb-view-ratio', ((portrait ? 1 : 2) / this.ratio).toFixed(4));
    // single-page view + mobile-arrows="true": move arrows under the book, around the page count
    if (portrait && this.opts.mobileArrows === 'true') {
      if ($.prev.parentNode !== $.nav) { $.nav.insertBefore($.prev, $.count); $.nav.appendChild($.next); }
    } else if ($.prev.parentNode !== $.stage) {
      $.stage.appendChild($.prev); $.stage.appendChild($.next);
    }
  };

  Flipbook.prototype.update = function (idx) {
    var t = this.total, label;
    if (this.flip.getOrientation() === 'portrait' || idx === 0 || idx === t - 1) {
      label = 'Page ' + (idx + 1) + ' of ' + t;
    } else {
      label = 'Pages ' + (idx + 1) + '\u2013' + Math.min(idx + 2, t) + ' of ' + t;
    }
    this.$.count.textContent = label;
    this.$.prev.disabled = idx <= 0;
    this.$.next.disabled = idx >= t - 1 || (this.flip.getOrientation() === 'landscape' && idx > 0 && idx >= t - 2);
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
