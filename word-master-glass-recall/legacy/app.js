(function () {
  "use strict";

  var WORDS = window.WM_WORDS || [];
  var STORAGE_KEY = "wmgr:legacy:v1";
  var DAY_MS = 24 * 60 * 60 * 1000;
  var RANGES = { A: [1, 10], B: [11, 20], AB: [1, 20], C: [21, 30], BC: [11, 30], ABC: [1, 30], D: [31, 40], CD: [21, 40], ABCD: [1, 40] };
  var state = loadState();
  var route = "today";
  var selectedDay = 1;
  var learning = null;
  var searchQuery = "";
  var reviewOpen = false;
  var tool = "pen";
  var lineWidth = 2.5;
  var canvasApi = null;

  function loadState() {
    var empty = { onboarded: false, progress: {}, session: null };
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return empty;
      var parsed = JSON.parse(raw);
      parsed.progress = parsed.progress || {};
      return parsed;
    } catch (error) { return empty; }
  }

  function saveState() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) {}
  }

  function pad(value) { return value < 10 ? "0" + value : String(value); }
  function byId(id) {
    var i;
    for (i = 0; i < WORDS.length; i += 1) if (WORDS[i].id === id) return WORDS[i];
    return null;
  }
  function dayWords(day) {
    var out = [], i;
    for (i = 0; i < WORDS.length; i += 1) if (WORDS[i].day === day) out.push(WORDS[i]);
    return out;
  }
  function progress(id) {
    return state.progress[id] || { status: "UNSEEN", ok: 0, unsure: 0, wrong: 0, streak: 0, dueAt: null, starred: false };
  }
  function setProgress(id, value) { state.progress[id] = value; saveState(); }
  function shuffle(items) {
    var out = items.slice(), i, j, temp;
    for (i = out.length - 1; i > 0; i -= 1) { j = Math.floor(Math.random() * (i + 1)); temp = out[i]; out[i] = out[j]; out[j] = temp; }
    return out;
  }
  function h(tag, className, textValue) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof textValue !== "undefined") node.appendChild(document.createTextNode(textValue));
    return node;
  }
  function button(textValue, className, action) {
    var node = h("button", className || "", textValue);
    node.type = "button";
    node.onclick = action;
    return node;
  }
  function add(parent, child) { parent.appendChild(child); return child; }
  function clearRoot() { var root = document.getElementById("root"); while (root.firstChild) root.removeChild(root.firstChild); return root; }
  function go(next) { route = next; reviewOpen = false; render(); window.scrollTo(0, 0); }

  function header(title, backAction) {
    var node = h("header", "legacy-header");
    if (backAction) add(node, button("뒤로", "legacy-button secondary small back", backAction));
    add(node, h("span", "brand", "WORD MASTER"));
    add(node, h("h1", "", title));
    return node;
  }

  function nav() {
    var items = [["today", "오늘"], ["days", "학습"], ["test-hub", "시험"], ["weak", "Weak"], ["search", "검색"]];
    var node = h("nav", "legacy-nav"), i;
    for (i = 0; i < items.length; i += 1) (function (item) {
      var current = route === item[0] || (route === "day" && item[0] === "days");
      var b = button("", current ? "active" : "", function () { go(item[0]); });
      add(b, document.createTextNode(item[1])); add(node, b);
    }(items[i]));
    return node;
  }

  function stats() {
    var learned = 0, weak = 0, due = 0, now = Date.now(), key, p;
    for (key in state.progress) if (state.progress.hasOwnProperty(key)) {
      p = state.progress[key];
      if (p.status !== "UNSEEN") learned += 1;
      if (p.status === "WEAK" || p.status === "UNSURE" || p.starred) weak += 1;
      if (p.dueAt !== null && p.dueAt <= now) due += 1;
    }
    return { learned: learned, weak: weak, due: due };
  }

  function daySummary(day) {
    var list = dayWords(day), unseen = 0, mastered = 0, weak = 0, i, p;
    for (i = 0; i < list.length; i += 1) {
      p = progress(list[i].id);
      if (p.status === "UNSEEN") unseen += 1;
      else if (p.status === "MASTERED") mastered += 1;
      else if (p.status === "WEAK" || p.status === "UNSURE" || p.starred) weak += 1;
    }
    return { unseen: unseen, mastered: mastered, weak: weak };
  }

  function quickWords() {
    var now = Date.now(), due = [], weak = [], unsure = [], seen = {}, out = [], i, p;
    for (i = 0; i < WORDS.length; i += 1) {
      p = progress(WORDS[i].id);
      if (p.dueAt !== null && p.dueAt <= now) due.push(WORDS[i]);
      else if (p.status === "WEAK") weak.push(WORDS[i]);
      else if (p.status === "UNSURE") unsure.push(WORDS[i]);
    }
    due = due.concat(weak, unsure);
    for (i = 0; i < due.length && out.length < 20; i += 1) if (!seen[due[i].id]) { seen[due[i].id] = true; out.push(due[i]); }
    return out;
  }

  function startTest(day, stage, custom) {
    var source = custom || dayWords(day), range = RANGES[stage] || RANGES.ABCD, filtered = [], i;
    for (i = 0; i < source.length; i += 1) if (custom || (source[i].number >= range[0] && source[i].number <= range[1])) filtered.push(source[i]);
    if (!filtered.length) return;
    filtered = shuffle(filtered);
    state.session = { day: day || null, stage: stage, queue: [], index: 0, results: [], strokes: [] };
    for (i = 0; i < filtered.length; i += 1) state.session.queue.push(filtered[i].id);
    saveState(); go("test");
  }

  function renderToday(wrap) {
    var s = stats(), status, hero, resume, nextDay = 1, i, summary;
    add(wrap, header("오늘의 단어"));
    status = add(wrap, h("section", "legacy-status legacy-glass"));
    status.innerHTML = "<span><b>" + s.due + "</b>오늘 복습</span><span><b>" + s.weak + "</b>Weak</span><span><b>" + s.learned + " / " + WORDS.length + "</b>진행</span>";
    for (i = 1; i <= 25; i += 1) { summary = daySummary(i); if (summary.mastered < 40) { nextDay = i; break; } }
    hero = add(wrap, h("section", "legacy-hero legacy-glass"));
    add(hero, h("span", "legacy-subtle", "기억에서 꺼내는 오늘의 시험"));
    add(hero, h("h2", "", s.due ? "복습할 단어가 " + s.due + "개 있습니다." : "새 DAY를 시작할 준비가 됐습니다."));
    add(hero, h("p", "", "정답을 보기 전에 직접 쓰고, ○ △ ×로 스스로 판단합니다."));
    add(hero, button("QUICK RECALL", "legacy-button full", function () { var q = quickWords(); if (q.length) startTest(null, "QUICK", q); else { selectedDay = nextDay; go("day"); } }));
    if (state.session) {
      resume = add(wrap, h("section", "legacy-note legacy-glass"));
      add(resume, h("strong", "", "중단한 시험이 있습니다. "));
      add(resume, button("이어서 풀기", "legacy-button secondary small", function () { go("test"); }));
    }
    add(wrap, sectionTitle("NEXT DAY", "새 DAY 학습"));
    add(wrap, dayCard(nextDay));
  }

  function sectionTitle(kicker, title) { var node = h("div", "legacy-section-title"); add(node, h("small", "", kicker)); add(node, h("h2", "", title)); return node; }

  function dayCard(day) {
    var summary = daySummary(day), node = button("", "legacy-day-card", function () { selectedDay = day; go("day"); });
    add(node, h("small", "", "DAY")); add(node, h("strong", "", pad(day)));
    var track = add(node, h("div", "legacy-track")); var fill = add(track, h("i")); fill.style.width = (summary.mastered / 40 * 100) + "%";
    add(node, h("span", "", summary.mastered + " mastered · " + summary.weak + " weak · " + summary.unseen + " unseen"));
    return node;
  }

  function renderDays(wrap) {
    add(wrap, header("DAY Library")); add(wrap, h("p", "legacy-subtle", "DAY 01–25 · 각 40 words · A/B/C/D로 나눠 학습합니다."));
    var grid = add(wrap, h("div", "legacy-day-grid")), i;
    for (i = 1; i <= 25; i += 1) add(grid, dayCard(i));
  }

  function renderDay(wrap) {
    add(wrap, header("DAY " + pad(selectedDay), function () { go("days"); }));
    var rows = [{ b: "A", tests: ["A"] }, { b: "B", tests: ["B", "AB"] }, { b: "C", tests: ["C", "BC", "ABC"] }, { b: "D", tests: ["D", "CD", "ABCD"] }], i, j, card, actions;
    for (i = 0; i < rows.length; i += 1) (function (row) {
      card = add(wrap, h("section", "legacy-stage legacy-glass"));
      add(card, h("h2", "", row.b + " · " + (RANGES[row.b][0]) + "–" + (RANGES[row.b][1]))); add(card, h("p", "", "10 words를 보고 소리 내어 익힌 뒤 바로 인출합니다."));
      actions = add(card, h("div", "legacy-actions"));
      add(actions, button(row.b + " 학습", "legacy-button small", function () { startLearning(selectedDay, row.b); }));
      for (j = 0; j < row.tests.length; j += 1) (function (stage) { add(actions, button(stage + " TEST", "legacy-button secondary small", function () { startTest(selectedDay, stage); })); }(row.tests[j]));
    }(rows[i]));
  }

  function startLearning(day, block) {
    var range = RANGES[block], list = dayWords(day), ids = [], i;
    for (i = 0; i < list.length; i += 1) if (list[i].number >= range[0] && list[i].number <= range[1]) ids.push(list[i].id);
    learning = { day: day, block: block, ids: ids, index: 0, read1: false, read2: false }; go("learning");
  }

  function renderLearning(wrap) {
    if (!learning) { go("days"); return; }
    var word = byId(learning.ids[learning.index]), card, meaning, read, i, next;
    add(wrap, header("DAY " + pad(learning.day) + " · " + learning.block, function () { go("day"); }));
    card = add(wrap, h("section", "legacy-learning legacy-glass"));
    add(card, h("span", "num", word.number + " · " + (learning.index + 1) + " / " + learning.ids.length)); add(card, h("h2", "", word.word));
    meaning = add(card, h("div", "legacy-meaning")); for (i = 0; i < word.meaningLines.length; i += 1) add(meaning, h("p", "", word.meaningLines[i]));
    read = add(card, h("div", "legacy-read"));
    add(read, button("1회", learning.read1 ? "legacy-button secondary on" : "legacy-button secondary", function () { learning.read1 = !learning.read1; render(); }));
    add(read, button("2회", learning.read2 ? "legacy-button secondary on" : "legacy-button secondary", function () { learning.read2 = !learning.read2; render(); }));
    add(card, button(progress(word.id).starred ? "★ 어려움" : "☆ 어려움", "legacy-button secondary full", function () { var p = progress(word.id); p.starred = !p.starred; p.status = p.starred ? "STARRED" : "LEARNING"; setProgress(word.id, p); render(); }));
    next = add(wrap, h("div", "legacy-actions"));
    if (learning.index > 0) add(next, button("이전", "legacy-button secondary", function () { learning.index -= 1; learning.read1 = learning.read2 = false; render(); }));
    add(next, button(learning.index + 1 === learning.ids.length ? learning.block + " TEST" : "다음 단어", "legacy-button", function () { var p = progress(word.id); if (p.status === "UNSEEN") { p.status = p.starred ? "STARRED" : "LEARNING"; setProgress(word.id, p); } if (learning.index + 1 === learning.ids.length) startTest(learning.day, learning.block); else { learning.index += 1; learning.read1 = learning.read2 = false; render(); } }));
  }

  function renderTestHub(wrap) {
    add(wrap, header("시험")); var q = quickWords(), hero = add(wrap, h("section", "legacy-hero legacy-glass"));
    add(hero, h("span", "legacy-subtle", "QUICK RECALL")); add(hero, h("h2", "", q.length ? q.length + "개를 바로 인출합니다." : "복습 예정 단어가 없습니다."));
    add(hero, button(q.length ? "바로 시작" : "DAY 선택", "legacy-button full", function () { if (q.length) startTest(null, "QUICK", q); else go("days"); }));
    add(wrap, sectionTitle("FULL TEST", "DAY 전체 시험"));
    var grid = add(wrap, h("div", "legacy-day-grid")), i;
    for (i = 1; i <= 25; i += 1) (function (day) { add(grid, button("DAY " + pad(day) + "\n40 words", "legacy-day-card", function () { startTest(day, "ABCD"); })); }(i));
  }

  function rating(word, value) {
    var p = progress(word.id), now = Date.now(); p.lastTest = now;
    if (value === "O") { p.ok += 1; p.streak += 1; p.dueAt = now + [25 * 60 * 1000, DAY_MS, 3 * DAY_MS, 7 * DAY_MS][Math.min(p.streak - 1, 3)]; p.status = p.streak >= 3 ? "MASTERED" : (p.starred ? "STARRED" : "LEARNING"); }
    else if (value === "TRIANGLE") { p.unsure += 1; p.streak = 0; p.dueAt = now + 25 * 60 * 1000; p.status = "UNSURE"; }
    else { p.wrong += 1; p.streak = 0; p.dueAt = now; p.status = "WEAK"; }
    setProgress(word.id, p); state.session.results.push({ id: word.id, rating: value });
    if (state.session.index + 1 >= state.session.queue.length) { state.lastResult = state.session.results; state.session = null; saveState(); go("result"); }
    else { state.session.index += 1; state.session.strokes = []; reviewOpen = false; saveState(); window.setTimeout(render, 240); }
  }

  function renderTest(wrap) {
    if (!state.session) { add(wrap, header("시험")); add(wrap, h("p", "legacy-note legacy-glass", "진행 중인 시험이 없습니다.")); return; }
    var session = state.session, word = byId(session.queue[session.index]), head, wordBlock, paper, placeholder, tools, answer, ratings, i;
    head = add(wrap, h("header", "legacy-test-head")); add(head, button("나가기", "legacy-button secondary small close", function () { go("today"); })); add(head, h("small", "", session.day ? "DAY " + pad(session.day) + " · " + session.stage : "QUICK RECALL")); add(head, h("strong", "", (session.index + 1) + " / " + session.queue.length));
    wordBlock = add(wrap, h("div", "legacy-test-word")); add(wordBlock, h("small", "", "뜻을 기억에서 꺼내 쓰세요")); add(wordBlock, h("h1", "", word.word)); add(wordBlock, h("span", "legacy-subtle", "DAY " + pad(word.day) + " · #" + word.number));
    paper = add(wrap, h("div", "legacy-paper")); placeholder = add(paper, h("div", "legacy-placeholder", "여기에 뜻을 쓰세요")); var canvas = add(paper, h("canvas"));
    canvasApi = bindCanvas(canvas, placeholder, session.strokes || []);
    if (!reviewOpen) {
      tools = add(wrap, h("div", "legacy-tools legacy-glass"));
      add(tools, button("Pen", tool === "pen" ? "active" : "", function () { tool = "pen"; render(); }));
      add(tools, button("얇게", lineWidth === 1.8 ? "active" : "", function () { lineWidth = 1.8; tool = "pen"; render(); }));
      add(tools, button("보통", lineWidth === 2.5 ? "active" : "", function () { lineWidth = 2.5; tool = "pen"; render(); }));
      add(tools, button("굵게", lineWidth === 3.3 ? "active" : "", function () { lineWidth = 3.3; tool = "pen"; render(); }));
      add(tools, button("지우개", tool === "eraser" ? "active" : "", function () { tool = "eraser"; render(); }));
      add(tools, button("취소", "", function () { canvasApi.undo(); })); add(tools, button("지우기", "", function () { canvasApi.clear(); }));
      add(wrap, button(canvasApi.hasInk() ? "채점하기" : "정답 보기", "legacy-button full", function () { reviewOpen = true; session.strokes = canvasApi.getStrokes(); saveState(); render(); }));
    } else {
      answer = add(wrap, h("section", "legacy-answer legacy-glass")); add(answer, h("small", "", "정답 · OCR 없이 직접 채점"));
      for (i = 0; i < word.meaningLines.length; i += 1) add(answer, h("strong", "", word.meaningLines[i]));
      ratings = add(wrap, h("div", "legacy-rating"));
      add(ratings, ratingButton("ok", "○", "알았다", function () { rating(word, "O"); })); add(ratings, ratingButton("unsure", "△", "애매했다", function () { rating(word, "TRIANGLE"); })); add(ratings, ratingButton("wrong", "×", "몰랐다", function () { rating(word, "X"); }));
    }
  }

  function ratingButton(className, symbol, label, action) { var b = button("", className, action); add(b, h("b", "", symbol)); add(b, document.createTextNode(label)); return b; }

  function bindCanvas(canvas, placeholder, initial) {
    var strokes = initial && initial.slice ? initial.slice() : [], redo = [], active = null, rect, dpr;
    function resize() { rect = canvas.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2); canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr)); draw(); }
    function draw() { var ctx = canvas.getContext("2d"), i, j, stroke, a, b; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height); ctx.strokeStyle = "#102b4f"; ctx.lineCap = "round"; ctx.lineJoin = "round"; for (i = 0; i < strokes.length; i += 1) { stroke = strokes[i]; ctx.lineWidth = stroke.width; if (stroke.points.length === 1) { ctx.beginPath(); ctx.arc(stroke.points[0].x * rect.width, stroke.points[0].y * rect.height, stroke.width / 2, 0, Math.PI * 2); ctx.fillStyle = "#102b4f"; ctx.fill(); } else for (j = 1; j < stroke.points.length; j += 1) { a = stroke.points[j - 1]; b = stroke.points[j]; ctx.beginPath(); ctx.moveTo(a.x * rect.width, a.y * rect.height); ctx.lineTo(b.x * rect.width, b.y * rect.height); ctx.stroke(); } } placeholder.style.display = strokes.length ? "none" : "block"; }
    function point(clientX, clientY) { return { x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) }; }
    function erase(p) { var kept = [], i, j, dx, dy, remove; for (i = 0; i < strokes.length; i += 1) { remove = false; for (j = 0; j < strokes[i].points.length; j += 1) { dx = (strokes[i].points[j].x - p.x) * rect.width; dy = (strokes[i].points[j].y - p.y) * rect.height; if (Math.sqrt(dx * dx + dy * dy) < 18) { remove = true; break; } } if (!remove) kept.push(strokes[i]); } strokes = kept; draw(); }
    function begin(clientX, clientY) { var p = point(clientX, clientY); if (tool === "eraser") { erase(p); active = { eraser: true }; } else { active = { width: lineWidth, points: [p] }; strokes.push(active); redo = []; draw(); } }
    function move(clientX, clientY) { if (!active) return; var p = point(clientX, clientY); if (active.eraser) erase(p); else { active.points.push(p); draw(); } }
    function end() { active = null; state.session.strokes = strokes; saveState(); }
    canvas.ontouchstart = function (event) { var t = event.changedTouches[0]; if (t) { event.preventDefault(); begin(t.clientX, t.clientY); } };
    canvas.ontouchmove = function (event) { var t = event.changedTouches[0]; if (t) { event.preventDefault(); move(t.clientX, t.clientY); } };
    canvas.ontouchend = function (event) { event.preventDefault(); end(); };
    canvas.onmousedown = function (event) { event.preventDefault(); begin(event.clientX, event.clientY); };
    window.onmousemove = function (event) { if (active) { event.preventDefault(); move(event.clientX, event.clientY); } };
    window.onmouseup = function () { if (active) end(); };
    resize(); window.setTimeout(resize, 0);
    return { undo: function () { var s = strokes.pop(); if (s) redo.push(s); draw(); state.session.strokes = strokes; saveState(); }, clear: function () { redo = strokes.slice(); strokes = []; draw(); state.session.strokes = []; saveState(); }, getStrokes: function () { return strokes; }, hasInk: function () { return strokes.length > 0; } };
  }

  function weakList() { var out = [], i, p; for (i = 0; i < WORDS.length; i += 1) { p = progress(WORDS[i].id); if (p.status === "WEAK" || p.status === "UNSURE" || p.starred) out.push(WORDS[i]); } return out; }

  function renderWeak(wrap) {
    add(wrap, header("Weak Words")); var list = weakList(), note = add(wrap, h("p", "legacy-note legacy-glass", list.length + " words · △ × 어려움 표시가 자동으로 모입니다.")), i, item, p;
    if (list.length) add(note, button("20개 시험", "legacy-button small", function () { startTest(null, "WEAK", list.slice(0, 20)); }));
    for (i = 0; i < list.length; i += 1) (function (word) { p = progress(word.id); item = button("", "legacy-list-item", function () { startTest(null, "WEAK", [word]); }); add(item, h("em", "", p.status === "WEAK" ? "×" : p.status === "UNSURE" ? "△" : "☆")); add(item, h("strong", "", word.word)); add(item, h("span", "", "DAY " + pad(word.day) + " · #" + word.number + " · " + word.meaningLines.join(" / "))); add(wrap, item); }(list[i]));
  }

  function renderSearch(wrap) {
    add(wrap, header("검색")); var input = add(wrap, h("input", "legacy-search")); input.type = "search"; input.placeholder = "영어 단어 일부를 입력하세요"; input.value = searchQuery; input.oninput = function () { searchQuery = input.value.toLowerCase(); renderSearchResults(results); };
    var results = add(wrap, h("div")); renderSearchResults(results);
  }
  function renderSearchResults(results) {
    while (results.firstChild) results.removeChild(results.firstChild); if (!searchQuery) { add(results, h("p", "legacy-note legacy-glass", "단어 일부를 입력하면 DAY와 상태를 찾습니다.")); return; }
    var count = 0, i, word, item; for (i = 0; i < WORDS.length && count < 80; i += 1) if (WORDS[i].word.toLowerCase().indexOf(searchQuery) !== -1) { word = WORDS[i]; item = button("", "legacy-list-item", (function (selected) { return function () { startTest(null, "SEARCH", [selected]); }; }(word))); add(item, h("strong", "", word.word)); add(item, h("span", "", "DAY " + pad(word.day) + " · #" + word.number + " · " + word.meaningLines.join(" / "))); add(results, item); count += 1; }
  }

  function renderProgress(wrap) {
    add(wrap, header("전체 진행", function () { go("today"); })); var s = stats(), mastered = 0, key, cards = [["총 단어", WORDS.length], ["학습", s.learned], ["Mastered", 0], ["Weak", s.weak], ["오늘 복습", s.due]], i, card;
    for (key in state.progress) if (state.progress.hasOwnProperty(key) && state.progress[key].status === "MASTERED") mastered += 1; cards[2][1] = mastered;
    for (i = 0; i < cards.length; i += 1) { card = add(wrap, h("section", "legacy-metric legacy-glass")); add(card, h("span", "", cards[i][0])); add(card, h("strong", "", String(cards[i][1]))); }
    add(wrap, button("JSON 백업 내보내기", "legacy-button full", exportBackup));
  }

  function exportBackup() { var blob = new Blob([JSON.stringify({ product: "WORD MASTER Glass Recall", schemaVersion: 1, legacy: true, data: state }, null, 2)], { type: "application/json" }), url = window.URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = "word-master-glass-recall-legacy-backup.json"; a.click(); window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 400); }

  function renderResult(wrap) {
    var result = state.lastResult || [], counts = { O: 0, TRIANGLE: 0, X: 0 }, i, card;
    for (i = 0; i < result.length; i += 1) counts[result[i].rating] += 1;
    add(wrap, header("시험 완료")); card = add(wrap, h("section", "legacy-hero legacy-glass")); add(card, h("h2", "", result.length + " words")); add(card, h("p", "", "○ " + counts.O + " · △ " + counts.TRIANGLE + " · × " + counts.X)); add(card, h("h2", "", "정확 인출률 " + (result.length ? Math.round(counts.O / result.length * 1000) / 10 : 0) + "%"));
    var weak = [], word; for (i = 0; i < result.length; i += 1) if (result[i].rating !== "O") { word = byId(result[i].id); if (word) weak.push(word); }
    if (weak.length) add(card, button("Weak " + weak.length + "개 다시", "legacy-button full", function () { startTest(null, "WEAK", weak); }));
    add(wrap, button("완료", "legacy-button secondary full", function () { go("today"); }));
  }

  function onboarding(root) {
    if (state.onboarded) return; var layer = add(root, h("div", "legacy-onboarding")), panel = add(layer, h("div", "panel legacy-glass"));
    add(panel, h("span", "legacy-subtle", "WORD MASTER")); add(panel, h("h1", "", "Glass Recall")); add(panel, h("p", "", "기억에서 꺼내 직접 쓰는 디지털 주관식 단어장"));
    add(panel, h("div", "step", "1  영단어를 봅니다.")); add(panel, h("div", "step", "2  뜻을 직접 씁니다.")); add(panel, h("div", "step", "3  채점하고 틀린 것만 다시 봅니다."));
    add(panel, button("시작하기", "legacy-button full", function () { state.onboarded = true; saveState(); render(); }));
  }

  function render() {
    var root = clearRoot(), app = add(root, h("div", "legacy-app")), wrap = add(app, h("main", "legacy-wrap"));
    if (!WORDS.length) { add(wrap, header("데이터 준비 필요")); add(wrap, h("p", "legacy-note legacy-glass", "README의 PDF 데이터 생성 단계를 먼저 실행하세요.")); return; }
    if (route === "today") renderToday(wrap); else if (route === "days") renderDays(wrap); else if (route === "day") renderDay(wrap); else if (route === "learning") renderLearning(wrap); else if (route === "test-hub") renderTestHub(wrap); else if (route === "test") renderTest(wrap); else if (route === "weak") renderWeak(wrap); else if (route === "search") renderSearch(wrap); else if (route === "progress") renderProgress(wrap); else if (route === "result") renderResult(wrap); else renderToday(wrap);
    if (route !== "test" && route !== "learning" && route !== "result" && route !== "day") add(app, nav());
    onboarding(root);
  }

  var css = document.createElement("link"); css.rel = "stylesheet"; css.href = "./legacy/legacy.css"; document.head.appendChild(css);
  render();
}());
