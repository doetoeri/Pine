/* WORD MASTER Glass Recall - test mode adapter
 * Reuses the same low-latency WMHandwriting InkEngine and the same study-pad UI
 * in tests. The old app/OCR canvas stays only as a hidden compatibility node;
 * it is no longer visible or used as the OCR image source.
 */
(function () {
  "use strict";

  if (!window.WMHandwriting || typeof window.WMHandwriting.create !== "function") return;

  var PANEL_ID = "wm-write-study-panel-v3";
  var STYLE_ID = "wm-write-study-test-style-v3";
  var active = null;
  var scanTimer = null;

  function now() { return Date.now ? Date.now() : +new Date(); }

  function textOf(el) {
    return String(el && (el.innerText || el.textContent || ""))
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    var s;
    try { s = window.getComputedStyle(el); } catch (ignore) { return true; }
    return !s || (s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0");
  }

  function contains(root, el) {
    if (!root || !el) return false;
    if (root.contains) return root.contains(el);
    while (el) {
      if (el === root) return true;
      el = el.parentNode;
    }
    return false;
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      "#" + PANEL_ID + "{margin:14px 0 18px;padding:14px;border-radius:24px;background:rgba(247,251,255,.78);border:1px solid rgba(65,105,145,.13);box-shadow:0 10px 34px rgba(24,57,92,.08);}" +
      "#" + PANEL_ID + " .wm-w-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}" +
      "#" + PANEL_ID + " .wm-w-title{font:700 15px/1.2 system-ui,-apple-system,sans-serif;color:#153452}" +
      "#" + PANEL_ID + " .wm-w-status{font:600 11px/1 system-ui,-apple-system,sans-serif;color:#52708d;background:rgba(255,255,255,.72);padding:7px 9px;border-radius:999px}" +
      "#" + PANEL_ID + " .wm-w-canvas-wrap{position:relative;height:230px;border-radius:18px;overflow:hidden;background:rgba(255,255,255,.82);box-shadow:inset 0 0 0 1px rgba(45,86,126,.10)}" +
      "#" + PANEL_ID + " canvas{display:block;width:100%;height:100%;touch-action:none!important;-ms-touch-action:none!important;user-select:none!important;-webkit-user-select:none!important;-webkit-touch-callout:none!important}" +
      "#" + PANEL_ID + " .wm-w-toolbar{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}" +
      "#" + PANEL_ID + " button{border:0;border-radius:999px;padding:9px 12px;background:rgba(255,255,255,.78);color:#173b5d;font:650 12px/1 system-ui,-apple-system,sans-serif;box-shadow:inset 0 0 0 1px rgba(38,80,120,.10)}" +
      "#" + PANEL_ID + " button[aria-pressed='true']{background:#173b5d;color:#fff}" +
      "#" + PANEL_ID + " button:disabled{opacity:.38}" +
      "#" + PANEL_ID + " .wm-w-help{margin:9px 2px 0;color:#688199;font:500 11px/1.45 system-ui,-apple-system,sans-serif}" +
      "[data-wm-old-ocr-canvas='hidden']{display:none!important}" +
      "[data-wm-old-ocr-wrap='hidden']{display:none!important}" +
      "@media (prefers-reduced-motion:reduce){#" + PANEL_ID + " *{transition:none!important;animation:none!important}}";
    (document.head || document.documentElement).appendChild(style);
  }

  /* S Pen barrel state shared by study and test engines. Samsung/Chromium can
     surface the side button as a pen secondary button or as a mouse-like
     secondary event while the pen is hovering. */
  var Pen = {
    barrelUntil: 0,
    eraserUntil: 0,
    lastPenAt: 0,
    note: function (e) {
      if (!e) return;
      var t = now();
      var buttons = typeof e.buttons === "number" ? e.buttons : 0;
      if (e.pointerType === "pen") this.lastPenAt = t;

      if (e.pointerType === "pen" && (e.button === 2 || (buttons & 2))) this.barrelUntil = t + 1200;
      if (e.pointerType === "pen" && (e.button === 5 || (buttons & 32))) this.eraserUntil = t + 1200;

      if ((!e.pointerType || e.pointerType === "mouse") &&
          (e.button === 2 || (buttons & 2)) &&
          (t - this.lastPenAt < 2200 || isWritingTarget(e.target))) {
        this.barrelUntil = t + 1200;
      }

      if ((e.type === "pointerup" || e.type === "mouseup" || e.type === "pointercancel") && buttons === 0) {
        if (e.button === 2) this.barrelUntil = t + 220;
        if (e.button === 5) this.eraserUntil = t + 220;
      }
    },
    direct: function (e) {
      if (!e) return false;
      var buttons = typeof e.buttons === "number" ? e.buttons : 0;
      if (e.pointerType === "pen") return e.button === 2 || e.button === 5 || !!(buttons & 2) || !!(buttons & 32);
      if (!e.pointerType || e.pointerType === "mouse") return e.button === 2 || !!(buttons & 2);
      return false;
    },
    armed: function () {
      var t = now();
      return t < this.barrelUntil || t < this.eraserUntil;
    }
  };

  function isWritingTarget(node) {
    while (node && node !== document) {
      if (node.tagName && String(node.tagName).toLowerCase() === "canvas") return true;
      if (node.id === "wm-write-study-panel-v2" || node.id === PANEL_ID) return true;
      node = node.parentNode;
    }
    return false;
  }

  function trackPen(e) { Pen.note(e); }
  if (window.PointerEvent && document.addEventListener) {
    document.addEventListener("pointerover", trackPen, true);
    document.addEventListener("pointermove", trackPen, true);
    document.addEventListener("pointerdown", trackPen, true);
    document.addEventListener("pointerup", trackPen, true);
    document.addEventListener("pointercancel", trackPen, true);
    if ("onpointerrawupdate" in window) document.addEventListener("pointerrawupdate", trackPen, true);
  }
  if (document.addEventListener) {
    document.addEventListener("mousedown", trackPen, true);
    document.addEventListener("mouseup", trackPen, true);
    document.addEventListener("contextmenu", function (e) {
      if (!isWritingTarget(e.target)) return;
      Pen.note(e);
      if (e.cancelable) e.preventDefault();
    }, true);
  }

  /* Patch InkEngine once so the exact same behavior applies in learning and test. */
  var probeCanvas = document.createElement("canvas");
  probeCanvas.style.cssText = "position:absolute;width:8px;height:8px;left:-9999px;top:-9999px";
  document.documentElement.appendChild(probeCanvas);
  var probe = window.WMHandwriting.create(probeCanvas, { maxDpr: 1 });
  var proto = Object.getPrototypeOf ? Object.getPrototypeOf(probe) : probe.__proto__;
  if (proto && !proto.__wmReusePenPatched) {
    proto.__wmReusePenPatched = true;
    var nativeEffective = proto.effectiveTool;
    var nativeIgnore = proto.shouldIgnorePointer;

    proto.effectiveTool = function (e) {
      Pen.note(e);
      if (Pen.direct(e) || Pen.armed()) return "eraser";
      return nativeEffective ? nativeEffective.call(this, e) : this.manualTool;
    };

    proto.shouldIgnorePointer = function (e) {
      Pen.note(e);
      if (e && (!e.pointerType || e.pointerType === "mouse") && (Pen.direct(e) || Pen.armed())) return false;
      return nativeIgnore ? nativeIgnore.call(this, e) : false;
    };
  }
  try { if (probe && probe.destroy) probe.destroy(); } catch (ignoreProbe) {}
  try { if (probeCanvas.parentNode) probeCanvas.parentNode.removeChild(probeCanvas); } catch (ignoreProbe2) {}

  function gradeButton() {
    var buttons = document.querySelectorAll ? document.querySelectorAll("button") : [];
    var i, t;
    for (i = 0; i < buttons.length; i += 1) {
      if (!visible(buttons[i])) continue;
      t = textOf(buttons[i]);
      if (/^(채점(?:하기)?|정답\s*보기|답\s*보기|답안\s*확인|OCR|인식)$/i.test(t)) return buttons[i];
      if (/채점|정답\s*보기|답안\s*확인|OCR\s*인식/i.test(t)) return buttons[i];
    }
    return null;
  }

  function candidateCanvases() {
    var root = document.getElementById("root");
    if (!root || !root.querySelectorAll) return [];
    var list = root.querySelectorAll("canvas"), out = [], i, c, r;
    for (i = 0; i < list.length; i += 1) {
      c = list[i];
      if (!visible(c)) continue;
      if (contains(document.getElementById(PANEL_ID), c)) continue;
      if (contains(document.getElementById("wm-write-study-panel-v2"), c)) continue;
      try { r = c.getBoundingClientRect(); } catch (ignore) { r = { width: 0, height: 0 }; }
      if (r.width < 120 || r.height < 70) continue;
      out.push({ canvas: c, area: r.width * r.height });
    }
    out.sort(function (a, b) { return b.area - a.area; });
    return out;
  }

  function testContext() {
    var grade = gradeButton();
    if (!grade) return null;
    var candidates = candidateCanvases();
    if (!candidates.length) return null;
    var nativeCanvas = candidates[0].canvas;
    var node = nativeCanvas.parentNode, depth = 0, contextText = "";
    while (node && node !== document.body && depth < 5) {
      contextText += " " + textOf(node);
      node = node.parentNode;
      depth += 1;
    }
    if (!/채점|정답|시험|TEST|답안|필기|쓰기|OCR|인식/i.test(contextText + " " + textOf(grade))) return null;
    return { nativeCanvas: nativeCanvas, grade: grade };
  }

  function questionKey(ctx) {
    var node = ctx && ctx.grade ? ctx.grade.parentNode : null;
    var depth = 0, nodes, i, t;
    while (node && node !== document.body && depth < 6) {
      if (node.querySelectorAll) {
        nodes = node.querySelectorAll("h1,h2,h3,strong,b,[data-word]");
        for (i = 0; i < nodes.length; i += 1) {
          if (!visible(nodes[i])) continue;
          t = textOf(nodes[i]);
          if (!t || /정답|채점|시험|TEST|DAY\s*\d+/i.test(t)) continue;
          if (t.length <= 100) return t;
        }
      }
      node = node.parentNode;
      depth += 1;
    }
    return textOf(ctx.grade.parentNode).slice(0, 120);
  }

  function button(label, action) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", action);
    return b;
  }

  function hideOldCanvas(canvas) {
    var info = {
      canvas: canvas,
      canvasStyle: canvas.getAttribute("style"),
      canvasMarker: canvas.getAttribute("data-wm-old-ocr-canvas"),
      wrap: null,
      wrapStyle: null,
      wrapMarker: null
    };
    canvas.setAttribute("data-wm-old-ocr-canvas", "hidden");

    var p = canvas.parentNode;
    if (p && p.nodeType === 1 && p.children && p.children.length === 1 && !textOf(p)) {
      info.wrap = p;
      info.wrapStyle = p.getAttribute("style");
      info.wrapMarker = p.getAttribute("data-wm-old-ocr-wrap");
      p.setAttribute("data-wm-old-ocr-wrap", "hidden");
    }
    return info;
  }

  function restoreOldCanvas(info) {
    if (!info || !info.canvas) return;
    try {
      if (info.canvasMarker == null) info.canvas.removeAttribute("data-wm-old-ocr-canvas");
      else info.canvas.setAttribute("data-wm-old-ocr-canvas", info.canvasMarker);
      if (info.canvasStyle == null) info.canvas.removeAttribute("style");
      else info.canvas.setAttribute("style", info.canvasStyle);
    } catch (ignore) {}
    if (info.wrap) {
      try {
        if (info.wrapMarker == null) info.wrap.removeAttribute("data-wm-old-ocr-wrap");
        else info.wrap.setAttribute("data-wm-old-ocr-wrap", info.wrapMarker);
        if (info.wrapStyle == null) info.wrap.removeAttribute("style");
        else info.wrap.setAttribute("style", info.wrapStyle);
      } catch (ignore2) {}
    }
  }

  function createPanel(ctx) {
    addStyles();
    var panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.setAttribute("data-mode", "test");

    var head = document.createElement("div"); head.className = "wm-w-head";
    var title = document.createElement("div"); title.className = "wm-w-title"; title.textContent = "쓰면서 익히기";
    var status = document.createElement("div"); status.className = "wm-w-status"; status.textContent = "이 필기가 OCR 답안입니다";
    head.appendChild(title); head.appendChild(status); panel.appendChild(head);

    var wrap = document.createElement("div"); wrap.className = "wm-w-canvas-wrap";
    var canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "시험 답안 필기장");
    wrap.appendChild(canvas); panel.appendChild(wrap);

    var toolbar = document.createElement("div"); toolbar.className = "wm-w-toolbar";
    var engine;
    var pen = button("펜", function () { engine.setTool("pen"); });
    var eraser = button("지우개", function () { engine.setTool("eraser"); });
    var undo = button("되돌리기", function () { engine.undo(); });
    var redo = button("다시", function () { engine.redo(); });
    var clear = button("전체 지우기", function () { engine.clear(); });
    toolbar.appendChild(pen); toolbar.appendChild(eraser); toolbar.appendChild(undo); toolbar.appendChild(redo); toolbar.appendChild(clear); panel.appendChild(toolbar);

    var help = document.createElement("p"); help.className = "wm-w-help";
    help.textContent = "학습할 때 쓰던 것과 같은 필기 엔진입니다. 여기에 쓴 내용이 그대로 OCR에 전달됩니다. S Pen 옆 버튼이나 뒤집개는 임시 지우개로 동작합니다.";
    panel.appendChild(help);

    var nativeWrap = ctx.nativeCanvas.parentNode;
    if (nativeWrap && nativeWrap.parentNode) nativeWrap.parentNode.insertBefore(panel, nativeWrap);
    else if (ctx.grade.parentNode) ctx.grade.parentNode.insertBefore(panel, ctx.grade);

    var hidden = hideOldCanvas(ctx.nativeCanvas);

    engine = window.WMHandwriting.create(canvas, {
      maxDpr: 1.75,
      baseWidth: 2.45,
      eraserWidth: 25,
      onToolState: function (tool, temporary) {
        pen.setAttribute("aria-pressed", tool === "pen" ? "true" : "false");
        eraser.setAttribute("aria-pressed", tool === "eraser" ? "true" : "false");
        status.textContent = temporary && tool === "eraser" ? "S Pen 버튼 · 지우는 중" : "이 필기가 OCR 답안입니다";
      },
      onChange: function (instance) {
        undo.disabled = !instance.strokes.length;
        redo.disabled = !instance.redoStack.length;
        clear.disabled = !instance.strokes.length;
      }
    });
    engine.onToolState("pen", false);
    engine.onChange(engine);

    return {
      panel: panel,
      canvas: canvas,
      engine: engine,
      hidden: hidden,
      nativeCanvas: ctx.nativeCanvas,
      key: questionKey(ctx)
    };
  }

  function destroyActive() {
    if (!active) return;
    try { if (active.engine && active.engine.destroy) active.engine.destroy(); } catch (ignore) {}
    try { restoreOldCanvas(active.hidden); } catch (ignore2) {}
    try { if (active.panel && active.panel.parentNode) active.panel.parentNode.removeChild(active.panel); } catch (ignore3) {}
    active = null;
  }

  function sync() {
    scanTimer = null;
    var ctx = testContext();
    if (!ctx) { destroyActive(); return; }

    if (!active || active.nativeCanvas !== ctx.nativeCanvas || !document.documentElement.contains(active.panel)) {
      destroyActive();
      active = createPanel(ctx);
      return;
    }

    var key = questionKey(ctx);
    if (key !== active.key) {
      active.key = key;
      active.engine.clear();
      active.engine.redoStack = [];
    }
  }

  function schedule() {
    if (scanTimer) return;
    scanTimer = window.setTimeout(sync, 100);
  }

  function boot() {
    addStyles();
    schedule();
    if (window.MutationObserver) {
      new MutationObserver(schedule).observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  }

  window.WMTestReuse = {
    version: "1.0.0",
    refresh: schedule,
    getCanvas: function () { return active ? active.canvas : null; },
    getEngine: function () { return active ? active.engine : null; },
    getHiddenNativeCanvas: function () { return active ? active.nativeCanvas : null; },
    penState: Pen
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}());