import { NextDataGateway } from "../core/data-gateway.js";

const EDITABLE_COLLECTIONS = new Set([
  "announcements",
  "classAssignments",
  "evaluationPlans",
  "events",
]);

function clean(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function validDate(value) {
  const text = clean(value, 10);
  if (!text) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("날짜를 확인해 주세요.");
  return text;
}

function localDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cleanUrl(value) {
  const text = clean(value, 1200);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("protocol");
    return url.href;
  } catch {
    throw new Error("학교 원문 링크 주소를 확인해 주세요.");
  }
}

function safeAudit(value = {}) {
  const out = {};
  for (const [key, item] of Object.entries(value || {}).slice(0, 60)) {
    if (key === "id" || key.startsWith("__")) continue;
    if (typeof item === "string") out[key] = item.slice(0, 2000);
    else if (["number", "boolean"].includes(typeof item) || item === null) out[key] = item;
    else if (Array.isArray(item)) out[key] = item.slice(0, 40);
  }
  return out;
}

function normalize(collection, values = {}) {
  if (collection === "announcements") {
    const title = clean(values.title, 100);
    if (!title) throw new Error("공지 제목을 입력해 주세요.");
    const priority = ["normal", "important", "urgent"].includes(values.priority) ? values.priority : "normal";
    return {
      title,
      body: clean(values.body, 1800),
      priority,
      important: priority !== "normal",
      published: values.published !== false,
    };
  }

  if (collection === "classAssignments") {
    const title = clean(values.title, 120);
    if (!title) throw new Error("수행·숙제 제목을 입력해 주세요.");
    const dueDate = validDate(values.dueDate);
    const dueAtMs = dueDate ? new Date(`${dueDate}T23:59:00`).getTime() : 0;
    return {
      title,
      subject: clean(values.subject, 40),
      type: ["assessment", "exam", "preparation"].includes(values.type) ? values.type : "assessment",
      dateType: ["exact", "range", "month", "undecided"].includes(values.dateType)
        ? values.dateType
        : (dueDate ? "exact" : "undecided"),
      dueDate,
      dueAtMs: Number.isFinite(dueAtMs) ? dueAtMs : 0,
      description: clean(values.description, 1200),
      evaluationRange: clean(values.evaluationRange, 600),
      evaluationMethod: clean(values.evaluationMethod, 500),
      materials: clean(values.materials, 500),
      points: clean(values.points, 120),
      evaluationPlanId: clean(values.evaluationPlanId, 160),
      pageReferences: clean(values.pageReferences, 120),
      verificationStatus: ["review", "verified", "changed"].includes(values.verificationStatus)
        ? values.verificationStatus
        : "review",
      published: values.published !== false,
      announcedDate: validDate(values.announcedDate) || localDate(),
      recoveryRelevant: values.recoveryRelevant !== false,
    };
  }

  if (collection === "evaluationPlans") {
    const title = clean(values.title, 140);
    const subject = clean(values.subject, 40);
    if (!title) throw new Error("평가계획서 제목을 입력해 주세요.");
    if (!subject) throw new Error("과목을 입력해 주세요.");
    return {
      title,
      subject,
      schoolYear: Math.max(2000, Math.min(2100, Math.trunc(Number(values.schoolYear || new Date().getFullYear())))),
      semester: Number(values.semester) === 2 ? 2 : 1,
      status: ["draft", "review", "verified"].includes(values.status) ? values.status : "review",
      sourceUrl: cleanUrl(values.sourceUrl),
      sourceAttribution: clean(values.sourceAttribution, 300),
      pageCount: Math.max(0, Math.min(999, Math.trunc(Number(values.pageCount || 0)))),
      description: clean(values.description, 1000),
      announcedDate: validDate(values.announcedDate) || localDate(),
      recoveryRelevant: values.recoveryRelevant !== false,
    };
  }

  if (collection === "events") {
    const title = clean(values.title, 120);
    const question = clean(values.question, 500);
    if (!title) throw new Error("행사 제목을 입력해 주세요.");
    if (!question) throw new Error("행사 질문 또는 설명을 입력해 주세요.");
    const status = ["draft", "open", "closed"].includes(values.status) ? values.status : "draft";
    return {
      title,
      question,
      kind: ["survey34", "family-arcade", "quiz", "balance", "class-vote", "survey", "mini-game"].includes(values.kind)
        ? values.kind
        : "survey34",
      date: validDate(values.date),
      status,
      acceptingResponses: status === "open",
      startsAtMs: status === "open" ? Number(values.startsAtMs || Date.now()) : Number(values.startsAtMs || 0),
      resultsVisible: values.resultsVisible === true,
      publishedResults: Array.isArray(values.publishedResults) ? values.publishedResults.slice(0, 40) : [],
    };
  }

  throw new Error("지원하지 않는 콘텐츠 종류입니다.");
}

function titleOf(record, collection) {
  return clean(record?.title || record?.name || record?.subject || collection, 120);
}

export class ContentServiceV2 extends EventTarget {
  constructor(gateway = new NextDataGateway()) {
    super();
    this.gateway = gateway;
    this.busy = false;
  }

  snapshot() {
    return this.gateway.snapshot();
  }

  async ready() {
    await this.gateway.start();
    const snapshot = this.gateway.snapshot();
    const repository = this.gateway.repository;
    if (!snapshot.profile?.classKey) throw new Error("관리할 학급을 먼저 선택해 주세요.");
    if (!snapshot.canArchiveContent) throw new Error("이 학급을 운영할 관리자 권한이 없습니다.");
    if (!repository) throw new Error("PinCon 데이터 연결이 준비되지 않았습니다.");
    const user = await repository.ensureUser();
    if (!user?.uid) throw new Error("관리자 로그인이 필요합니다.");
    if (!repository.api?.writeBatch || !repository.api?.getDoc) throw new Error("Firestore 쓰기 모듈을 불러오지 못했습니다.");
    return { snapshot, repository, user };
  }

  find(collection, id) {
    return (this.gateway.snapshot().data?.[collection] || []).find((item) => item?.id === id) || null;
  }

  async save(collection, values, { id = "", file = null, fileConfirmed = false } = {}) {
    if (!EDITABLE_COLLECTIONS.has(collection)) throw new Error("지원하지 않는 콘텐츠 종류입니다.");
    if (this.busy) throw new Error("이전 저장이 아직 끝나지 않았습니다.");
    this.busy = true;
    try {
      const { snapshot, repository, user } = await this.ready();
      const api = repository.api;
      const current = id ? this.find(collection, id) : null;
      let normalized = normalize(collection, values);
      let recordId = id;

      if (collection === "evaluationPlans") {
        if (file) {
          if (!fileConfirmed) throw new Error("파일의 공유 권한과 개인정보 제거 여부를 확인해 주세요.");
          recordId ||= globalThis.crypto?.randomUUID?.() || `plan-${Date.now()}`;
          const upload = await repository.uploadFile("evaluation-plans", recordId, file);
          normalized = {
            ...normalized,
            fileName: upload?.fileName || "",
            storagePath: upload?.storagePath || "",
          };
        } else {
          normalized = {
            ...normalized,
            fileName: current?.fileName || "",
            storagePath: current?.storagePath || "",
          };
        }
        if (!normalized.sourceUrl && !normalized.storagePath) {
          throw new Error("평가계획서 PDF 또는 학교 원문 링크를 등록해 주세요.");
        }
      }

      const now = Date.now();
      const collectionRef = repository.collectionRef(collection);
      const targetRef = recordId ? repository.documentRef(collection, recordId) : api.doc(collectionRef);
      recordId = targetRef.id;
      const beforeSnapshot = current ? await api.getDoc(targetRef) : null;
      const before = beforeSnapshot?.exists?.() ? beforeSnapshot.data() : null;
      const next = {
        ...(before || current || {}),
        ...normalized,
        classKey: snapshot.profile.classKey,
        deleted: false,
        deletedAtMs: null,
        updatedAtMs: now,
        updatedAt: api.serverTimestamp(),
      };
      delete next.id;
      for (const key of Object.keys(next)) if (key.startsWith("__")) delete next[key];
      if (!before && !current) {
        next.createdAtMs = now;
        next.createdAt = api.serverTimestamp();
      }

      const changeRef = api.doc(repository.collectionRef("changeLogs"));
      const batch = api.writeBatch(api.db);
      batch.set(targetRef, next, { merge: false });
      batch.set(changeRef, {
        classKey: snapshot.profile.classKey,
        collection,
        documentId: recordId,
        action: current ? "update" : "create",
        label: titleOf(next, collection),
        before: before ? safeAudit(before) : null,
        after: safeAudit(next),
        actorUid: user.uid,
        actorName: clean(user.displayName || "관리자", 40),
        createdAtMs: now,
        createdAt: api.serverTimestamp(),
        source: "operations-center-v2",
      });
      await batch.commit();

      const verify = await api.getDoc(targetRef);
      if (!verify?.exists?.()) throw new Error("서버 저장 확인에 실패했습니다. 다시 시도해 주세요.");
      const saved = verify.data();
      if (saved?.classKey !== snapshot.profile.classKey) throw new Error("저장된 학급 정보가 일치하지 않습니다.");

      this.dispatchEvent(new CustomEvent("saved", { detail: { collection, id: recordId, record: saved } }));
      return { id: recordId, record: saved };
    } catch (error) {
      const code = clean(error?.code, 120);
      if (code.includes("permission-denied")) {
        throw new Error("Firestore가 저장을 거부했습니다. 관리자 역할과 학급 권한을 다시 확인해 주세요.");
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async setArchived(collection, id, archived) {
    if (!EDITABLE_COLLECTIONS.has(collection)) throw new Error("지원하지 않는 콘텐츠 종류입니다.");
    const { snapshot, repository, user } = await this.ready();
    const api = repository.api;
    const targetRef = repository.documentRef(collection, id);
    const beforeSnapshot = await api.getDoc(targetRef);
    if (!beforeSnapshot?.exists?.()) throw new Error("대상 콘텐츠를 찾지 못했습니다.");
    const before = beforeSnapshot.data();
    if (before.classKey !== snapshot.profile.classKey) throw new Error("다른 학급의 콘텐츠는 변경할 수 없습니다.");

    const now = Date.now();
    const next = {
      ...before,
      deleted: archived,
      deletedAtMs: archived ? now : null,
      updatedAtMs: now,
      updatedAt: api.serverTimestamp(),
    };
    const changeRef = api.doc(repository.collectionRef("changeLogs"));
    const batch = api.writeBatch(api.db);
    batch.set(targetRef, next, { merge: false });
    batch.set(changeRef, {
      classKey: snapshot.profile.classKey,
      collection,
      documentId: id,
      action: archived ? "archive" : "restore",
      label: `${titleOf(before, collection)} ${archived ? "보관" : "복원"}`,
      before: safeAudit(before),
      after: safeAudit(next),
      actorUid: user.uid,
      actorName: clean(user.displayName || "관리자", 40),
      createdAtMs: now,
      createdAt: api.serverTimestamp(),
      source: "operations-center-v2",
    });
    await batch.commit();
    const verify = await api.getDoc(targetRef);
    if (!verify?.exists?.() || verify.data()?.deleted !== archived) {
      throw new Error(archived ? "보관 확인에 실패했습니다." : "복원 확인에 실패했습니다.");
    }
    return verify.data();
  }

  archive(collection, id) {
    return this.setArchived(collection, id, true);
  }

  restore(collection, id) {
    return this.setArchived(collection, id, false);
  }
}

export { EDITABLE_COLLECTIONS };
