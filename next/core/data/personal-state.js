// Device-local personal state is namespaced by authenticated uid and class.
// It is never included in class records, public cache, analytics or admin APIs.
export class PersonalState {
  constructor(storage, uid, classKey) { this.storage=storage; this.key=uid && classKey ? `pincon-personal-v1:${uid}:${classKey}` : ""; this.value=this.read(); }
  read() { try { return JSON.parse(this.storage.getItem(this.key) || "{}") || {}; } catch { return {}; } }
  save() { if (!this.key) throw new Error("로그인이 필요합니다."); this.storage.setItem(this.key,JSON.stringify(this.value)); }
  get lastSeenAt() { return Number(this.value.lastSeenAt || 0); }
  markSeen(displayedAt) { if (!Number.isFinite(displayedAt) || displayedAt > Date.now()) return; this.value.lastSeenAt=Math.max(this.lastSeenAt,displayedAt); this.save(); }
  completed(date,key) { return this.value.completed?.[date]?.[key] === true; }
  complete(date,key,done) { const all=this.value.completed ||= {}; const day=all[date] ||= {}; if(done) day[key]=true; else delete day[key]; for(const old of Object.keys(all).sort().slice(0,-30)) delete all[old]; this.save(); }
}
