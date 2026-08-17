/* WORD MASTER Glass Recall lightweight runtime enhancement
 * 2026-08-17
 * - Removes the heavy live-ink overlay / global pointer listener wrapping.
 * - Keeps only low-cost S Pen browser-gesture fixes on the app canvas.
 * - Adds a lightweight incremental handwriting pad to learning views.
 * - OCR accepts one listed meaning/keyword as a correct answer.
 * ES5-friendly for old WebKit.
 */
(function () {
  "use strict";

  var OCR_TTL = 12000;
  var lastOcr = null;
  var retryTimer = null;
  var scanTimer = null;
  var learningPad = null;

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
    return !style || (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0");
  }

  function textOf(el) {
    return normalizeAnswer(el && (el.innerText || el.textContent || ""));
  }

  function extractOcrText(payload) {
    var keys, i, value;
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
    if (payload.data && typeof payload.data === "object") {
      value = extractOcrText(payload.data);
      if (value) return value;
    }
    if (payload.result && typeof payload.result === "object") {
      value = extractOcrText(payload.result);
      if (value) return value;
    }
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
          clone.json().then(function (data) {
            registerOcr(extractOcrText(data));
          }, function () {
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
      if (xhr.__wmOcrRequest) {
        xhr.addEventListener("load", function () {
          var value = "";
          try { value = extractOcrText(JSON.parse(xhr.responseText)); }
          catch (ignore) { value = xhr.responseText || ""; }
          registerOcr(value);
        });
      }
      return originalSend.apply(this, arguments);
    };
  }

  function ownTextStartsWithAnswer(el) {
    var text = textOf(el);
    return /^정답(?:\s|·|:|$)/.test(text) && !/정답\s*보기/.test(text);
  }

  function findAnswerRoot() {
    var nodes = document.querySelectorAll("small,span,p,strong,h2,h3,div,section,article");
    var i, node, parent;
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
    var out = [], nodes, i, value;
    if (!root || !root.querySelectorAll) return out;
    nodes = root.querySelectorAll("strong,b,p,li,[data-answer]");
    for (i = 0; i < nodes.length; i += 1) {
      if (!visible(nodes[i])) continue;
      value = textOf(nodes[i]);
      if (/ocr|인식|정답|채점|알았다|애매했다|몰랐다/.test(value)) continue;
      addCandidate(out, value);
    }
    return out;
  }

  function usefulToken(token) {
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
    var out = [], seen = {}, i, j, k, variants, phrase, words, token;
    function put(value) {
      value = comparable(value)
        .replace(/^~+/, "")
        .replace(/^[-–—]+|[-–—]+$/g, "")
        .replace(/^\s+|\s+$/g, "");
      if (!value || value.length < 2 || seen[value]) return;
      seen[value] = true;
      out.push(value);
    }
    for (i = 0; i < answers.length; i += 1) {
      variants = normalizeAnswer(answers[i]).split(/[,;\/|·•\n]+/);
      for (j = 0; j < variants.length; j += 1) {
        phrase = variants[j].replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
        put(phrase);
        words = comparable(phrase).split(/\s+/);
        for (k = 0; k < words.length; k += 1) {
          token = words[k].replace(/^~+/, "");
          if (usefulToken(token)) put(token);
        }
      }
    }
    return out;
  }

  function partialMeaningMatch(ocr, answers) {
    var target = comparable(ocr), fragments = answerFragments(answers), tokens, tokenMap = {}, i, f;
    if (!target) return false;
    tokens = target.split(/\s+/);
    for (i = 0; i < tokens.length; i += 1) tokenMap[tokens[i]] = true;
    for (i = 0; i < fragments.length; i += 1) {
      f = fragments[i];
      if (target === f) return true;
      if (f.indexOf(" ") >= 0 && (" " + target + " ").indexOf(" " + f + " ") >= 0) return true;
      if (f.indexOf(" ") < 0 && tokenMap[f]) return true;
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
    el.textContent = message || "OCR 핵심 정답 포함 · 자동 이해 처리";
    el.style.cssText = "position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147483647;padding:9px 13px;border-radius:999px;background:rgba(16,43,79,.9);color:#fff;font:600 13px/1.2 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;pointer-events:none";
    document.body.appendChild(el);
    window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1400);
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
    retryTimer = window.setTimeout(function () {
      retryTimer = null;
      tryAutoMark();
    }, delay == null ? 40 : delay);
  }

  /* Low-cost S Pen preparation only. No overlay canvas, no global listener patch. */
  function prepareCanvas(canvas) {
    if (!canvas || canvas.__wmPenPrepared || canvas.__wmPracticePad) return;
    canvas.__wmPenPrepared = true;
    try {
      canvas.style.touchAction = "none";
      canvas.style.msTouchAction = "none";
      canvas.style.webkitUserSelect = "none";
      canvas.style.userSelect = "none";
      canvas.style.webkitTapHighlightColor = "transparent";
      canvas.style.overscrollBehavior = "contain";
      var ctx = canvas.getContext && canvas.getContext("2d");
      if (ctx) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if ("imageSmoothingEnabled" in ctx) ctx.imageSmoothingEnabled = true;
      }
    } catch (ignore) {}

    if (window.PointerEvent && canvas.addEventListener) {
      canvas.addEventListener("pointerdown", function (event) {
        if (event.pointerType !== "pen" && event.pointerType !== "touch") return;
        try {
          if (canvas.setPointerCapture && event.pointerId != null) canvas.setPointerCapture(event.pointerId);
        } catch (ignore2) {}
      }, { passive: true });
      canvas.addEventListener("pointerup", function (event) {
        try {
          if (canvas.releasePointerCapture && event.pointerId != null && (!canvas.hasPointerCapture || canvas.hasPointerCapture(event.pointerId))) {
            canvas.releasePointerCapture(event.pointerId);
          }
        } catch (ignore2) {}
      }, { passive: true });
    }
  }

  function makeButton(text, action) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.style.cssText = "border:0;border-radius:999px;padding:8px 12px;background:rgba(255,255,255,.72);color:#173454;font:600 12px/1 system-ui,-apple-system,sans-serif;box-shadow:inset 0 0 0 1px rgba(32,72,112,.10);";
    b.addEventListener("click", action);
    return b;
  }

  function setupPracticeCanvas(canvas) {
    canvas.__wmPracticePad = true;
    var ctx = canvas.getContext("2d");
    var drawing = false, pointerId = null, last = null;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var old = null;
      try { if (canvas.width && canvas.height) old = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch (ignore) {}
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#102b4f";
      ctx.lineWidth = 2.4;
      if (old) {
        try {
          var temp = document.createElement("canvas");
          temp.width = old.width; temp.height = old.height;
          temp.getContext("2d").putImageData(old, 0, 0);
          ctx.drawImage(temp, 0, 0, rect.width, rect.height);
        } catch (ignore2) {}
      }
    }

    function point(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function segment(a, b) {
      if (!a || !b) return;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    function down(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      drawing = true;
      pointerId = e.pointerId;
      last = point(e);
      try { if (canvas.setPointerCapture) canvas.setPointerCapture(pointerId); } catch (ignore) {}
      if (e.cancelable) e.preventDefault();
    }

    function move(e) {
      if (!drawing || (pointerId != null && e.pointerId !== pointerId)) return;
      var events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      var i, p;
      for (i = 0; i < events.length; i += 1) {
        p = point(events[i]);
        segment(last, p);
        last = p;
      }
      if (e.cancelable) e.preventDefault();
    }

    function up(e) {
      if (!drawing || (pointerId != null && e.pointerId !== pointerId)) return;
      drawing = false; last = null;
      try { if (canvas.releasePointerCapture) canvas.releasePointerCapture(pointerId); } catch (ignore) {}
      pointerId = null;
      if (e.cancelable) e.preventDefault();
    }

    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", down, { passive: false });
    canvas.addEventListener("pointermove", move, { passive: false });
    canvas.addEventListener("pointerup", up, { passive: false });
    canvas.addEventListener("pointercancel", up, { passive: false });
    resize();
    return {
      clear: function () {
        var r = canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, r.width, r.height);
      }
    };
  }

  function learningHost() {
    var buttons = document.querySelectorAll("button"), hasReadOne = false, hasReadTwo = false, i, t, node;
    for (i = 0; i < buttons.length; i += 1) {
      if (!visible(buttons[i])) continue;
      t = textOf(buttons[i]);
      if (t === "1회") hasReadOne = true;
      if (t === "2회") hasReadTwo = true;
    }
    if (!hasReadOne || !hasReadTwo) return null;
    node = document.querySelector(".legacy-learning");
    if (node && visible(node)) return node;
    var sections = document.querySelectorAll("section,article,main>div");
    for (i = 0; i < sections.length; i += 1) {
      t = textOf(sections[i]);
      if (visible(sections[i]) && t.indexOf("1회") >= 0 && t.indexOf("2회") >= 0) return sections[i];
    }
    return document.querySelector("main") || document.getElementById("root") || document.body;
  }

  function ensureLearningPad() {
    var host = learningHost();
    if (!host) {
      if (learningPad && learningPad.wrap && learningPad.wrap.parentNode) learningPad.wrap.parentNode.removeChild(learningPad.wrap);
      learningPad = null;
      return;
    }
    if (learningPad && learningPad.wrap && learningPad.wrap.parentNode) return;

    var wrap = document.createElement("section");
    wrap.id = "wm-learning-writing-pad";
    wrap.style.cssText = "margin:14px 0;padding:12px;border-radius:22px;background:rgba(255,255,255,.55);box-shadow:inset 0 0 0 1px rgba(28,67,106,.10);";

    var head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px;";
    var label = document.createElement("strong");
    label.textContent = "쓰면서 익히기";
    label.style.cssText = "font:700 13px/1.2 system-ui,-apple-system,sans-serif;color:#173454;";
    head.appendChild(label);

    var actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:6px;";
    head.appendChild(actions);
    wrap.appendChild(head);

    var canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:150px;border-radius:16px;background:rgba(255,255,255,.76);box-shadow:inset 0 0 0 1px rgba(28,67,106,.08);touch-action:none;";
    wrap.appendChild(canvas);

    host.appendChild(wrap);
    var api = setupPracticeCanvas(canvas);
    actions.appendChild(makeButton("지우기", function () { api.clear(); }));
    actions.appendChild(makeButton("접기", function (e) {
      var hidden = canvas.style.display === "none";
      canvas.style.display = hidden ? "block" : "none";
      e.currentTarget.textContent = hidden ? "접기" : "펼치기";
    }));
    learningPad = { wrap: wrap, canvas: canvas, api: api };
  }

  function scan() {
    scanTimer = null;
    var canvases = document.getElementsByTagName("canvas"), i;
    for (i = 0; i < canvases.length; i += 1) prepareCanvas(canvases[i]);
    ensureLearningPad();
    if (lastOcr && !lastOcr.used) scheduleAutoMark(20);
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = window.setTimeout(scan, 80);
  }

  function boot() {
    scan();
    if (window.MutationObserver) {
      new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}());
