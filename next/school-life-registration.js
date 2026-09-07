import { NextDataGateway, readClassProfile } from "./core/data-gateway.js";

const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high" };
const gateway = new NextDataGateway();
let lastKey = "";

async function syncRegistration(snapshot = gateway.snapshot()) {
  const profile = snapshot.profile || readClassProfile();
  const user = snapshot.user;
  const api = gateway.repository?.api;
  if (!profile?.classKey || !user?.uid || !api) return;
  const key = `${profile.classKey}:${user.uid}`;
  if (key === lastKey) return;
  lastKey = key;
  const ref = api.doc(api.db, "schools", SCHOOL.id || "gochon-high", "schoolLifeUsers", user.uid);
  await api.setDoc(ref, {
    ownerUid: user.uid,
    classKey: profile.classKey,
    enabled: true,
    updatedAtMs: Date.now(),
    updatedAt: api.serverTimestamp(),
  }, { merge: true });
}

gateway.addEventListener("change", (event) => {
  syncRegistration(event.detail).catch(() => { lastKey = ""; });
});

await gateway.start().catch(() => null);
await syncRegistration().catch(() => { lastKey = ""; });
