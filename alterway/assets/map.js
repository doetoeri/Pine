// Canvas rendering and geographic projection adapted from the source ALTERWAY map.
function createAlterwayMap({ data, engine, config, presenting, onStation, onEmpty }) {
  const canvas = document.getElementById('mapCanvas');
  const motion = document.getElementById('motionCanvas');
  const ctx = canvas.getContext('2d');
  const fx = motion.getContext('2d');
  const stations = engine.stations(data, config);
  const lineColors = { L1:'#0052A4', L2:'#00A84D', L3:'#EF7C1C', L4:'#00A5DE', L5:'#996CAC', L6:'#CD7C2F', L7:'#747F00', L8:'#E6186C', L9:'#B7A982', INC1:'#7CA8D5', INC2:'#ED8B00', SUIN:'#E8A613', GYEONGUI:'#79B59A', GYEONGCHUN:'#16A888', SEOHAE:'#87AC37', SHINBUNDANG:'#D4003B', AIRPORT:'#0090D2', GIMPO:'#A17E4D', GTXA:'#713D91', GYEONGGANG:'#1C9B8A', EVERLINE:'#66A536', UIJEONGBU:'#D8A142', UI:'#A7BE24', SILLIM:'#6789CA' };
  const lineNames = { L1:'1호선', L2:'2호선', L3:'3호선', L4:'4호선', L5:'5호선', L6:'6호선', L7:'7호선', L8:'8호선', L9:'9호선', INC1:'인천1호선', INC2:'인천2호선', SUIN:'수인분당선', GYEONGUI:'경의중앙선', GYEONGCHUN:'경춘선', SEOHAE:'서해선', SHINBUNDANG:'신분당선', AIRPORT:'공항철도', GIMPO:'김포골드라인', GTXA:'GTX-A', GYEONGGANG:'경강선', EVERLINE:'에버라인', UIJEONGBU:'의정부경전철', UI:'우이신설선', SILLIM:'신림선', 'B:optimal-math':'영분선' };
  const major = new Set(['서울역', '김포공항', '홍대입구', '인천', '부평', '왕십리', '청량리', '강남', '잠실', '신도림', '대곡', '수원', '판교', '사당']);
  const focusRoute = config.routes.find((route) => route.id === 'B:optimal-math');
  const routeNames = new Set(['영등포', '여의도', '공덕', '선릉', '수서', '모란', '야탑']);
  const core = Object.keys(stations).filter((id) => {
    const { lat, lon } = stations[id];
    return lat >= 37.25 && lat <= 37.79 && lon >= 126.5 && lon <= 127.35;
  });
  const eligible = Object.entries(stations).filter(([id, s]) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && !id.startsWith('PLAN:'));
  const edgeKey = (a, b) => a < b ? `${a}~${b}` : `${b}~${a}`;
  const baseGraph = engine.buildGraph(data, config, '0');
  const timed = new Set(baseGraph.edges.filter((edge) => edge.kind === 'rail').map((edge) => edgeKey(edge.a, edge.b)));
  const links = data.links.map((edge) => ({ ...edge, timed: timed.has(edgeKey(edge.a, edge.b)) }));
  const pointers = new Map();
  let gesture = null;
  let width = 1, height = 1, dpr = 1, scale = 1, tx = 0, ty = 0;
  let fitted = core;
  let mode = presenting ? '0' : 'B';
  let dim = false, focused = false, selected = null, journey = [], pins = [];
  let audience = [], candidates = [], trains = [];

  const xy = (station) => station && Number.isFinite(station.lat) && Number.isFinite(station.lon)
    ? [(station.lon - 126.3) * 850, (38.25 - station.lat) * 1050]
    : null;
  const screen = (id) => {
    const point = xy(stations[id]);
    return point ? [point[0] * scale + tx, point[1] * scale + ty] : null;
  };
  const within = (p, margin = 0) => p && p[0] >= margin && p[0] <= width - margin && p[1] >= margin && p[1] <= height - margin;

  function resize() {
    const bounds = canvas.parentElement.getBoundingClientRect();
    const oldWidth = width, oldHeight = height;
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const layer of [canvas, motion]) {
      layer.width = Math.round(width * dpr);
      layer.height = Math.round(height * dpr);
    }
    if (fitted) fit(fitted);
    else {
      tx += (width - oldWidth) / 2;
      ty += (height - oldHeight) / 2;
      draw();
    }
  }

  function fit(ids = core) {
    fitted = ids.length ? ids : core;
    const points = fitted.map((id) => xy(stations[id])).filter(Boolean);
    if (!points.length) return;
    const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const horizontal = Math.min(width * .15, presenting ? 100 : 78);
    const vertical = Math.min(height * .14, 68);
    scale = Math.max(.08, Math.min(9, (width - 2 * horizontal) / Math.max(35, x1 - x0), (height - 2 * vertical - 20) / Math.max(35, y1 - y0)));
    tx = width / 2 - (x0 + x1) * scale / 2;
    ty = (height - 20) / 2 - (y0 + y1) * scale / 2;
    draw();
  }

  function zoom(factor, px = width / 2, py = height / 2) {
    const nextScale = Math.max(.08, Math.min(12, scale * factor));
    tx = px - (px - tx) * nextScale / scale;
    ty = py - (py - ty) * nextScale / scale;
    scale = nextScale;
    fitted = null;
    draw();
  }

  function line(layer, points, color, size, alpha = 1, dash = []) {
    if (points.length < 2 || points.some((point) => !point)) return;
    layer.beginPath();
    points.forEach((p, i) => i ? layer.lineTo(...p) : layer.moveTo(...p));
    layer.strokeStyle = color;
    layer.lineWidth = size;
    layer.globalAlpha = alpha;
    layer.lineCap = 'round';
    layer.lineJoin = 'round';
    layer.setLineDash(dash);
    layer.stroke();
    layer.globalAlpha = 1;
    layer.setLineDash([]);
  }

  function circle(layer, point, radius, fill, outline = fill, stroke = 1) {
    layer.beginPath();
    layer.arc(...point, radius, 0, Math.PI * 2);
    layer.fillStyle = fill;
    layer.fill();
    layer.lineWidth = stroke;
    layer.strokeStyle = outline;
    layer.stroke();
  }

  function drawLabels() {
    const size = presenting ? Math.max(15, Math.min(27, width / 49)) : scale >= 1.6 ? 13 : 11;
    const labels = eligible.map(([id, station]) => ({ id, station, priority: pins.includes(id) || id === selected ? 4
      : (mode === 'B' || focused) && routeNames.has(station.name) && focusRoute.stops.includes(id) ? 3
      : !focused && major.has(station.name) ? 2 : !presenting && scale >= 1.8 ? 1 : 0 }));
    const drawn = new Set(), boxes = [];
    ctx.font = `750 ${size}px 'Noto Sans CJK KR', system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const { id, station, priority } of labels.filter((item) => item.priority).sort((a, b) => b.priority - a.priority)) {
      const p = screen(id);
      if (!within(p, 8) || drawn.has(station.name)) continue;
      const textWidth = ctx.measureText(station.name).width;
      const offset = 10 + size / 4;
      const choices = [[offset, -offset / 2], [offset, size + 7], [-textWidth - offset, -offset / 2], [-textWidth - offset, size + 7]];
      for (const [dx, dy] of choices) {
        const x = p[0] + dx, y = p[1] + dy, top = y - size, right = x + textWidth + 5;
        if (x < 5 || right > width - 5 || top < 6 || y > height - 53) continue;
        if (boxes.some((b) => x < b.right && right > b.x && top < b.bottom && y + 3 > b.top)) continue;
        boxes.push({ x, right, top, bottom: y + 3 });
        drawn.add(station.name);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = presenting ? 5 : 3;
        ctx.lineJoin = 'round';
        ctx.strokeText(station.name, x, y);
        ctx.fillStyle = priority >= 3 ? '#16334e' : '#4b667d';
        ctx.fillText(station.name, x, y);
        break;
      }
    }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#eef4fa';
    ctx.fillRect(0, 0, width, height);
    ctx.beginPath();
    ctx.strokeStyle = '#d9e5f0';
    ctx.lineWidth = .6;
    for (let x = tx % 48; x < width; x += 48) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    for (let y = ty % 48; y < height; y += 48) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();
    for (const edge of links) {
      const a = screen(edge.a), b = screen(edge.b);
      if (!a || !b) continue;
      line(ctx, [a, b], '#fff', 5, dim ? .6 : .95);
      line(ctx, [a, b], dim ? '#859db3' : lineColors[edge.line] || '#8296ab', edge.timed ? 2.3 : 1.5, dim ? .42 : edge.timed ? .85 : .5, edge.timed ? [] : [3, 4]);
    }
    for (const [id] of eligible) {
      const point = screen(id);
      if (within(point)) circle(ctx, point, scale >= 1.3 ? 2 : 1.5, '#fff', '#9eb3c5', .7);
    }
    if (mode === 'B') {
      const points = focusRoute.stops.map(screen).filter(Boolean);
      line(ctx, points, '#fff', presenting ? 16 : 12);
      line(ctx, points, '#d90070', presenting ? 9 : 6.5);
      for (const point of points) circle(ctx, point, presenting ? 4.5 : 3.6, '#fff', '#d90070', 2.2);
    }
    for (const edge of journey) {
      if (edge.a === edge.b || !['rail', 'transfer'].includes(edge.kind)) continue;
      const points = [screen(edge.a), screen(edge.b)];
      const rail = edge.kind === 'rail';
      line(ctx, points, '#fff', rail ? 10 : 6);
      line(ctx, points, edge.line === focusRoute.id && rail ? '#ad0058' : '#124572', rail ? 5.5 : 3.2, 1, rail ? [] : [4, 4]);
    }
    for (const id of new Set([...pins, selected].filter(Boolean))) {
      const point = screen(id);
      if (point) circle(ctx, point, presenting ? 7.5 : 6, '#154b80', '#fff', 2.6);
    }
    drawLabels();
    drawEffects();
  }

  function candidatePath(candidate) {
    const points = candidate.stops.map(screen).filter(Boolean);
    const shifted = points.map((point, i) => {
      const previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
      const dx = next[0] - previous[0], dy = next[1] - previous[1];
      const length = Math.hypot(dx, dy) || 1;
      return [point[0] - dy / length * candidate.offset, point[1] + dx / length * candidate.offset];
    });
    if (candidate.progress >= 1) return shifted;
    const lengths = shifted.slice(1).map((p, i) => Math.hypot(p[0] - shifted[i][0], p[1] - shifted[i][1]));
    let remaining = lengths.reduce((sum, length) => sum + length, 0) * candidate.progress;
    const partial = shifted.slice(0, 1);
    for (const [i, length] of lengths.entries()) {
      if (remaining >= length) {
        partial.push(shifted[i + 1]);
        remaining -= length;
      } else {
        const t = length ? remaining / length : 0;
        const [a, b] = shifted.slice(i, i + 2);
        partial.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
        break;
      }
    }
    return partial;
  }

  function drawEffects() {
    fx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fx.clearRect(0, 0, width, height);
    for (const candidate of candidates) {
      if (candidate.alpha < .015 || candidate.progress <= 0) continue;
      const points = candidatePath(candidate);
      line(fx, points, '#fff', candidate.winner ? 16 : 7, candidate.alpha * .92);
      line(fx, points, candidate.color, candidate.winner ? 9 : 4.5, candidate.alpha, candidate.filtered ? [8, 7] : []);
      if (candidate.winner && candidate.progress === 1) {
        for (const point of points) circle(fx, point, 4.4, '#fff', candidate.color, 2.4);
      }
    }
    for (const train of trains) {
      const a = screen(train.a), b = screen(train.b);
      if (!a || !b) continue;
      const p = a.map((value, i) => value + (b[i] - value) * train.fraction);
      if (!within(p, 6)) continue;
      fx.save();
      fx.translate(...p);
      fx.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]));
      fx.fillStyle = '#fff';
      fx.strokeStyle = train.line === focusRoute.id ? '#d90070' : lineColors[train.line] || '#486d91';
      fx.lineWidth = 1.8;
      fx.beginPath();
      fx.roundRect(-6, -3.4, 12, 6.8, 2.5);
      fx.fill();
      fx.stroke();
      fx.restore();
    }
    for (const rider of audience) {
      const a = screen(rider.a), b = screen(rider.b ?? rider.a);
      if (!a || !b) continue;
      const point = a.map((value, i) => value + (b[i] - value) * (rider.fraction ?? 0));
      if (!within(point, 7)) continue;
      circle(fx, point, presenting ? 7 : 5, '#007c72', '#fff', 2.3);
      const text = rider.label;
      if (!text) continue;
      fx.font = `800 ${presenting ? 16 : 12}px 'Noto Sans CJK KR', system-ui, sans-serif`;
      fx.textAlign = 'center';
      fx.textBaseline = 'middle';
      const labelWidth = fx.measureText(text).width + 14;
      const labelX = Math.max(3, Math.min(point[0] - labelWidth / 2, width - labelWidth - 3));
      const labelY = point[1] >= 30 ? point[1] - 29 : point[1] + 9;
      fx.beginPath();
      fx.roundRect(labelX, labelY, labelWidth, 22, 8);
      fx.fillStyle = '#fff';
      fx.fill();
      fx.fillStyle = '#00685f';
      fx.fillText(text, labelX + labelWidth / 2, labelY + 11);
    }
  }

  function pickStation(x, y) {
    let hit = null, distance = 19;
    for (const [id] of eligible) {
      const p = screen(id);
      const next = Math.hypot(x - p[0], y - p[1]);
      if (next < distance) { hit = id; distance = next; }
    }
    selected = hit;
    if (hit) onStation?.(hit);
    else onEmpty?.();
    draw();
  }

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, pinched: pointers.size > 0 });
    if (pointers.size > 1) for (const pointer of pointers.values()) pointer.pinched = true;
    gesture = null;
  });
  canvas.addEventListener('pointermove', (event) => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (pointers.size === 1) {
      tx += dx;
      ty += dy;
      if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 4) fitted = null;
      draw();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture) {
        const bounds = canvas.getBoundingClientRect();
        tx += mid[0] - gesture.mid[0];
        ty += mid[1] - gesture.mid[1];
        zoom(distance / Math.max(1, gesture.distance), mid[0] - bounds.left, mid[1] - bounds.top);
      }
      gesture = { mid, distance };
    }
  });
  canvas.addEventListener('pointerup', (event) => {
    const pointer = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    gesture = null;
    if (onStation && pointer && !pointer.pinched && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 5) {
      const bounds = canvas.getBoundingClientRect();
      pickStation(event.clientX - bounds.left, event.clientY - bounds.top);
    }
  });
  canvas.addEventListener('pointercancel', (event) => { pointers.delete(event.pointerId); gesture = null; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const bounds = canvas.getBoundingClientRect();
    zoom(Math.exp(-event.deltaY * .0018), event.clientX - bounds.left, event.clientY - bounds.top);
  }, { passive: false });
  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();

  return {
    fit, zoom,
    name: (line) => lineNames[line] || line,
    setBase(next) {
      ({ mode, dim = false, focused = false, journey = [], pins = [] } = next);
      draw();
    },
    setEffects(next) {
      ({ candidates = [], audience = [], trains = [] } = next);
      drawEffects();
    },
  };
}
