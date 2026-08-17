/* WORD MASTER Glass Recall - handwriting study engine
 * Rebuilt from scratch for low-latency pen study.
 * - Incremental vector drawing: no full-canvas redraw on every move
 * - Pointer coalescing when supported
 * - S Pen barrel button => temporary eraser while held
 * - Pen eraser end => eraser
 * - Palm rejection while a pen is active/recently active
 * - Undo / redo / clear
 * - Touch fallback for older WebKit
 */
(function () {
  "use strict";

  var PANEL_ID = "wm-write-study-panel-v2";
  var STYLE_ID = "wm-write-study-style-v2";
  var activePanel = null;
  var scanTimer = null;

  function textOf(el) {
    return String(el && (el.innerText || el.textContent || "")).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    var style;
    try { style = window.getComputedStyle(el); } catch (ignore) { return true; }
    return !style || (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0");
  }

  function closestBlock(el) {
    var node = el, depth = 0;
    while (node && node !== document.body && depth < 7) {
      if (node.tagName === "SECTION" || node.tagName === "ARTICLE") return node;
      if (node.className && typeof node.className === "string" && /(learning|study|card|glass)/i.test(node.className)) return node;
      node = node.parentNode;
      depth += 1;
    }
    return el && el.parentNode ? el.parentNode : el;
  }

  function commonAncestor(a, b) {
    if (!a || !b) return a || b;
    var seen = [], node = a, i;
    while (node) { seen.push(node); node = node.parentNode; }
    node = b;
    while (node) {
      for (i = 0; i < seen.length; i += 1) if (seen[i] === node) return node;
      node = node.parentNode;
    }
    return a.parentNode;
  }

  function findLearningAnchor() {
    var legacy = document.querySelector && document.querySelector(".legacy-learning");
    if (legacy && visible(legacy)) return legacy;

    var buttons = document.querySelectorAll ? document.querySelectorAll("button") : [];
    var one = null, two = null, i, t;
    for (i = 0; i < buttons.length; i += 1) {
      if (!visible(buttons[i])) continue;
      t = textOf(buttons[i]);
      if (t === "1회") one = buttons[i];
      else if (t === "2회") two = buttons[i];
    }
    if (!one && !two) return null;
    return closestBlock(commonAncestor(one || two, two || one));
  }

  function wordKey(anchor) {
    if (!anchor || !anchor.querySelectorAll) return "";
    var nodes = anchor.querySelectorAll("h1,h2,h3,strong,b"), i, t;
    for (i = 0; i < nodes.length; i += 1) {
      if (!visible(nodes[i])) continue;
      t = textOf(nodes[i]);
      if (!t || /WORD MASTER|DAY\s*\d+/i.test(t) || t === "1회" || t === "2회") continue;
      return t;
    }
    return textOf(anchor).slice(0, 120);
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
      "@media (prefers-reduced-motion:reduce){#" + PANEL_ID + " *{transition:none!important;animation:none!important}}";
    (document.head || document.documentElement).appendChild(style);
  }

  function InkEngine(canvas, options) {
    this.canvas = canvas;
    this.options = options || {};
    this.ctx = canvas.getContext("2d");
    this.strokes = [];
    this.redoStack = [];
    this.current = null;
    this.manualTool = "pen";
    this.activePointerId = null;
    this.activePenCount = 0;
    this.lastPenAt = 0;
    this.dpr = 1;
    this.baseWidth = this.options.baseWidth || 2.45;
    this.eraserWidth = this.options.eraserWidth || 24;
    this.onChange = this.options.onChange || function () {};
    this.onToolState = this.options.onToolState || function () {};
    this.bound = [];
    this.resizeTimer = null;
    this.bind();
    this.resize();
  }

  InkEngine.prototype.listen = function (target, type, fn, options) {
    target.addEventListener(type, fn, options || false);
    this.bound.push([target, type, fn, options || false]);
  };

  InkEngine.prototype.destroy = function () {
    var i;
    for (i = 0; i < this.bound.length; i += 1) {
      try { this.bound[i][0].removeEventListener(this.bound[i][1], this.bound[i][2], this.bound[i][3]); } catch (ignore) {}
    }
    this.bound = [];
  };

  InkEngine.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.options.maxDpr || 1.75);
    var width = Math.max(1, Math.round(rect.width * this.dpr));
    var height = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.redraw();
  };

  InkEngine.prototype.point = function (event) {
    var r = this.canvas.getBoundingClientRect();
    var pressure = typeof event.pressure === "number" && event.pressure > 0 ? event.pressure : 0.5;
    return { x: event.clientX - r.left, y: event.clientY - r.top, p: pressure };
  };

  InkEngine.prototype.penButtonEraser = function (event) {
    if (!event || event.pointerType !== "pen") return false;
    return event.button === 2 || event.button === 5 || !!(event.buttons & 2) || !!(event.buttons & 32);
  };

  InkEngine.prototype.effectiveTool = function (event) {
    if (this.penButtonEraser(event)) return "eraser";
    return this.manualTool;
  };

  InkEngine.prototype.shouldIgnorePointer = function (event) {
    if (!event) return true;
    if (event.pointerType === "touch" && (this.activePenCount > 0 || Date.now() - this.lastPenAt < 700)) return true;
    if (event.pointerType === "mouse" && event.button !== 0 && event.button !== -1) return true;
    return false;
  };

  InkEngine.prototype.beginStroke = function (event) {
    if (this.shouldIgnorePointer(event)) return;
    if (event.pointerType === "pen") {
      this.activePenCount += 1;
      this.lastPenAt = Date.now();
    }
    this.activePointerId = event.pointerId;
    var tool = this.effectiveTool(event);
    var p = this.point(event);
    this.current = { tool: tool, points: [p] };
    this.strokes.push(this.current);
    this.redoStack = [];
    this.drawDot(p, tool);
    try { if (this.canvas.setPointerCapture && event.pointerId != null) this.canvas.setPointerCapture(event.pointerId); } catch (ignore) {}
    this.onToolState(tool, tool !== this.manualTool);
    this.onChange(this);
    if (event.cancelable) event.preventDefault();
  };

  InkEngine.prototype.switchStrokeTool = function (tool, point) {
    if (!this.current || this.current.tool === tool) return;
    this.current = { tool: tool, points: [point] };
    this.strokes.push(this.current);
  };

  InkEngine.prototype.moveStroke = function (event) {
    if (this.activePointerId == null || event.pointerId !== this.activePointerId || !this.current) return;
    if (event.pointerType === "pen") this.lastPenAt = Date.now();
    var events = [event], i, p, previous, tool;
    try {
      if (event.getCoalescedEvents) {
        var coalesced = event.getCoalescedEvents();
        if (coalesced && coalesced.length) events = coalesced;
      }
    } catch (ignore) {}

    for (i = 0; i < events.length; i += 1) {
      tool = this.effectiveTool(events[i]);
      p = this.point(events[i]);
      this.switchStrokeTool(tool, p);
      previous = this.current.points[this.current.points.length - 1];
      if (previous && Math.abs(previous.x - p.x) + Math.abs(previous.y - p.y) < 0.18) continue;
      this.current.points.push(p);
      this.drawSegment(previous, p, tool);
    }
    this.onToolState(tool || this.current.tool, (tool || this.current.tool) !== this.manualTool);
    if (event.cancelable) event.preventDefault();
  };

  InkEngine.prototype.endStroke = function (event) {
    if (this.activePointerId == null || (event.pointerId != null && event.pointerId !== this.activePointerId)) return;
    if (event.pointerType === "pen") {
      this.activePenCount = Math.max(0, this.activePenCount - 1);
      this.lastPenAt = Date.now();
    }
    try {
      if (this.canvas.releasePointerCapture && event.pointerId != null && (!this.canvas.hasPointerCapture || this.canvas.hasPointerCapture(event.pointerId))) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    } catch (ignore) {}
    this.activePointerId = null;
    this.current = null;
    this.onToolState(this.manualTool, false);
    this.onChange(this);
    if (event.cancelable) event.preventDefault();
  };

  InkEngine.prototype.drawDot = function (p, tool) {
    var ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    ctx.fillStyle = "#102f4c";
    var radius = tool === "eraser" ? this.eraserWidth / 2 : Math.max(0.85, this.baseWidth * (0.68 + p.p * 0.38)) / 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2, false);
    ctx.fill();
    ctx.restore();
  };

  InkEngine.prototype.drawSegment = function (a, b, tool) {
    if (!a || !b) return;
    var ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = "#102f4c";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = tool === "eraser" ? this.eraserWidth : Math.max(1.25, this.baseWidth * (0.72 + ((a.p + b.p) / 2) * 0.5));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  };

  InkEngine.prototype.redraw = function () {
    var rect = this.canvas.getBoundingClientRect();
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    var i, j, stroke;
    for (i = 0; i < this.strokes.length; i += 1) {
      stroke = this.strokes[i];
      if (!stroke.points.length) continue;
      this.drawDot(stroke.points[0], stroke.tool);
      for (j = 1; j < stroke.points.length; j += 1) this.drawSegment(stroke.points[j - 1], stroke.points[j], stroke.tool);
    }
  };

  InkEngine.prototype.setTool = function (tool) {
    if (tool !== "pen" && tool !== "eraser") return;
    this.manualTool = tool;
    this.onToolState(tool, false);
  };

  InkEngine.prototype.undo = function () {
    if (!this.strokes.length) return;
    this.redoStack.push(this.strokes.pop());
    this.current = null;
    this.redraw();
    this.onChange(this);
  };

  InkEngine.prototype.redo = function () {
    if (!this.redoStack.length) return;
    this.strokes.push(this.redoStack.pop());
    this.redraw();
    this.onChange(this);
  };

  InkEngine.prototype.clear = function () {
    if (!this.strokes.length) return;
    this.redoStack = this.strokes.slice();
    this.strokes = [];
    this.current = null;
    this.redraw();
    this.onChange(this);
  };

  InkEngine.prototype.bind = function () {
    var self = this;
    this.canvas.style.touchAction = "none";
    this.canvas.style.webkitUserSelect = "none";
    this.listen(this.canvas, "contextmenu", function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });

    if (window.PointerEvent) {
      this.listen(this.canvas, "pointerdown", function (e) { self.beginStroke(e); }, { passive: false });
      this.listen(this.canvas, "pointermove", function (e) { self.moveStroke(e); }, { passive: false });
      this.listen(this.canvas, "pointerup", function (e) { self.endStroke(e); }, { passive: false });
      this.listen(this.canvas, "pointercancel", function (e) { self.endStroke(e); }, { passive: false });
      this.listen(this.canvas, "lostpointercapture", function (e) { if (self.activePointerId != null) self.endStroke(e); }, { passive: false });
    } else {
      var touchId = null;
      this.listen(this.canvas, "touchstart", function (e) {
        if (!e.changedTouches || !e.changedTouches.length) return;
        var t = e.changedTouches[0]; touchId = t.identifier;
        self.beginStroke({ pointerType: "touch", pointerId: touchId, button: 0, buttons: 1, clientX: t.clientX, clientY: t.clientY, pressure: 0.5, cancelable: e.cancelable, preventDefault: function () { e.preventDefault(); } });
      }, { passive: false });
      this.listen(this.canvas, "touchmove", function (e) {
        var i, t;
        for (i = 0; i < e.changedTouches.length; i += 1) if (e.changedTouches[i].identifier === touchId) t = e.changedTouches[i];
        if (!t) return;
        self.moveStroke({ pointerType: "touch", pointerId: touchId, button: -1, buttons: 1, clientX: t.clientX, clientY: t.clientY, pressure: 0.5, cancelable: e.cancelable, preventDefault: function () { e.preventDefault(); } });
      }, { passive: false });
      this.listen(this.canvas, "touchend", function (e) {
        self.endStroke({ pointerType: "touch", pointerId: touchId, cancelable: e.cancelable, preventDefault: function () { e.preventDefault(); } }); touchId = null;
      }, { passive: false });
    }

    this.listen(window, "resize", function () {
      if (self.resizeTimer) window.clearTimeout(self.resizeTimer);
      self.resizeTimer = window.setTimeout(function () { self.resize(); }, 120);
    }, false);
  };

  function button(label, action) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", action);
    return b;
  }

  function createPanel(anchor) {
    addStyles();
    var panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.setAttribute("data-word-key", wordKey(anchor));

    var head = document.createElement("div"); head.className = "wm-w-head";
    var title = document.createElement("div"); title.className = "wm-w-title"; title.textContent = "쓰면서 익히기";
    var status = document.createElement("div"); status.className = "wm-w-status"; status.textContent = "S Pen 버튼 = 지우개";
    head.appendChild(title); head.appendChild(status); panel.appendChild(head);

    var wrap = document.createElement("div"); wrap.className = "wm-w-canvas-wrap";
    var canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "단어 필기 연습장");
    wrap.appendChild(canvas); panel.appendChild(wrap);

    var toolbar = document.createElement("div"); toolbar.className = "wm-w-toolbar";
    var pen = button("펜", function () { engine.setTool("pen"); });
    var eraser = button("지우개", function () { engine.setTool("eraser"); });
    var undo = button("되돌리기", function () { engine.undo(); });
    var redo = button("다시", function () { engine.redo(); });
    var clear = button("전체 지우기", function () { engine.clear(); });
    toolbar.appendChild(pen); toolbar.appendChild(eraser); toolbar.appendChild(undo); toolbar.appendChild(redo); toolbar.appendChild(clear); panel.appendChild(toolbar);

    var help = document.createElement("p"); help.className = "wm-w-help";
    help.textContent = "S Pen으로 바로 써 보세요. 펜 버튼을 누른 채 화면에 닿으면 임시 지우개가 되고, 버튼을 떼면 다시 펜으로 돌아옵니다. 펜 입력 중에는 손바닥 터치를 자동으로 무시합니다.";
    panel.appendChild(help);

    if (anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor.nextSibling);

    var engine = new InkEngine(canvas, {
      maxDpr: 1.75,
      baseWidth: 2.45,
      eraserWidth: 25,
      onToolState: function (tool, temporary) {
        pen.setAttribute("aria-pressed", tool === "pen" ? "true" : "false");
        eraser.setAttribute("aria-pressed", tool === "eraser" ? "true" : "false");
        status.textContent = temporary && tool === "eraser" ? "S Pen 버튼 · 지우는 중" : "S Pen 버튼 = 지우개";
      },
      onChange: function (instance) {
        undo.disabled = !instance.strokes.length;
        redo.disabled = !instance.redoStack.length;
        clear.disabled = !instance.strokes.length;
      }
    });
    engine.onToolState("pen", false);
    engine.onChange(engine);

    return { panel: panel, engine: engine, anchor: anchor, key: wordKey(anchor) };
  }

  function removePanel() {
    if (!activePanel) return;
    try { activePanel.engine.destroy(); } catch (ignore) {}
    try { if (activePanel.panel.parentNode) activePanel.panel.parentNode.removeChild(activePanel.panel); } catch (ignore2) {}
    activePanel = null;
  }

  function syncPanel() {
    scanTimer = null;
    var anchor = findLearningAnchor();
    if (!anchor) { removePanel(); return; }
    var key = wordKey(anchor);
    if (activePanel && activePanel.anchor === anchor && activePanel.key === key && document.documentElement.contains(activePanel.panel)) return;
    removePanel();
    activePanel = createPanel(anchor);
  }

  function scheduleSync() {
    if (scanTimer) return;
    scanTimer = window.setTimeout(syncPanel, 120);
  }

  function boot() {
    scheduleSync();
    if (window.MutationObserver) {
      new MutationObserver(scheduleSync).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    }
  }

  window.WMHandwriting = {
    version: "2.0.0",
    create: function (canvas, options) { return new InkEngine(canvas, options); },
    refreshLearningPad: scheduleSync
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}());
