/* WORD MASTER Glass Recall runtime hotfix
 * - Exact OCR match => automatically mark as understood ("알았다")
 * - Improve pen continuity by disabling browser gestures on the drawing canvas,
 *   capturing the pointer, and enforcing rounded/smoothed 2D strokes.
 *
 * Kept ES5-friendly so the same file is harmless on the legacy iPad path.
 */
(function () {
  "use strict";

  var OCR_TTL = 10000;
  var lastOcr = null;
  var retryTimer = null;

  function normalizeAnswer(value) {
    var text = value == null ? "" : String(value);
    try {
      if (text.normalize) text = text.normalize("NFKC");
    } catch (ignore) {}
    return text
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    var style;
    try { style = window.getComputedStyle(el); } catch (ignore) { return true; }
    if (!style) return true;
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function textOf(el) {
    return normalizeAnswer(el && (el.innerText || el.textContent || ""));
  }

  function extractOcrText(payload) {
    var i, value, keys;
    if (payload == null) return "";
    if (typeof payload === "string") return payload;

    keys = ["text", "recognizedText", "recognized_text", "ocrText", "ocr_text", "fullText", "description"];
    for (i = 0; i < keys.length; i += 1) {
      value = payload[keys[i]];
      if (typeof value === "string" && normalizeAnswer(value)) return value;
    }

    /* Google Cloud Vision-shaped responses */
    try {
      if (payload.responses && payload.responses[0]) {
        value = payload.responses[0].fullTextAnnotation && payload.responses[0].fullTextAnnotation.text;
        if (typeof value === "string" && normalizeAnswer(value)) return value;
        value = payload.responses[0].textAnnotations && payload.responses[0].textAnnotations[0] && payload.responses[0].textAnnotations[0].description;
        if (typeof value === "string" && normalizeAnswer(value)) return value;
      }
    } catch (ignore2) {}

    /* Common proxy wrappers */
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

  /* Intercept fetch without consuming the response used by the app. */
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
            try {
              response.clone().text().then(registerOcr, function () {});
            } catch (ignore2) {}
          });
        } catch (ignore) {}
        return response;
      });
    };
  }

  /* XHR fallback, in case a later build switches away from fetch. */
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
          try {
            value = extractOcrText(JSON.parse(xhr.responseText));
          } catch (ignore) {
            value = xhr.responseText || "";
          }
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
      if (!visible(node)) continue;
      if (!ownTextStartsWithAnswer(node)) continue;
      parent = node.parentNode;
      if (parent && parent.nodeType === 1 && visible(parent)) return parent;
      return node;
    }
    return null;
  }

  function addCandidate(list, value) {
    var n = normalizeAnswer(value), i;
    if (!n || n.length > 180) return;
    if (/^(정답|OCR|인식|채점|○|△|×|알았다|애매했다|몰랐다)/.test(n)) return;
    for (i = 0; i < list.length; i += 1) if (list[i] === n) return;
    list.push(n);
  }

  function expectedAnswers(root) {
    var out = [], strongs, texts, i, combined = [];
    if (!root) return out;

    /* The current app and legacy app both favor strong text for the answer. */
    strongs = root.querySelectorAll ? root.querySelectorAll("strong,b") : [];
    for (i = 0; i < strongs.length; i += 1) {
      if (!visible(strongs[i])) continue;
      var s = textOf(strongs[i]);
      if (s && !/^[○△×]$/.test(s)) {
        addCandidate(out, s);
        combined.push(s);
      }
    }
    if (combined.length > 1) addCandidate(out, combined.join(" "));

    /* Fallback for a build that renders meanings as paragraphs/list items. */
    if (!out.length && root.querySelectorAll) {
      texts = root.querySelectorAll("p,li,[data-answer]");
      combined = [];
      for (i = 0; i < texts.length; i += 1) {
        if (!visible(texts[i])) continue;
        var p = textOf(texts[i]);
        if (/OCR|인식|정답|채점|알았다|애매했다|몰랐다/.test(p)) continue;
        addCandidate(out, p);
        if (p) combined.push(p);
      }
      if (combined.length > 1) addCandidate(out, combined.join(" "));
    }
    return out;
  }

  function exactMatch(ocr, answers) {
    var i, target = normalizeAnswer(ocr);
    if (!target) return false;
    for (i = 0; i < answers.length; i += 1) {
      if (target === normalizeAnswer(answers[i])) return true;
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

  function toast() {
    var old = document.getElementById("wm-ocr-auto-toast");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var el = document.createElement("div");
    el.id = "wm-ocr-auto-toast";
    el.textContent = "OCR 정답 일치 · 자동으로 이해 처리됨";
    el.style.cssText = "position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147483647;padding:10px 14px;border-radius:999px;background:rgba(16,43,79,.88);color:#fff;font:600 13px/1.2 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 8px 28px rgba(16,43,79,.18);pointer-events:none;opacity:1;transition:opacity .25s ease";
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
    if (!exactMatch(lastOcr.text, answers)) return;
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
    }, delay == null ? 30 : delay);
  }

  /* Pen / S Pen stability improvements. */
  function prepareCanvas(canvas) {
    if (!canvas || canvas.__wmPenPrepared) return;
    canvas.__wmPenPrepared = true;
    try {
      canvas.style.touchAction = "none";
      canvas.style.msTouchAction = "none";
      canvas.style.webkitUserSelect = "none";
      canvas.style.userSelect = "none";
      canvas.style.webkitTapHighlightColor = "transparent";
      canvas.style.overscrollBehavior = "contain";
    } catch (ignore) {}

    if (window.PointerEvent && canvas.addEventListener) {
      canvas.addEventListener("pointerdown", function (event) {
        if (event.pointerType === "pen" || event.pointerType === "touch") {
          try { if (canvas.setPointerCapture && event.pointerId != null) canvas.setPointerCapture(event.pointerId); } catch (ignore2) {}
          if (event.cancelable) event.preventDefault();
        }
      }, { capture: true, passive: false });
      canvas.addEventListener("pointermove", function (event) {
        if ((event.pointerType === "pen" || event.pointerType === "touch") && event.cancelable) event.preventDefault();
      }, { capture: true, passive: false });
    }
  }

  var originalGetContext = window.HTMLCanvasElement && window.HTMLCanvasElement.prototype && window.HTMLCanvasElement.prototype.getContext;
  if (originalGetContext) {
    window.HTMLCanvasElement.prototype.getContext = function () {
      var ctx = originalGetContext.apply(this, arguments);
      if (ctx && arguments[0] === "2d") {
        try {
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.imageSmoothingEnabled = true;
        } catch (ignore) {}
      }
      return ctx;
    };
  }

  function scanCanvases() {
    var canvases = document.getElementsByTagName("canvas"), i;
    for (i = 0; i < canvases.length; i += 1) prepareCanvas(canvases[i]);
  }

  function boot() {
    scanCanvases();
    if (window.MutationObserver) {
      new MutationObserver(function () {
        scanCanvases();
        if (lastOcr && !lastOcr.used) scheduleAutoMark(20);
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}());
