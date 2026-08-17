/* WORD MASTER Glass Recall - OCR runtime bridge
 * Handwriting is handled only by handwriting-study.js.
 * This file intentionally stays small: it observes OCR responses and
 * automatically marks the answer as understood when a listed meaning/keyword matches.
 */
(function () {
  "use strict";

  var OCR_TTL = 12000;
  var lastOcr = null;
  var retryTimer = null;
  var observerTimer = null;

  function normalize(value) {
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
    return normalize(value)
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
    return normalize(el && (el.innerText || el.textContent || ""));
  }

  function extractOcrText(payload) {
    var keys, i, value;
    if (payload == null) return "";
    if (typeof payload === "string") return payload;
    keys = ["text", "recognizedText", "recognized_text", "ocrText", "ocr_text", "fullText", "description"];
    for (i = 0; i < keys.length; i += 1) {
      value = payload[keys[i]];
      if (typeof value === "string" && normalize(value)) return value;
    }
    try {
      if (payload.responses && payload.responses[0]) {
        value = payload.responses[0].fullTextAnnotation && payload.responses[0].fullTextAnnotation.text;
        if (typeof value === "string" && normalize(value)) return value;
        value = payload.responses[0].textAnnotations && payload.responses[0].textAnnotations[0] && payload.responses[0].textAnnotations[0].description;
        if (typeof value === "string" && normalize(value)) return value;
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
    text = normalize(text);
    if (!text) return;
    lastOcr = { text: text, at: Date.now(), used: false };
    scheduleCheck(0);
  }

  if (window.fetch) {
    var nativeFetch = window.fetch;
    window.fetch = function (input) {
      var args = arguments;
      return nativeFetch.apply(this, args).then(function (response) {
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
    var nativeOpen = window.XMLHttpRequest.prototype.open;
    var nativeSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      this.__wmOcr = isOcrUrl(url);
      return nativeOpen.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      if (xhr.__wmOcr) {
        xhr.addEventListener("load", function () {
          var value = "";
          try { value = extractOcrText(JSON.parse(xhr.responseText)); }
          catch (ignore) { value = xhr.responseText || ""; }
          registerOcr(value);
        });
      }
      return nativeSend.apply(this, arguments);
    };
  }

  function answerRoot() {
    var nodes = document.querySelectorAll("small,span,p,strong,h2,h3,div,section,article"), i, t, parent;
    for (i = 0; i < nodes.length; i += 1) {
      if (!visible(nodes[i])) continue;
      t = textOf(nodes[i]);
      if (!/^정답(?:\s|·|:|$)/.test(t) || /정답\s*보기/.test(t)) continue;
      parent = nodes[i].parentNode;
      return parent && parent.nodeType === 1 && visible(parent) ? parent : nodes[i];
    }
    return null;
  }

  function addCandidate(out, value) {
    var n = normalize(value), i;
    if (!n || n.length > 180) return;
    if (/^(정답|ocr|인식|채점|○|△|×|알았다|애매했다|몰랐다)/.test(n)) return;
    for (i = 0; i < out.length; i += 1) if (out[i] === n) return;
    out.push(n);
  }

  function answersFrom(root) {
    var out = [], nodes, i, value;
    if (!root || !root.querySelectorAll) return out;
    nodes = root.querySelectorAll("[data-answer],[data-keywords],strong,b,p,li");
    for (i = 0; i < nodes.length; i += 1) {
      if (!visible(nodes[i])) continue;
      if (nodes[i].getAttribute) {
        value = nodes[i].getAttribute("data-answer"); if (value) addCandidate(out, value);
        value = nodes[i].getAttribute("data-keywords"); if (value) addCandidate(out, value);
      }
      value = textOf(nodes[i]);
      if (/ocr|인식|정답|채점|알았다|애매했다|몰랐다/.test(value)) continue;
      addCandidate(out, value);
    }
    return out;
  }

  function usefulToken(token) {
    token = comparable(token).replace(/^~+/, "");
    if (!token) return false;
    if (/^[a-z0-9]+$/i.test(token)) return token.length >= 3;
    if (/^[가-힣]+$/.test(token)) {
      if (token.length < 2) return false;
      if (/^(그리고|그러나|또는|혹은|하는|하다|있는|있다|것을|것이|대한|위한|등을|등의|정도|경우)$/.test(token)) return false;
      return true;
    }
    return token.length >= 2;
  }

  function fragments(answers) {
    var out = [], seen = {}, i, j, k, variants, phrase, words, token;
    function put(value) {
      value = comparable(value).replace(/^~+/, "").replace(/^[-–—]+|[-–—]+$/g, "").replace(/^\s+|\s+$/g, "");
      if (!value || value.length < 2 || seen[value]) return;
      seen[value] = true; out.push(value);
    }
    for (i = 0; i < answers.length; i += 1) {
      variants = normalize(answers[i]).split(/[,;\/|·•\n]+/);
      for (j = 0; j < variants.length; j += 1) {
        phrase = variants[j].replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
        put(phrase);
        words = comparable(phrase).split(/\s+/);
        for (k = 0; k < words.length; k += 1) {
          token = words[k];
          if (usefulToken(token)) put(token);
        }
      }
    }
    return out;
  }

  function partialMatch(ocr, answers) {
    var target = comparable(ocr), parts = fragments(answers), words, wordMap = {}, i, part;
    if (!target) return false;
    words = target.split(/\s+/);
    for (i = 0; i < words.length; i += 1) wordMap[words[i]] = true;
    for (i = 0; i < parts.length; i += 1) {
      part = parts[i];
      if (target === part) return true;
      if (part.indexOf(" ") >= 0 && (" " + target + " ").indexOf(" " + part + " ") >= 0) return true;
      if (part.indexOf(" ") < 0 && wordMap[part]) return true;
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
    el.textContent = "OCR 핵심 정답 포함 · 자동 이해 처리";
    el.style.cssText = "position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147483647;padding:9px 13px;border-radius:999px;background:rgba(16,43,79,.9);color:#fff;font:600 13px/1.2 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;pointer-events:none";
    document.body.appendChild(el);
    window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1400);
  }

  function check() {
    retryTimer = null;
    if (!lastOcr || lastOcr.used) return;
    if (Date.now() - lastOcr.at > OCR_TTL) { lastOcr = null; return; }
    var root = answerRoot();
    if (!root) return;
    var answers = answersFrom(root);
    if (!partialMatch(lastOcr.text, answers)) return;
    var button = positiveButton();
    if (!button) return;
    lastOcr.used = true;
    toast();
    try { button.click(); } catch (ignore) {}
  }

  function scheduleCheck(delay) {
    if (retryTimer) window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(check, delay == null ? 40 : delay);
  }

  function mutationCheck() {
    if (!lastOcr || lastOcr.used) return;
    if (observerTimer) return;
    observerTimer = window.setTimeout(function () {
      observerTimer = null;
      scheduleCheck(0);
    }, 80);
  }

  if (window.MutationObserver) {
    new MutationObserver(mutationCheck).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }
}());
