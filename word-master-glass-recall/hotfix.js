/* WORD MASTER Glass Recall runtime enhancement
 * 2026-08-17
 * - S Pen: live coalesced-point ink overlay + rAF throttling for the heavy app renderer
 * - Learning: floating handwriting practice pad while the 1회/2회 learning view is open
 * - OCR: one correct meaning/keyword is enough to auto-mark as understood
 * ES5-friendly on purpose so old WebKit can safely ignore unsupported APIs.
 */
(function () {
  "use strict";

  var OCR_TTL = 12000;
  var lastOcr = null;
  var retryTimer = null;
  var learningPad = null;
  var raf = window.requestAnimationFrame || function (fn) { return window.setTimeout(fn, 16); };

  function normalizeAnswer(value) {
    var text = value == null ? "" : String(value);
    try { if (text.normalize) text = text.normalize("NFKC"); } catch (ignore) {}
    return text
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n+/g, " ")
      .replace(/^\s+|\s+$/g, "")
      .toLowerCase();
  }

  function comparable(value) {
    return normalizeAnswer(value)
      .replace(/[“”‘’"'`]/g, "")
      .replace(/[(){}\[\]]/g, " ")
      .replace(/[,:;\/|·•]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    var style;
    try { style = window.getComputedStyle(el); } catch (ignore) { return true; }
    if (!style) return true;
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function textOf(el) { return normalizeAnswer(el && (el.innerText || el.textContent || "")); }

  /* Keep the app's expensive canvas move handler to about one call per frame.
     Our own live-ink layer still receives the full/coalesced S Pen stream. */
  (function patchMoveListeners() {
    if (!window.EventTarget || !window.EventTarget.prototype) return;
    var proto = window.EventTarget.prototype;
    var nativeAdd = proto.addEventListener;
    if (!nativeAdd || nativeAdd.__wmPatched) return;

    function invoke(listener, self, event) {
      if (typeof listener === "function") return listener.call(self, event);
      if (listener && typeof listener.handleEvent === "function") return listener.handleEvent(event);
    }

    function patched(type, listener, options) {
      if ((type === "pointermove" || type === "touchmove" || type === "mousemove") && listener && !listener.__wmNoThrottle) {
        var original = listener;
        var pending = false;
        var latest = null;
        var selfTarget = this;
        var wrapped = function (event) {
          var target = event && event.target;
          if (!target || target.tagName !== "CANVAS" || target.__wmStandalonePad) return invoke(original, this, event);
          latest = event;
          if (pending) return;
          pending = true;
          raf(function () {
            pending = false;
            var e = latest;
            latest = null;
            if (e) invoke(original, selfTarget, e);
          });
        };
        return nativeAdd.call(this, type, wrapped, options);
      }
      return nativeAdd.call(this, type, listener, options);
    }
    patched.__wmPatched = true;
    patched.__wmNative = nativeAdd;
    proto.addEventListener = patched;
  }());

  function extractOcrText(payload) {
    var i, value, keys;
    if (payload == null) return "";
    if (typeof payload === "string") return payload;
    keys = ["text", "recognizedText", "recognized_text", "ocrText", "ocr_text", "fullText", "description"];
    for (i = 0; i < keys.length; i += 1) {
      value = payload[keys[i]];
      if (typeof value === "string" && normalizeAnswer(value)) return value;
    }
    try {
      if (payload.responses && payload.responses[0]) {
        value = payload.responses[0].fullTextAnnotation && payload.responses[0].fullTextAnnotation.text;
        if (typeof value === "string" && normalizeAnswer(value)) return value;
        value = payload.responses[0].textAnnotations && payload.responses[0].textAnnotations[0] && payload.responses[0].textAnnotations[0].description;
        if (typeof value === "string" && normalizeAnswer(value)) return value;
      }
    } catch (ignore2) {}
    if (payload.data && typeof payload.data === "object") { value = extractOcrText(payload.data); if (value) return value; }
    if (payload.result && typeof payload.result === "object") { value = extractOcrText(payload.result); if (value) return value; }
    return "";
  }

  function isOcrUrl(input) {
    var url = "";
    try {
      if (typeof input === "string") url = input;
      else if (input && input.url) url = input.url;
    } catch (ignore) {}
    return /(^|[\/?_.-])ocr([\/?_.-]|$)/i.test(url);
  }

  function registerOcr(text) {
    text = normalizeAnswer(text);
    if (!text) return;
    lastOcr = { text: text, at: Date.now(), used: false };
    scheduleAutoMark(0);
  }

  if (window.fetch) {
    var originalFetch = window.fetch;
    window.fetch = function (input) {
      var args = arguments;
      return originalFetch.apply(this, args).then(function (response) {
        if (!isOcrUrl(input)) return response;
        try {
          var clone = response.clone();
          clone.json().then(function (data) { registerOcr(extractOcrText(data)); }, function () {
            try { response.clone().text().then(registerOcr, function () {}); } catch (ignore2) {}
          });
        } catch (ignore) {}
        return response;
      });
    };
  }

  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
    var originalOpen = window.XMLHttpRequest.prototype.open;
    var originalSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      this.__wmOcrRequest = isOcrUrl(url);
      return originalOpen.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      if (xhr.__wmOcrRequest) xhr.addEventListener("load", function () {
        var value = "";
        try { value = extractOcrText(JSON.parse(xhr.responseText)); } catch (ignore) { value = xhr.responseText || ""; }
        registerOcr(value);
      });
      return originalSend.apply(this, arguments);
    };
  }

  function ownTextStartsWithAnswer(el) {
    var text = textOf(el);
    return /^정답(?:\s|·|:|$)/.test(text) && !/정답\s*보기/.test(text);
  }

  function findAnswerRoot() {
    var nodes = document.querySelectorAll("small,span,p,strong,h2,h3,div,section,article"), i, node, parent;
    for (i = 0; i < nodes.length; i += 1) {
      node = nodes[i];
      if (!visible(node) || !ownTextStartsWithAnswer(node)) continue;
      parent = node.parentNode;
      if (parent && parent.nodeType === 1 && visible(parent)) return parent;
      return node;
    }
    return null;
  }

  function addCandidate(list, value) {
    var n = normalizeAnswer(value), i;
    if (!n || n.length > 180) return;
    if (/^(정답|ocr|인식|채점|○|△|×|알았다|애매했다|몰랐다)/.test(n)) return;
    for (i = 0; i < list.length; i += 1) if (list[i] === n) return;
    list.push(n);
  }

  function expectedAnswers(root) {
    var out = [], strongs, texts, i, combined = [], s, p;
    if (!root) return out;
    strongs = root.querySelectorAll ? root.querySelectorAll("strong,b") : [];
    for (i = 0; i < strongs.length; i += 1) {
      if (!visible(strongs[i])) continue;
      s = textOf(strongs[i]);
      if (s && !/^[○△×]$/.test(s)) { addCandidate(out, s); combined.push(s); }
    }
    if (combined.length > 1) addCandidate(out, combined.join(" "));
    if (!out.length && root.querySelectorAll) {
      texts = root.querySelectorAll("p,li,[data-answer]");
      combined = [];
      for (i = 0; i < texts.length; i += 1) {
        if (!visible(texts[i])) continue;
        p = textOf(texts[i]);
        if (/ocr|인식|정답|채점|알았다|애매했다|몰랐다/.test(p)) continue;
        addCandidate(out, p);
        if (p) combined.push(p);
      }
      if (combined.length > 1) addCandidate(out, combined.join(" "));
    }
    return out;
  }

  function isUsefulToken(token) {
    if (!token) return false;
    token = token.replace(/^~+/, "").replace(/[.!?]+$/g, "");
    if (/^[a-z0-9]+$/i.test(token)) return token.length >= 3;
    if (/^[가-힣]+$/.test(token)) {
      if (token.length < 2) return false;
      if (/^(그리고|또는|혹은|하는|하다|있는|있다|것을|것이|대한|위한|등을|등의)$/.test(token)) return false;
      return true;
    }
    return token.length >= 2;
  }

  function answerFragments(answers) {
    var out = [], seen = {}, i, j, k, answer, variants, phrase, words, key;
    function put(value) {
      value = comparable(value).replace(/^~+/, "").replace(/^[-–—]+|[-–—]+$/g, "").replace(/^\s+|\s+$/g, "");
      if (!value || seen[value]) return;
      if (value.length < 2) return;
      seen[value] = true; out.push(value);
    }
    for (i = 0; i < answers.length; i += 1) {
      answer = normalizeAnswer(answers[i]);
      variants = answer.split(/[,;\/|·•\n]+/);
      for (j = 0; j < variants.length; j += 1) {
        phrase = variants[j].replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
        put(phrase);
        words = comparable(phrase).split(/\s+/);
        for (k = 0; k < words.length; k += 1) {
          key = words[k].replace(/^~+/, "");
          if (isUsefulToken(key)) put(key);
        }
      }
    }
    return out;
  }

  /* A correct listed meaning/keyword anywhere in the OCR result is enough.
     We do NOT accept fuzzy spelling or a mere character stem. */
  function partialMeaningMatch(ocr, answers) {
    var target = comparable(ocr), fragments = answerFragments(answers), i, f;
    if (!target) return false;
    var padded = " " + target + " ";
    for (i = 0; i < fragments.length; i += 1) {
      f = fragments[i];
      if (target === f) return true;
      if (padded.indexOf(" " + f + " ") >= 0) return true;
      if (f.indexOf(" ") < 0 && target.indexOf(f) >= 0) return true;
    }
    return false;
  }

  function positiveButton() {
    var buttons = document.querySelectorAll("button"), i, t;
    for (i = 0; i < buttons.length; i += 1) {
      if (!visible(buttons[i]) || buttons[i].disabled) continue;
      t = textOf(buttons[i]).replace(/\s+/g, " ");
      if (/^(?:○\s*)?알았다$/.test(t) || /^(?:○\s*)?(?:이해함|이해했다|이해했음|알겠음|맞았다|맞음)$/.test(t) || t === "○") return buttons[i];
    }
    return null;
  }

  function toast(message) {
    var old = document.getElementById("wm-ocr-auto-toast");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var el = document.createElement("div");
    el.id = "wm-ocr-auto-toast";
    el.textContent = message || "OCR 핵심 정답 포함 · 자동으로 이해 처리됨";
    el.style.cssText = "position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147483647;padding:10px 14px;border-radius:999px;background:rgba(16,43,79,.9);color:#fff;font:600 13px/1.2 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 8px 28px rgba(16,43,79,.18);pointer-events:none;opacity:1;transition:opacity .25s ease";
    document.body.appendChild(el);
    window.setTimeout(function () { el.style.opacity = "0"; }, 1200);
    window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1600);
  }

  function tryAutoMark() {
    if (!lastOcr || lastOcr.used) return;
    if (Date.now() - lastOcr.at > OCR_TTL) { lastOcr = null; return; }
    var root = findAnswerRoot();
    if (!root) return;
    var answers = expectedAnswers(root);
    if (!partialMeaningMatch(lastOcr.text, answers)) return;
    var button = positiveButton();
    if (!button) return;
    lastOcr.used = true;
    toast();
    try { button.click(); } catch (ignore) {}
  }

  function scheduleAutoMark(delay) {
    if (retryTimer) window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(function () { retryTimer = null; tryAutoMark(); }, delay == null ? 30 : delay);
  }

  /* ---------- smooth live ink for the app's existing canvases ---------- */
  function markFastListener(fn) { try { fn.__wmNoThrottle = true; } catch (ignore) {} return fn; }

  function canvasPoint(canvas, event) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      pressure: typeof event.pressure === "number" && event.pressure > 0 ? event.pressure : 0.5
    };
  }

  function prepareCanvas(canvas) {
    if (!canvas || canvas.__wmPenPrepared || canvas.__wmStandalonePad || canvas.__wmOverlayCanvas) return;
    canvas.__wmPenPrepared = true;
    try {
      canvas.style.touchAction = "none";
      canvas.style.msTouchAction = "none";
      canvas.style.webkitUserSelect = "none";
      canvas.style.userSelect = "none";
      canvas.style.webkitTapHighlightColor = "transparent";
      canvas.style.overscrollBehavior = "contain";
    } catch (ignore) {}
    installLiveOverlay(canvas);
  }

  function installLiveOverlay(canvas) {
    if (!canvas || canvas.__wmLiveOverlay || !canvas.parentNode) return;
    var parent = canvas.parentNode;
    if (!parent || parent.nodeType !== 1) return;
    var overlay = document.createElement("canvas");
    overlay.__wmOverlayCanvas = true;
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText = "position:absolute;pointer-events:none;z-index:7;touch-action:none;opacity:.92;";
    try { if (window.getComputedStyle(parent).position === "static") parent.style.position = "relative"; } catch (ignore) { parent.style.position = "relative"; }
    parent.appendChild(overlay);
    canvas.__wmLiveOverlay = overlay;

    var ctx = overlay.getContext("2d"), activeId = null, last = null, clearTimer = null, dpr = 1;

    function sync() {
      if (!canvas.parentNode || !overlay.parentNode) return;
      var cr = canvas.getBoundingClientRect(), pr = parent.getBoundingClientRect();
      var w = Math.max(1, cr.width), h = Math.max(1, cr.height);
      overlay.style.left = (cr.left - pr.left + parent.scrollLeft) + "px";
      overlay.style.top = (cr.top - pr.top + parent.scrollTop) + "px";
      overlay.style.width = w + "px";
      overlay.style.height = h + "px";
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      var pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
      if (overlay.width !== pw || overlay.height !== ph) { overlay.width = pw; overlay.height = ph; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#102b4f";
    }

    function clear() {
      sync();
      ctx.clearRect(0, 0, overlay.width / dpr, overlay.height / dpr);
    }

    function segment(a, b) {
      if (!a || !b) return;
      var pressure = (a.pressure + b.pressure) / 2;
      ctx.lineWidth = 1.9 + pressure * 1.7;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    function start(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      sync();
      if (clearTimer) { window.clearTimeout(clearTimer); clearTimer = null; }
      activeId = event.pointerId;
      last = canvasPoint(canvas, event);
      try { if (canvas.setPointerCapture && event.pointerId != null) canvas.setPointerCapture(event.pointerId); } catch (ignore) {}
      if ((event.pointerType === "pen" || event.pointerType === "touch") && event.cancelable) event.preventDefault();
    }

    function move(event) {
      if (activeId == null || (event.pointerId != null && event.pointerId !== activeId)) return;
      var events = null, i, p;
      try { events = event.getCoalescedEvents ? event.getCoalescedEvents() : null; } catch (ignore) {}
      if (!events || !events.length) events = [event];
      for (i = 0; i < events.length; i += 1) { p = canvasPoint(canvas, events[i]); segment(last, p); last = p; }
      if ((event.pointerType === "pen" || event.pointerType === "touch") && event.cancelable) event.preventDefault();
    }

    function end(event) {
      if (activeId == null) return;
      if (event && event.pointerId != null && event.pointerId !== activeId) return;
      activeId = null; last = null;
      if (clearTimer) window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(clear, 180);
    }

    var onDown = markFastListener(start), onMove = markFastListener(move), onUp = markFastListener(end);
    if (window.PointerEvent) {
      canvas.addEventListener("pointerdown", onDown, { capture: true, passive: false });
      canvas.addEventListener("pointermove", onMove, { capture: true, passive: false });
      canvas.addEventListener("pointerup", onUp, { capture: true, passive: false });
      canvas.addEventListener("pointercancel", onUp, { capture: true, passive: false });
    }
    sync();
  }

  var originalGetContext = window.HTMLCanvasElement && window.HTMLCanvasElement.prototype && window.HTMLCanvasElement.prototype.getContext;
  if (originalGetContext && !originalGetContext.__wmPatched) {
    var patchedGetContext = function () {
      var ctx = originalGetContext.apply(this, arguments);
      if (ctx && arguments[0] === "2d") {
        try { ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.imageSmoothingEnabled = true; } catch (ignore) {}
      }
      return ctx;
    };
    patchedGetContext.__wmPatched = true;
    window.HTMLCanvasElement.prototype.getContext = patchedGetContext;
  }

  function scanCanvases() {
    var canvases = document.getElementsByTagName("canvas"), i;
    for (i = 0; i < canvases.length; i += 1) prepareCanvas(canvases[i]);
  }

  /* ---------- standalone smooth handwriting pad for learning ---------- */
  function findLearningButtons() {
    var buttons = document.querySelectorAll("button"), one = null, two = null, i, t;
    for (i = 0; i < buttons.length; i += 1) {
      if (!visible(buttons[i])) continue;
      t = textOf(buttons[i]).replace(/\s+/g, " ");
      if (t === "1회") one = buttons[i];
      else if (t === "2회") two = buttons[i];
    }
    return one && two ? { one: one, two: two } : null;
  }

  function currentLearningWord(button) {
    var node = button, depth = 0, headings, i, t;
    while (node && node !== document.body && depth < 6) {
      if (node.querySelectorAll) {
        headings = node.querySelectorAll("h1,h2,h3,strong");
        for (i = 0; i < headings.length; i += 1) {
          t = textOf(headings[i]);
          if (t && !/^day\s*\d+/i.test(t) && t !== "1회" && t !== "2회" && t.length < 80) return t;
        }
      }
      node = node.parentNode; depth += 1;
    }
    return "현재 단어";
  }

  function makeLearningPad() {
    var wrap = document.createElement("section");
    wrap.id = "wm-learning-write-pad";
    wrap.style.cssText = "position:fixed;left:max(10px,env(safe-area-inset-left));right:max(10px,env(safe-area-inset-right));bottom:76px;z-index:2147483000;border:1px solid rgba(133,171,210,.35);border-radius:22px;background:rgba(244,249,255,.88);box-shadow:0 16px 46px rgba(16,43,79,.16);backdrop-filter:blur(20px) saturate(1.25);-webkit-backdrop-filter:blur(20px) saturate(1.25);padding:10px;max-width:760px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#102b4f;";

    var head = document.createElement("div"); head.style.cssText = "display:flex;align-items:center;gap:8px;padding:2px 4px 8px;";
    var title = document.createElement("strong"); title.id = "wm-learning-write-title"; title.textContent = "쓰면서 익히기"; title.style.cssText = "font-size:14px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    var clearBtn = document.createElement("button"); clearBtn.type = "button"; clearBtn.textContent = "지우기"; clearBtn.style.cssText = "border:0;border-radius:999px;padding:7px 10px;background:rgba(16,43,79,.08);color:#102b4f;font-weight:700;";
    var foldBtn = document.createElement("button"); foldBtn.type = "button"; foldBtn.textContent = "접기"; foldBtn.style.cssText = clearBtn.style.cssText;
    head.appendChild(title); head.appendChild(clearBtn); head.appendChild(foldBtn); wrap.appendChild(head);

    var body = document.createElement("div"); body.id = "wm-learning-write-body";
    var hint = document.createElement("div"); hint.textContent = "뜻이나 철자를 S Pen으로 직접 한 번 써 보세요."; hint.style.cssText = "font-size:12px;opacity:.64;padding:0 4px 7px;"; body.appendChild(hint);
    var canvas = document.createElement("canvas"); canvas.__wmStandalonePad = true; canvas.style.cssText = "display:block;width:100%;height:150px;border-radius:16px;background:rgba(255,255,255,.78);border:1px solid rgba(100,143,190,.22);touch-action:none;user-select:none;-webkit-user-select:none;"; body.appendChild(canvas); wrap.appendChild(body);
    document.body.appendChild(wrap);

    var strokes = [], active = null, dpr = 1, rect = null, collapsed = false;

    function resize() {
      rect = canvas.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      var w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; redraw(); }
    }
    function context() { var c = canvas.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = "#102b4f"; return c; }
    function pt(e) { if (!rect) resize(); return { x: e.clientX - rect.left, y: e.clientY - rect.top, p: typeof e.pressure === "number" && e.pressure > 0 ? e.pressure : 0.5 }; }
    function line(a, b) { var c = context(); c.lineWidth = 1.8 + ((a.p + b.p) / 2) * 1.9; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
    function redraw() { var c = context(), i, j; c.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr); for (i = 0; i < strokes.length; i += 1) for (j = 1; j < strokes[i].length; j += 1) line(strokes[i][j - 1], strokes[i][j]); }
    function down(e) { if (e.pointerType === "mouse" && e.button !== 0) return; resize(); active = [pt(e)]; strokes.push(active); try { canvas.setPointerCapture(e.pointerId); } catch (ignore) {} if (e.cancelable) e.preventDefault(); }
    function move(e) { if (!active) return; var evs, i, p, prev; try { evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null; } catch (ignore) {} if (!evs || !evs.length) evs = [e]; for (i = 0; i < evs.length; i += 1) { p = pt(evs[i]); prev = active[active.length - 1]; active.push(p); line(prev, p); } if (e.cancelable) e.preventDefault(); }
    function up(e) { active = null; if (e && e.cancelable) e.preventDefault(); }
    var d = markFastListener(down), m = markFastListener(move), u = markFastListener(up);
    if (window.PointerEvent) { canvas.addEventListener("pointerdown", d, { passive: false }); canvas.addEventListener("pointermove", m, { passive: false }); canvas.addEventListener("pointerup", u, { passive: false }); canvas.addEventListener("pointercancel", u, { passive: false }); }
    clearBtn.onclick = function () { strokes = []; active = null; redraw(); };
    foldBtn.onclick = function () { collapsed = !collapsed; body.style.display = collapsed ? "none" : "block"; clearBtn.style.display = collapsed ? "none" : "inline-block"; foldBtn.textContent = collapsed ? "펼치기" : "접기"; };
    window.addEventListener("resize", function () { window.setTimeout(resize, 40); });
    resize();
    return { el: wrap, title: title, clear: function () { strokes = []; active = null; redraw(); }, lastWord: "" };
  }

  function updateLearningPad() {
    var found = findLearningButtons();
    if (!found) { if (learningPad) learningPad.el.style.display = "none"; return; }
    if (!learningPad) learningPad = makeLearningPad();
    learningPad.el.style.display = "block";
    var word = currentLearningWord(found.one);
    learningPad.title.textContent = "쓰면서 익히기 · " + word;
    if (learningPad.lastWord && learningPad.lastWord !== word) learningPad.clear();
    learningPad.lastWord = word;
  }

  function boot() {
    scanCanvases(); updateLearningPad();
    if (window.MutationObserver) new MutationObserver(function () {
      scanCanvases(); updateLearningPad();
      if (lastOcr && !lastOcr.used) scheduleAutoMark(20);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}());
