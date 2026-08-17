import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const SCHOOL_ID = "gochon-high";
const CLASS_KEY = "1-8";

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "");
if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore();
const snapshot = await db.collection("schools").doc(SCHOOL_ID)
  .collection("pushSubscriptions")
  .where("classKey", "==", CLASS_KEY)
  .where("enabled", "==", true)
  .get();

const tokens = snapshot.docs.map((doc) => String(doc.data().token || "").trim()).filter(Boolean);
if (!tokens.length) {
  throw new Error(`${CLASS_KEY}에 등록된 웹 푸시 기기가 없습니다.`);
}

let successCount = 0;
let failureCount = 0;
for (let i = 0; i < tokens.length; i += 500) {
  const batch = tokens.slice(i, i + 500);
  const result = await getMessaging().sendEachForMulticast({
    tokens: batch,
    data: {
      title: "Pincon 테스트 알림",
      body: "푸시 알림 연결이 정상입니다. 컴시간 시간표 변경도 같은 방식으로 알려드려요.",
      tag: "pincon-test-push",
      link: "https://pincon.app/",
    },
    webpush: {
      headers: { Urgency: "high" },
    },
  });
  successCount += result.successCount;
  failureCount += result.failureCount;
}

console.log(JSON.stringify({ classKey: CLASS_KEY, devices: tokens.length, successCount, failureCount }));
if (!successCount) process.exitCode = 1;
