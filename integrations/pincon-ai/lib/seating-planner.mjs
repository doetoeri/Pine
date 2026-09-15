// Shared, dependency-free seating rules. Safe to import in a browser Worker.
const bounded = (value, min, max, fallback) => Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;
const uniqueIds = (values, known) => [...new Set(Array.isArray(values) ? values.filter(id => typeof id === "string" && known.has(id)) : [])];

export function normalizePlanner(value = {}, ids = []) {
  const known = new Set(ids);
  return {
    frontRows: bounded(value?.frontRows, 1, 10, 2),
    frontStudentIds: uniqueIds(value?.frontStudentIds, known),
    lockedSeats: Array.isArray(value?.lockedSeats) ? value.lockedSeats.slice(0, 80).filter(item => known.has(item?.uid) && Number.isInteger(item?.index) && item.index >= 0 && item.index < 100).map(({ uid, index }) => ({ uid, index })) : [],
    separationDistance: bounded(value?.separationDistance, 2, 4, 2),
    spreadFocus: value?.spreadFocus !== false,
    avoidPrevious: value?.avoidPrevious === true,
  };
}

export function seatDistance(a, b, cols) {
  return Math.max(Math.abs(Math.floor(a / cols) - Math.floor(b / cols)), Math.abs(a % cols - b % cols));
}

export function constraintErrors(g, ids) {
  const errors = [];
  if (!Array.isArray(ids) || !ids.length) return ["등록된 학생이 없습니다."];
  if (new Set(ids).size !== ids.length) errors.push("학생 명단에 중복 ID가 있습니다.");
  if (![g.rows, g.cols].every(n => Number.isInteger(n) && n >= 3 && n <= 10)) return ["교실 행과 열은 3~10 사이의 정수여야 합니다."];
  const total = g.rows * g.cols, known = new Set(ids), blocked = new Set(g.blocked || []);
  if ([...blocked].some(i => !Number.isInteger(i) || i < 0 || i >= total)) errors.push("사용하지 않는 자리의 위치를 확인해주세요.");
  if (total - blocked.size < ids.length) errors.push(`사용 가능한 자리가 ${ids.length - (total - blocked.size)}석 부족합니다.`);
  const p = normalizePlanner(g.planner, ids), locks = new Map(), lockedIds = new Set();
  const front = new Set(p.frontStudentIds);
  if (p.frontRows > g.rows) errors.push("앞자리 범위가 교실 행 수보다 큽니다.");
  for (const lock of p.lockedSeats) {
    if (!known.has(lock.uid)) continue;
    if (lock.index >= total || blocked.has(lock.index)) errors.push("고정석이 사용하지 않는 자리 또는 교실 밖에 있습니다.");
    if (locks.has(lock.index) || lockedIds.has(lock.uid)) errors.push("한 학생 또는 한 자리에 고정석을 중복 지정했습니다.");
    if (front.has(lock.uid) && lock.index >= p.frontRows * g.cols) errors.push("앞자리로 지정한 학생의 고정석이 앞자리 범위 밖에 있습니다.");
    locks.set(lock.index, lock.uid); lockedIds.add(lock.uid);
  }
  const freeFront = Array.from({ length: Math.min(g.rows, p.frontRows) * g.cols }, (_, i) => i).filter(i => !blocked.has(i) && !locks.has(i)).length;
  const needFront = p.frontStudentIds.filter(id => !lockedIds.has(id)).length;
  if (freeFront < needFront) errors.push(`앞자리가 ${needFront - freeFront}석 부족합니다. 앞자리 범위를 늘리거나 고정석을 조정해주세요.`);
  return [...new Set(errors)];
}

function rules(g, ids) {
  const known = new Set(ids), p = normalizePlanner(g.planner, ids), pairs = new Map();
  for (const pair of g.separationPairs || []) {
    if (!Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1] || !pair.every(id => known.has(id))) continue;
    const [a, b] = pair.slice().sort(); pairs.set(JSON.stringify([a, b]), { a, b, type: "pair", weight: 100000 });
  }
  if (p.spreadFocus) {
    const focus = uniqueIds(g.focusStudentIds, known);
    for (let a = 0; a < focus.length; a++) for (let b = a + 1; b < focus.length; b++) {
      const [x, y] = [focus[a], focus[b]].sort(), key = JSON.stringify([x, y]);
      if (!pairs.has(key)) pairs.set(key, { a: x, b: y, type: "focus", weight: 1000 });
    }
  }
  return { p, pairs: [...pairs.values()] };
}

export function inspectSeating(g, ids, seats = g.seats || []) {
  const hard = constraintErrors(g, ids), known = new Set(ids), positions = new Map(), blocked = new Set(g.blocked || []);
  seats.forEach((id, index) => {
    if (!id) return;
    if (!known.has(id)) hard.push("명단에 없는 학생이 배치되어 있습니다.");
    if (positions.has(id)) hard.push("같은 학생이 두 자리에 배치되어 있습니다.");
    if (blocked.has(index) || index >= g.rows * g.cols) hard.push("사용할 수 없는 자리에 학생이 배치되어 있습니다.");
    positions.set(id, index);
  });
  const missing = ids.filter(id => !positions.has(id));
  if (missing.length) hard.push(`아직 자리가 없는 학생이 ${missing.length}명 있습니다.`);
  const { p, pairs } = rules(g, ids);
  if (p.frontStudentIds.some(id => positions.has(id) && positions.get(id) >= p.frontRows * g.cols)) hard.push("앞자리 지정이 지켜지지 않았습니다.");
  if (p.lockedSeats.some(({ uid, index }) => seats[index] !== uid)) hard.push("고정석 지정이 지켜지지 않았습니다.");
  const conflicts = pairs.flatMap(({ a, b, type }) => positions.has(a) && positions.has(b) && seatDistance(positions.get(a), positions.get(b), g.cols) < p.separationDistance ? [{ a, b, type, distance: seatDistance(positions.get(a), positions.get(b), g.cols) }] : []);
  const previous = g.seats || [];
  const repeat = ids.filter(id => positions.has(id) && previous[positions.get(id)] === id).length;
  return { hard: [...new Set(hard)], conflicts, repeat, assigned: ids.length - missing.length };
}

export function publicSeatingView({ classKey, roster, general, updatedAtMs }) {
  // Explicit allowlist: no nominations, reasons, constraints, reporter, or studentNumber.
  return {
    projection: "seating-tv", classKey,
    roster: roster.map(({ uid, name, number }) => ({ uid, name, number })),
    general: { rows: general.rows, cols: general.cols, seats: [...general.seats], blocked: [...general.blocked], sections: Array.isArray(general.sections) ? general.sections.slice(0, 3) : [] },
    updatedAtMs,
  };
}

function rng(seed) {
  let state = Number(seed) >>> 0;
  return () => { state += 0x6D2B79F5; let t = Math.imul(state ^ state >>> 15, 1 | state); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle(values, random) {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export function* seatingCandidates(g, ids, { seed = Date.now(), restarts = 18, iterations = 3500 } = {}) {
  const errors = constraintErrors(g, ids);
  if (errors.length) throw new Error(errors.join("\n"));
  const { p, pairs } = rules(g, ids), random = rng(seed), total = g.rows * g.cols;
  const blocked = new Set(g.blocked || []), locked = new Map(p.lockedSeats.map(l => [l.index, l.uid]));
  const lockedIds = new Set(locked.values()), frontIds = new Set(p.frontStudentIds);
  const slots = Array.from({ length: total }, (_, i) => i).filter(i => !blocked.has(i) && !locked.has(i));
  const freeFront = slots.filter(i => i < p.frontRows * g.cols);
  const movableFront = ids.filter(id => frontIds.has(id) && !lockedIds.has(id));
  const others = ids.filter(id => !frontIds.has(id) && !lockedIds.has(id));
  const score = (seats) => {
    const pos = new Map(); seats.forEach((id, i) => { if (id) pos.set(id, i); });
    let cost = 0;
    for (const pair of pairs) {
      const distance = seatDistance(pos.get(pair.a), pos.get(pair.b), g.cols);
      if (distance < p.separationDistance) {
        const a = pos.get(pair.a), b = pos.get(pair.b);
        const deskMates = g.cols === 6 && Math.floor(a / 6) === Math.floor(b / 6) && Math.floor(a % 6 / 2) === Math.floor(b % 6 / 2);
        cost += pair.weight * (1 + (p.separationDistance - distance) * .1 + (deskMates ? .4 : 0));
      }
    }
    if (p.avoidPrevious) for (const id of ids) if (g.seats?.[pos.get(id)] === id) cost += 1;
    return cost;
  };
  let best, bestScore = Infinity;
  const runs = bounded(restarts, 1, 60, 18), steps = bounded(iterations, 0, 20000, 3500);
  for (let run = 0; run < runs; run++) {
    const seats = Array(total).fill("");
    for (const [index, id] of locked) seats[index] = id;
    const frontSlots = shuffle(freeFront, random);
    shuffle(movableFront, random).forEach((id, i) => { seats[frontSlots[i]] = id; });
    const remainingSlots = shuffle(slots.filter(i => !seats[i]), random);
    shuffle(others, random).forEach((id, i) => { seats[remainingSlots[i]] = id; });
    let current = score(seats);
    if (current < bestScore) { bestScore = current; best = seats.slice(); }
    for (let step = 0; step < steps && bestScore > 0 && slots.length > 1; step++) {
      const a = slots[Math.floor(random() * slots.length)], b = slots[Math.floor(random() * slots.length)];
      if (a === b || seats[a] === seats[b]) continue;
      if ((frontIds.has(seats[a]) && b >= p.frontRows * g.cols) || (frontIds.has(seats[b]) && a >= p.frontRows * g.cols)) continue;
      [seats[a], seats[b]] = [seats[b], seats[a]];
      const next = score(seats), temperature = 0.1 + 25000 * Math.pow(1 - step / Math.max(steps, 1), 3);
      if (next <= current || random() < Math.exp((current - next) / temperature)) current = next;
      else [seats[a], seats[b]] = [seats[b], seats[a]];
      if (current < bestScore) { bestScore = current; best = seats.slice(); }
    }
    const done = bestScore === 0 || run === runs - 1;
    yield { seats: best.slice(), score: bestScore, report: inspectSeating(g, ids, best), seed, progress: done ? 1 : (run + 1) / runs, done };
    if (done) return;
  }
}
