export const visible = (r) => r && !r.deleted && r.published !== false && !["draft", "PENDING_REVIEW", "REJECTED"].includes(r.status);
export function timestamp(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value?.seconds != null) return Number(value.seconds)*1000;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return Date.parse(value || "") || 0;
}
export const updated = (r) => Math.max(...["updatedAtMs", "updatedAt", "publishedAtMs", "publishedAt", "createdAtMs", "createdAt", "clientCreatedAt", "clientUpdatedAt", "changedAtMs"].map(k => timestamp(r[k])));
export const schoolDate = (now = Date.now()) => new Date(Number(now) + 9*3600000).toISOString().slice(0,10);
const subjectKey = (value) => ({공영:"공통영어",공수:"공통수학",공국:"공통국어",통사:"통합사회",통과:"통합과학"})[value] || String(value || "").replace(/\s/g, "");
export function changesSince(data, lastSeenAt, now = Date.now()) {
  if (!lastSeenAt) return [];
  const rows = [];
  for (const name of ["announcements", "content", "classAssignments", "events", "academicSchedules", "neisTimetables", "subjectEntries"]) {
    for (const r of data[name] || []) {
      const at = updated(r);
      if (!visible(r) || !r.id || at <= lastSeenAt || at > now) continue;
      const changes = Array.isArray(r.differences) ? r.differences.join(" · ") : r.changeSummary || r.changeDescription;
      rows.push({ key: `${name}:${r.id}`, collection: name, id: r.id, at, title: changes || r.title || (name === "neisTimetables" ? `${r.date} 시간표 변경` : r.subject || "정보 변경"), item: r });
    }
  }
  return rows.sort((a,b) => b.at-a.at || a.key.localeCompare(b.key));
}
function minutes(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1]*60 + +m[2] : null;
}
export function nextClass(data, { now = Date.now(), subjectEntries = [], bellSchedule = [], homeroom = "" } = {}) {
  const date = schoolDate(now);
  const document = (data.neisTimetables || []).find(r => r.date === date && !r.deleted);
  const periods = [...(document?.periods || [])].sort((a,b) => +a.period - +b.period);
  if (!periods.length) return { state: "empty", label: "등록된 수업이 없습니다" };
  const timed = periods.map(r => {
    const bell = bellSchedule.find(b => +b.period === +r.period) || {};
    return { ...r, start: minutes(r.startTime || bell.startTime), end: minutes(r.endTime || bell.endTime) };
  });
  if (timed.some(r => r.start === null || r.end === null || r.end <= r.start)) return { state: "untimed", label: "교시 시간이 등록되지 않았습니다", periods };
  const shifted = new Date(Number(now) + 9*3600000);
  const minute = shifted.getUTCHours()*60 + shifted.getUTCMinutes();
  const lesson = timed.find(r => minute < r.end);
  if (!lesson) return { state: "finished", label: "오늘 수업이 끝났습니다" };
  const ongoing = minute >= lesson.start;
  const previous = timed[timed.indexOf(lesson)-1];
  const lunch = !ongoing && previous && lesson.start-previous.end >= 50;
  const related = subjectEntries.filter(r => visible(r) && subjectKey(r.subject) === subjectKey(lesson.subject) && r.dueDate === date && (!r.period || +r.period === +lesson.period));
  const roomChanges = related.filter(r => r.type === "CLASSROOM_CHANGE");
  const rooms = [...new Set(roomChanges.map(r => r.classroom).filter(Boolean))];
  const roomConflict = rooms.length > 1;
  const room = roomConflict ? "교실 정보가 서로 다릅니다" : rooms[0] || lesson.room || lesson.classroom || "";
  const materials = [...new Set([lesson.materials, ...related.filter(r => r.type === "MATERIAL").map(r => r.materials || r.body), ...(data.classAssignments || []).filter(r => visible(r) && r.dueDate === date && subjectKey(r.subject) === subjectKey(lesson.subject)).map(r => r.materials)].filter(Boolean))].join(" · ");
  return { state: ongoing ? "ongoing" : lunch ? "lunch" : "next", label: ongoing ? `${lesson.period}교시 수업 중 · ${lesson.end-minute}분 뒤 종료` : `${lunch ? "점심시간 · " : ""}${lesson.period}교시까지 ${lesson.start-minute}분`, lesson, room, materials, roomConflict, changed: rooms.length > 0, movement: !roomConflict && Boolean(lesson.movement || (homeroom && room && room !== homeroom)), document };
}
export function todayTasks(data, { date = schoolDate(), home = null } = {}) {
  const rows = (data.classAssignments || []).filter(r => visible(r) && r.dueDate === date && r.id).map(r => ({ key: `classAssignments:${r.id}`, title: r.title || r.subject, collection: "classAssignments", id:r.id }));
  for (const r of home?.today?.subjectEntries || []) {
    if (visible(r) && r.id && r.dueDate === date && ["HOMEWORK", "MATERIAL", "WORKSHEET"].includes(r.type)) rows.push({ key:`subjectEntries:${r.id}`, title:r.title || r.materials, collection:"subjectEntries", id:r.id });
  }
  const cleaning = home?.today?.cleaning;
  if (cleaning && (!cleaning.date || cleaning.date === date) && !["EXEMPTED", "CANCELLED"].includes(cleaning.status)) rows.push({ key:`cleaning:${cleaning.id}:${date}`, title:"대걸레 당번", personalOnly:true });
  const role = home?.today?.onePersonRole;
  if (role) rows.push({ key:`role:${role.id || role.name}:${date}`, title:role.name || "1인1역", personalOnly:true });
  return [...new Map(rows.map(r => [r.key,r])).values()];
}
export function sourceInfo(item = {}, collection = "") {
  const type = String(item.sourceType || item.source || "").toUpperCase();
  const labels = { NEIS:"NEIS", COMCIGAN:"컴시간", SCHOOL:"학교 공식 자료", OFFICIAL:"학교 공식 자료", EVALUATION_PLAN:"평가계획서", SUBJECT_MANAGER:"과목 관리자", CLASS_PRESIDENT:"학급 회장", STUDENT_REPORT:"학생 제보" };
  const label = labels[type] || (collection === "evaluationPlans" || item.evaluationPlanId ? "평가계획서" : ["meals", "academicSchedules"].includes(collection) ? "NEIS" : collection === "subjectEntries" ? "과목 관리자" : "출처 미등록");
  return { label, confirmedAt: timestamp(item.lastVerifiedAtMs || item.lastVerifiedAt), verified: item.confirmed === true || ["verified", "confirmed"].includes(item.verificationStatus) };
}
// Explicit linkage or exact subject + title identifies one item. Never merge
// unrelated assessments merely because they share a subject or a date.
export function informationConflicts(data) {
  const groups = new Map();
  const titleKey = r => r.subject && r.title ? `${subjectKey(r.subject)}:${r.title.trim()}` : "";
  const assignmentsByTitle = new Map((data.classAssignments || []).filter(visible).map(r => [titleKey(r), r.id]));
  for (const collection of ["classAssignments", "evaluationPlans", "announcements", "subjectEntries"]) {
    for (const r of data[collection] || []) {
      if (!visible(r)) continue;
      const key = r.assignmentId || r.relatedAssignmentId || (collection === "classAssignments" ? r.id : assignmentsByTitle.get(titleKey(r)) || "");
      const identity = key ? `id:${key}` : r.subject && r.title ? `title:${subjectKey(r.subject)}:${r.title.trim()}` : "";
      if (!identity) continue;
      const rows = groups.get(identity) || []; rows.push({ r, collection }); groups.set(identity, rows);
    }
  }
  const conflicts = [];
  for (const [key, rows] of groups) {
    for (const field of ["dueDate", "classroom", "materials"]) {
      const values = rows.map(({r,collection}) => ({ value:String(r[field] || (field === "dueDate" ? r.date : "") || "").trim(), source:sourceInfo(r,collection).label, id:r.id, collection })).filter(r=>r.value);
      if (new Set(values.map(r=>r.value)).size > 1) conflicts.push({ key, field, title:rows[0].r.title, values });
    }
  }
  return conflicts;
}
