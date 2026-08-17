/* WORD MASTER Glass Recall - unified handwriting bridge
 * 2026-08-17
 * Uses the exact same WMHandwriting InkEngine for learning and test canvases.
 * Also improves S Pen barrel-button detection with hover pre-arm + stroke latch.
 */
(function () {
  "use strict";

  if (!window.WMHandwriting || typeof window.WMHandwriting.create !== "function") return;

  var STYLE_ID = "wm-unified-test-ink-style";
  var records = [];
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

  /* Pointer Events: barrel = button/buttons 2, pen eraser = 5/32.
     Some Android pen stacks expose barrel state reliably only before contact,
     so we remember hover state and latch it for that stroke. */
  var Pen = {
    barrelUntil: 0,
    eraserUntil: 0,

    note: function (e) {
      if (!e || e.pointerType !== "pen") return;
      var t = now();
      var buttons = typeof e.buttons === "number" ? e.buttons : 0;

      if (e.button === 2) {
        if (buttons & 2) this.barrelUntil = t + 900;
        else this.barrelUntil = 0;
      } else if (buttons & 2) {
        this.barrelUntil = t + 900;
      }

      if (e.button === 5) {
        if (buttons & 32) this.eraserUntil = t + 900;
        else this.eraserUntil = 0;
      } else if (buttons & 32) {
        this.eraserUntil = t + 900;
      }
    },

    direct: function (e) {
      if (!e || e.pointerType !== "pen") return false;
      var b = typeof e.buttons === "number" ? e.buttons : 0;
      return e.button === 2 || e.button === 5 || !!(b & 2) || !!(b & 32);
    },

    released: function (e) {
      if (!e || e.pointerType !== "pen") return false;
      var b = typeof e.buttons === "number" ? e.buttons : 0;
      return (e.button === 2 && !(b & 2)) || (e.button === 5 && !(b & 32));
    },

    armed: function () {
      var t = now();
      return t < this.barrelUntil || t < this.eraserUntil;
    }
  };

  function track(e) { Pen.note(e); }

  if (window.PointerEvent && document.addEventListener) {
    document.addEventListener("pointerover", track, true);
    document.addEventListener("pointermove", track, true);
    document.addEventListener("pointerdown", track, true);
    document.addEventListener("pointerup", track, true);
    if ("onpointerrawupdate" in window) document.addEventListener("pointerrawupdate", track, true);
  }

  /* Patch the original InkEngine prototype once. Learning pads created by
     handwriting-study.js and test engines created below now share this logic. */
  var probeCanvas = document.createElement("canvas");
  probeCanvas.width = 8;
  probeCanvas.height = 8;
  var probe = window.WMHandwriting.create(probeCanvas, { maxDpr: 1 });
  var proto = Object.getPrototypeOf ? Object.getPrototypeOf(probe) : probe.__proto__;

  if (proto && !proto.__wmUnifiedPenPatched) {
    proto.__wmUnifiedPenPatched = true;

    var nativeEffective = proto.effectiveTool;
    var nativeBegin = proto.beginStroke;
    var nativeEnd = proto.endStroke;

    proto.effectiveTool = function (e) {
      if (e && e.pointerType === "pen") {
        Pen.note(e);
        if (Pen.released(e)) this.__wmBarrelStroke = false;
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

  function visibleCanvases() {
    var root = document.getElementById("root");
    if (!root || !root.querySelectorAll) return [];
    var nodes = root.querySelectorAll("canvas");
    var out = [], i, r, learningPanel;
    learningPanel = document.getElementById("wm-write-study-panel-v2") ||
                    document.getElementById("wm-write-study-panel-v3");

    for (i = 0; i < nodes.length; i += 1) {
      if (!visible(nodes[i])) continue;
      if (learningPanel && contains(learningPanel, nodes[i])) continue;
      try { r = nodes[i].getBoundingClientRect(); }
      catch (ignore) { r = { width: 0, height: 0 }; }
      if (r.width < 120 || r.height < 70) continue;
      out.push(nodes[i]);
    }
    return out;
  }

  function likelyTest(canvas, count) {
    if (count === 1) return true;
    var meta = "";
    try {
      meta = (canvas.id || "") + " " + (canvas.className || "") + " " +
             (canvas.getAttribute("aria-label") || "");
    } catch (ignore) {}
    if (/(write|draw|ink|answer|test|quiz|hand|필기|답안|시험|쓰기)/i.test(meta)) return true;

    var node = canvas.parentNode, depth = 0, t;
    while (node && node !== document.body && depth < 5) {
      t = textOf(node);
      if (/(채점|정답|시험|TEST|OCR|펜|지우개|답안|필기|쓰기)/i.test(t)) return true;
      node = node.parentNode;
      depth += 1;
    }
    return false;
  }

  function findRecord(canvas) {
    var i;
    for (i = 0; i < records.length; i += 1) if (records[i].canvas === canvas) return records[i];
    return null;
  }

  function engineFromEvent(e) {
    var node = e && e.target;
    while (node && node !== document) {
      if (node.__wmUnifiedTestEngine) return node.__wmUnifiedTestEngine;
      node = node.parentNode;
    }
    return null;
  }

  function blockOldEngine(e) {
    if (e.cancelable && e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
  }

  /* Test canvas takeover at document-capture phase, before React/root handlers.
     We do not replace the canvas node, so OCR can still read the same canvas. */
  if (window.PointerEvent && document.addEventListener) {
    document.addEventListener("pointerdown", function (e) {
      var engine = engineFromEvent(e);
      if (!engine) return;
      Pen.note(e);
      blockOldEngine(e);
      engine.beginStroke(e);
    }, true);

    document.addEventListener("pointermove", function (e) {
      var engine = engineFromEvent(e);
      if (!engine) return;
      Pen.note(e);
      blockOldEngine(e);
      engine.moveStroke(e);
    }, true);

    document.addEventListener("pointerup", function (e) {
      var engine = engineFromEvent(e);
      if (!engine) return;
      Pen.note(e);
      blockOldEngine(e);
      engine.endStroke(e);
    }, true);

    document.addEventListener("pointercancel", function (e) {
      var engine = engineFromEvent(e);
      if (!engine) return;
      blockOldEngine(e);
      engine.endStroke(e);
    }, true);

    document.addEventListener("contextmenu", function (e) {
      if (!engineFromEvent(e)) return;
      blockOldEngine(e);
    }, true);
  }

  function makeTools(record) {
    addStyles();
    var root = document.createElement("div");
    root.className = "wm-unified-test-tools";

    var head = document.createElement("div");
    head.className = "wm-unified-test-head";
    var title = document.createElement("span");
    title.className = "wm-unified-test-title";
    title.textContent = "학습과 같은 필기 엔진";
    var status = document.createElement("span");
    status.className = "wm-unified-test-status";
    status.textContent = "S Pen 버튼은 누른 채 펜을 대기";
    head.appendChild(title);
    head.appendChild(status);
    root.appendChild(head);

    var bar = document.createElement("div");
    bar.className = "wm-unified-test-bar";
    var pen = button("펜", function () { record.engine.setTool("pen"); });
    var eraser = button("지우개", function () { record.engine.setTool("eraser"); });
    var undo = button("되돌리기", function () { record.engine.undo(); });
    var redo = button("다시", function () { record.engine.redo(); });
    var clear = button("전체 지우기", function () { record.engine.clear(); });
    bar.appendChild(pen);
    bar.appendChild(eraser);
    bar.appendChild(undo);
    bar.appendChild(redo);
    bar.appendChild(clear);
    root.appendChild(bar);

    record.engine.onToolState = function (tool, temporary) {
      var p = tool === "pen" ? "true" : "false";
      var er = tool === "eraser" ? "true" : "false";
      if (pen.getAttribute("aria-pressed") !== p) pen.setAttribute("aria-pressed", p);
      if (eraser.getAttribute("aria-pressed") !== er) eraser.setAttribute("aria-pressed", er);
      var msg = temporary && tool === "eraser"
        ? "S Pen 버튼 · 지우는 중"
        : "S Pen 버튼은 누른 채 펜을 대기";
      if (status.textContent !== msg) status.textContent = msg;
    };

    record.engine.onChange = function (engine) {
      undo.disabled = !engine.strokes.length;
      redo.disabled = !engine.redoStack.length;
      clear.disabled = !engine.strokes.length;
    };

    record.engine.onToolState(record.engine.manualTool || "pen", false);
    record.engine.onChange(record.engine);

    var parent = record.canvas.parentNode;
    if (parent && parent.parentNode) {
      if (parent.nextSibling) parent.parentNode.insertBefore(root, parent.nextSibling);
      else parent.parentNode.appendChild(root);
    }
    return root;
  }

  function attach(canvas) {
    var key = canvasKey(canvas);
    var engine = window.WMHandwriting.create(canvas, {
      maxDpr: 1.75,
      baseWidth: 2.45,
      eraserWidth: 25
    });
    canvas.__wmUnifiedTestEngine = engine;

    if (saved[key] && engine.restore) engine.restore(saved[key]);

    var record = {
      canvas: canvas,
      engine: engine,
      key: key,
      tools: null
    };
    records.push(record);
    record.tools = makeTools(record);
    return record;
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

  function cleanup() {
    var keep = [], i, r;
    for (i = 0; i < records.length; i += 1) {
      r = records[i];
      if (document.documentElement && contains(document.documentElement, r.canvas)) {
        keep.push(r);
        continue;
      }
      saved[r.key] = snapshot(r.engine);
      try { if (r.engine.destroy) r.engine.destroy(); } catch (ignore) {}
      try { if (r.tools && r.tools.parentNode) r.tools.parentNode.removeChild(r.tools); } catch (ignore2) {}
    }
    records = keep;
  }

  function sync() {
    scanTimer = null;
    cleanup();

    var canvases = visibleCanvases(), i, canvas, record, key;
    for (i = 0; i < canvases.length; i += 1) {
      canvas = canvases[i];
      if (!likelyTest(canvas, canvases.length)) continue;

      record = findRecord(canvas);
      if (!record) {
        attach(canvas);
        continue;
      }

      key = canvasKey(canvas);
      if (key !== record.key) {
        saved[record.key] = snapshot(record.engine);
        record.key = key;
        restore(record.engine, saved[key] || []);
      }
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

  window.WMUnifiedHandwriting = {
    version: "1.0.0",
    refresh: schedule,
    getTestEngine: function () { return records.length ? records[0].engine : null; },
    getTestCanvas: function () { return records.length ? records[0].canvas : null; },
    penState: Pen
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}());
