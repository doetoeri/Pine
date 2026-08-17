/* WORD MASTER Glass Recall - unified handwriting bridge
 * 2026-08-18
 * One InkEngine for learning + test.
 * - exactly one test canvas is taken over
 * - learning practice canvas is hidden while test canvas is active
 * - S Pen barrel button accepts native pen events AND Samsung/Chromium mouse-like secondary events
 * - barrel state is tracked during hover/contact and latched for the current stroke
 */
(function () {
  "use strict";

  if (!window.WMHandwriting || typeof window.WMHandwriting.create !== "function") return;

  var STYLE_ID = "wm-unified-test-ink-style-v2";
  var TEST_CLASS = "wm-unified-test-mode";
  var record = null;
  var scanTimer = null;
  var saved = {};

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

  function closestCanvas(node) {
    while (node && node !== document) {
      if (node.tagName && String(node.tagName).toLowerCase() === "canvas") return node;
      node = node.parentNode;
    }
    return null;
  }

  function isLearningCanvas(canvas) {
    if (!canvas) return false;
    var p2 = document.getElementById("wm-write-study-panel-v2");
    var p3 = document.getElementById("wm-write-study-panel-v3");
    return !!((p2 && contains(p2, canvas)) || (p3 && contains(p3, canvas)));
  }

  function isInkTarget(node) {
    var canvas = closestCanvas(node);
    if (canvas) {
      if (isLearningCanvas(canvas)) return true;
      if (canvas.__wmUnifiedTestEngine) return true;
      if (record && record.canvas === canvas) return true;
    }
    while (node && node !== document) {
      if (node.id === "wm-write-study-panel-v2" || node.id === "wm-write-study-panel-v3") return true;
      if (node.className && typeof node.className === "string" && /wm-unified-test-tools/.test(node.className)) return true;
      node = node.parentNode;
    }
    return false;
  }

  /* Samsung/Chromium can expose the S Pen barrel button either as a pen
     secondary button or as a mouse-like secondary input. Track both.
     A real mouse right-click over a writing canvas therefore also behaves as
     a temporary eraser, which is a useful fallback rather than a harmful one. */
  var Pen = {
    barrelHeld: false,
    barrelUntil: 0,
    eraserUntil: 0,
    lastPenAt: 0,
    lastSecondaryAt: 0,

    penEvent: function (e) {
      return !!(e && e.pointerType === "pen");
    },

    secondaryBits: function (e) {
      var buttons = e && typeof e.buttons === "number" ? e.buttons : 0;
      return !!(e && (e.button === 2 || (buttons & 2)));
    },

    eraserBits: function (e) {
      var buttons = e && typeof e.buttons === "number" ? e.buttons : 0;
      return !!(e && (e.button === 5 || (buttons & 32)));
    },

    relevantMouseSecondary: function (e) {
      if (!e) return false;
      var type = e.pointerType;
      if (type && type !== "mouse") return false;
      if (!(e.button === 2 || (typeof e.buttons === "number" && (e.buttons & 2)))) return false;
      return isInkTarget(e.target) || now() - this.lastPenAt < 1800;
    },

    note: function (e) {
      if (!e) return;
      var t = now();
      var buttons = typeof e.buttons === "number" ? e.buttons : 0;

      if (this.penEvent(e)) {
        this.lastPenAt = t;

        if (e.button === 5 || (buttons & 32)) this.eraserUntil = t + 1200;
        else if (e.type === "pointerup" && e.button === 5) this.eraserUntil = 0;

        if (e.button === 2 || (buttons & 2)) {
          this.barrelHeld = true;
          this.barrelUntil = t + 1400;
          this.lastSecondaryAt = t;
        } else if (e.type === "pointerup" && e.button === 2) {
          this.barrelHeld = false;
          this.barrelUntil = t + 70;
        }
        return;
      }

      if (this.relevantMouseSecondary(e)) {
        this.lastSecondaryAt = t;
        if (e.type === "mouseup" || e.type === "pointerup" || e.type === "auxclick") {
          this.barrelHeld = false;
          this.barrelUntil = t + 90;
        } else {
          this.barrelHeld = true;
          this.barrelUntil = t + 1600;
        }
      }
    },

    context: function (e) {
      if (!e || !(isInkTarget(e.target) || now() - this.lastPenAt < 1800)) return;
      this.lastSecondaryAt = now();
      this.barrelUntil = now() + 900;
    },

    direct: function (e) {
      if (!e) return false;
      if (this.penEvent(e)) return this.secondaryBits(e) || this.eraserBits(e);
      return this.relevantMouseSecondary(e);
    },

    armed: function () {
      var t = now();
      return this.barrelHeld || t < this.barrelUntil || t < this.eraserUntil;
    },

    clearBarrel: function () {
      this.barrelHeld = false;
      this.barrelUntil = 0;
    }
  };

  function globalPenTrack(e) { Pen.note(e); }

  if (document.addEventListener) {
    if (window.PointerEvent) {
      document.addEventListener("pointerover", globalPenTrack, true);
      document.addEventListener("pointermove", globalPenTrack, true);
      document.addEventListener("pointerdown", globalPenTrack, true);
      document.addEventListener("pointerup", globalPenTrack, true);
      document.addEventListener("pointercancel", globalPenTrack, true);
      if ("onpointerrawupdate" in window) document.addEventListener("pointerrawupdate", globalPenTrack, true);
    }
    document.addEventListener("mousedown", globalPenTrack, true);
    document.addEventListener("mousemove", globalPenTrack, true);
    document.addEventListener("mouseup", globalPenTrack, true);
    document.addEventListener("auxclick", globalPenTrack, true);
    document.addEventListener("contextmenu", function (e) {
      Pen.context(e);
      if (isInkTarget(e.target) && e.cancelable) e.preventDefault();
    }, true);
  }

  /* Get the real InkEngine prototype without duplicating it. Every learning
     pad and every test canvas keeps using this exact same constructor. */
  var probeCanvas = document.createElement("canvas");
  probeCanvas.width = 8;
  probeCanvas.height = 8;
  var probe = window.WMHandwriting.create(probeCanvas, { maxDpr: 1 });
  var proto = Object.getPrototypeOf ? Object.getPrototypeOf(probe) : probe.__proto__;

  if (proto && !proto.__wmUnifiedPenPatchedV2) {
    proto.__wmUnifiedPenPatchedV2 = true;

    var nativeEffective = proto.effectiveTool;
    var nativeBegin = proto.beginStroke;
    var nativeMove = proto.moveStroke;
    var nativeEnd = proto.endStroke;

    proto.effectiveTool = function (e) {
      if (e && e.pointerType === "pen") {
        Pen.note(e);
        if (Pen.direct(e)) this.__wmBarrelStroke = true;
        if (this.__wmBarrelStroke || Pen.armed()) return "eraser";
      }
      return nativeEffective ? nativeEffective.call(this, e) : this.manualTool;
    };

    proto.beginStroke = function (e) {
      if (e && e.pointerType === "pen") {
        Pen.note(e);
        this.__wmBarrelStroke = Pen.direct(e) || Pen.armed();
      } else {
        this.__wmBarrelStroke = false;
      }
      return nativeBegin.call(this, e);
    };

    proto.moveStroke = function (e) {
      if (e && e.pointerType === "pen") {
        Pen.note(e);
        if (Pen.direct(e) || Pen.armed()) this.__wmBarrelStroke = true;
      }
      return nativeMove.call(this, e);
    };

    proto.endStroke = function (e) {
      var result = nativeEnd.call(this, e);
      this.__wmBarrelStroke = false;
      return result;
    };
  }

  try { if (probe && probe.destroy) probe.destroy(); } catch (ignoreProbe) {}

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      "." + TEST_CLASS + " #wm-write-study-panel-v2,." + TEST_CLASS + " #wm-write-study-panel-v3{display:none!important}" +
      ".wm-unified-test-tools{margin:8px 0 4px;padding:8px 10px;border-radius:16px;background:rgba(247,251,255,.74);border:1px solid rgba(65,105,145,.10)}" +
      ".wm-unified-test-head{display:flex;align-items:center;justify-content:space-between;gap:8px}" +
      ".wm-unified-test-title{font:700 12px/1.2 system-ui,-apple-system,sans-serif;color:#173b5d}" +
      ".wm-unified-test-status{font:600 10px/1.2 system-ui,-apple-system,sans-serif;color:#617d98}" +
      ".wm-unified-test-bar{display:flex;flex-wrap:wrap;gap:7px;margin-top:7px}" +
      ".wm-unified-test-bar button{border:0;border-radius:999px;padding:8px 11px;background:rgba(255,255,255,.84);color:#173b5d;font:650 12px/1 system-ui,-apple-system,sans-serif;box-shadow:inset 0 0 0 1px rgba(38,80,120,.10)}" +
      ".wm-unified-test-bar button[aria-pressed='true']{background:#173b5d;color:#fff}" +
      ".wm-unified-test-bar button:disabled{opacity:.38}";
    (document.head || document.documentElement).appendChild(s);
  }

  function setTestMode(on) {
    var root = document.documentElement;
    if (!root) return;
    if (on) {
      if ((" " + root.className + " ").indexOf(" " + TEST_CLASS + " ") < 0) {
        root.className = (root.className ? root.className + " " : "") + TEST_CLASS;
      }
    } else {
      root.className = (" " + root.className + " ")
        .replace(" " + TEST_CLASS + " ", " ")
        .replace(/^\s+|\s+$/g, "");
    }
  }

  function button(label, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  }

  function canvasKey(canvas) {
    var node = canvas, depth = 0, list, i, t;
    while (node && node !== document.body && depth < 6) {
      if (node.querySelectorAll) {
        list = node.querySelectorAll("h1,h2,h3,strong,b,[data-word]");
        for (i = 0; i < list.length; i += 1) {
          if (!visible(list[i])) continue;
          t = textOf(list[i]);
          if (!t || /정답|채점|펜|지우|undo|redo|test|day\s*\d+/i.test(t)) continue;
          if (t.length <= 100) return t;
        }
      }
      node = node.parentNode;
      depth += 1;
    }
    return "test";
  }

  function candidates() {
    var root = document.getElementById("root");
    if (!root || !root.querySelectorAll) return [];
    var nodes = root.querySelectorAll("canvas");
    var out = [], i, r;
    for (i = 0; i < nodes.length; i += 1) {
      if (!visible(nodes[i]) || isLearningCanvas(nodes[i])) continue;
      try { r = nodes[i].getBoundingClientRect(); }
      catch (ignore) { r = { width: 0, height: 0 }; }
      if (r.width < 120 || r.height < 70) continue;
      out.push(nodes[i]);
    }
    return out;
  }

  function canvasScore(canvas, count) {
    var r, score = 0, meta = "", node, depth = 0, t;
    try { r = canvas.getBoundingClientRect(); }
    catch (ignore) { r = { width: 0, height: 0 }; }

    score += Math.min(8, (r.width * r.height) / 30000);
    if (count === 1) score += 12;

    try {
      meta = (canvas.id || "") + " " + (canvas.className || "") + " " +
        (canvas.getAttribute("aria-label") || "") + " " +
        (canvas.getAttribute("data-testid") || "");
    } catch (ignore2) {}
    if (/(write|draw|ink|answer|test|quiz|hand|필기|답안|시험|쓰기)/i.test(meta)) score += 12;

    node = canvas.parentNode;
    while (node && node !== document.body && depth < 5) {
      t = textOf(node);
      if (/(채점|정답|시험|TEST|OCR|답안|필기|쓰기|알았다|애매했다|몰랐다)/i.test(t)) score += 9;
      if (/(1회|2회)/.test(t) && !/(채점|정답|시험|OCR|답안)/i.test(t)) score -= 7;
      node = node.parentNode;
      depth += 1;
    }
    return score;
  }

  function chooseTestCanvas() {
    var list = candidates();
    if (!list.length) return null;
    var best = null, bestScore = -9999, i, score;
    for (i = 0; i < list.length; i += 1) {
      score = canvasScore(list[i], list.length);
      if (score > bestScore) {
        bestScore = score;
        best = list[i];
      }
    }
    if (list.length > 1 && bestScore < 9) return null;
    return best;
  }

  function engineFromEvent(e) {
    var canvas = closestCanvas(e && e.target);
    return canvas && canvas.__wmUnifiedTestEngine ? canvas.__wmUnifiedTestEngine : null;
  }

  function blockOldEngine(e) {
    if (e.cancelable && e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
  }

  /* The test canvas is controlled from capture phase. We call the same
     InkEngine ourselves, then stop the event before React/root legacy input
     handlers can draw a second copy of the stroke. */
  if (window.PointerEvent && document.addEventListener) {
    document.addEventListener("pointerdown", function (e) {
      var engine = engineFromEvent(e);
      if (!engine) return;
      Pen.note(e);
      blockOldEngine(e);
      if ((e.pointerType === "mouse" || !e.pointerType) && Pen.relevantMouseSecondary(e)) return;
      engine.beginStroke(e);
    }, true);

    document.addEventListener("pointermove", function (e) {
      var engine = engineFromEvent(e);
      if (!engine) return;
      Pen.note(e);
      blockOldEngine(e);
      if ((e.pointerType === "mouse" || !e.pointerType) && Pen.relevantMouseSecondary(e)) return;
      engine.moveStroke(e);
    }, true);

    document.addEventListener("pointerup", function (e) {
      var engine = engineFromEvent(e);
      if (!engine) return;
      Pen.note(e);
      blockOldEngine(e);
      if ((e.pointerType === "mouse" || !e.pointerType) && (e.button === 2 || Pen.relevantMouseSecondary(e))) return;
      engine.endStroke(e);
    }, true);

    document.addEventListener("pointercancel", function (e) {
      var engine = engineFromEvent(e);
      if (!engine) return;
      blockOldEngine(e);
      engine.endStroke(e);
    }, true);
  }

  function makeTools(rec) {
    addStyles();
    var root = document.createElement("div");
    root.className = "wm-unified-test-tools";

    var head = document.createElement("div");
    head.className = "wm-unified-test-head";
    var title = document.createElement("span");
    title.className = "wm-unified-test-title";
    title.textContent = "공통 필기 엔진";
    var status = document.createElement("span");
    status.className = "wm-unified-test-status";
    status.textContent = "S Pen 버튼 = 임시 지우개";
    head.appendChild(title);
    head.appendChild(status);
    root.appendChild(head);

    var bar = document.createElement("div");
    bar.className = "wm-unified-test-bar";
    var pen = button("펜", function () { rec.engine.setTool("pen"); });
    var eraser = button("지우개", function () { rec.engine.setTool("eraser"); });
    var undo = button("되돌리기", function () { rec.engine.undo(); });
    var redo = button("다시", function () { rec.engine.redo(); });
    var clear = button("전체 지우기", function () { rec.engine.clear(); });
    bar.appendChild(pen);
    bar.appendChild(eraser);
    bar.appendChild(undo);
    bar.appendChild(redo);
    bar.appendChild(clear);
    root.appendChild(bar);

    rec.engine.onToolState = function (tool, temporary) {
      pen.setAttribute("aria-pressed", tool === "pen" ? "true" : "false");
      eraser.setAttribute("aria-pressed", tool === "eraser" ? "true" : "false");
      status.textContent = temporary && tool === "eraser" ? "S Pen 버튼 · 지우는 중" : "S Pen 버튼 = 임시 지우개";
    };

    rec.engine.onChange = function (engine) {
      undo.disabled = !engine.strokes.length;
      redo.disabled = !engine.redoStack.length;
      clear.disabled = !engine.strokes.length;
    };

    rec.engine.onToolState(rec.engine.manualTool || "pen", false);
    rec.engine.onChange(rec.engine);

    var parent = rec.canvas.parentNode;
    if (parent && parent.parentNode) {
      if (parent.nextSibling) parent.parentNode.insertBefore(root, parent.nextSibling);
      else parent.parentNode.appendChild(root);
    }
    return root;
  }

  function snapshot(engine) {
    if (!engine || !engine.strokes) return [];
    var out = [], i, j, s, pts;
    for (i = 0; i < engine.strokes.length; i += 1) {
      s = engine.strokes[i];
      pts = [];
      for (j = 0; j < s.points.length; j += 1) {
        pts.push({ x: s.points[j].x, y: s.points[j].y, p: s.points[j].p });
      }
      out.push({ tool: s.tool, points: pts });
    }
    return out;
  }

  function restore(engine, data) {
    if (!engine) return;
    engine.strokes = data || [];
    engine.redoStack = [];
    engine.current = null;
    if (engine.redraw) engine.redraw();
    if (engine.onChange) engine.onChange(engine);
  }

  function attach(canvas) {
    var key = canvasKey(canvas);
    var engine = window.WMHandwriting.create(canvas, {
      maxDpr: 1.75,
      baseWidth: 2.45,
      eraserWidth: 25
    });
    canvas.__wmUnifiedTestEngine = engine;
    canvas.setAttribute("data-wm-unified-test", "1");

    var rec = { canvas: canvas, engine: engine, key: key, tools: null };
    if (saved[key]) restore(engine, saved[key]);
    rec.tools = makeTools(rec);
    return rec;
  }

  function detach() {
    if (!record) return;
    saved[record.key] = snapshot(record.engine);
    try { if (record.engine && record.engine.destroy) record.engine.destroy(); } catch (ignore) {}
    try { delete record.canvas.__wmUnifiedTestEngine; } catch (ignore2) { record.canvas.__wmUnifiedTestEngine = null; }
    try { record.canvas.removeAttribute("data-wm-unified-test"); } catch (ignore3) {}
    try { if (record.tools && record.tools.parentNode) record.tools.parentNode.removeChild(record.tools); } catch (ignore4) {}
    record = null;
  }

  function sync() {
    scanTimer = null;
    var canvas = chooseTestCanvas();

    if (!canvas) {
      detach();
      setTestMode(false);
      return;
    }

    setTestMode(true);

    if (!record || record.canvas !== canvas || !contains(document.documentElement, record.canvas)) {
      detach();
      record = attach(canvas);
      return;
    }

    var key = canvasKey(canvas);
    if (key !== record.key) {
      saved[record.key] = snapshot(record.engine);
      record.key = key;
      restore(record.engine, saved[key] || []);
    }
  }

  function schedule() {
    if (scanTimer) return;
    scanTimer = window.setTimeout(sync, 90);
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

  window.WMUnifiedHandwriting = {
    version: "2.0.0",
    refresh: schedule,
    getTestEngine: function () { return record ? record.engine : null; },
    getTestCanvas: function () { return record ? record.canvas : null; },
    penState: Pen
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}());