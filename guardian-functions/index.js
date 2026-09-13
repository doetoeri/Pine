const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");

initializeApp();
const db = getFirestore();

exports.guardianScreenShareNotify = onDocumentWritten(
  {
    document: "guardianFamilies/{familyId}/devices/{deviceId}/screenShare/current",
    region: "asia-northeast3",
    maxInstances: 5,
  },
  async (event) => {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return;

    const data = after.data() || {};
    if (data.status !== "REQUESTED") return;

    const before = event.data && event.data.before;
    const beforeData = before && before.exists ? before.data() || {} : {};
    const requestedAt = Number(data.requestedAtMillis || 0);
    if (
      beforeData.status === "REQUESTED" &&
      Number(beforeData.requestedAtMillis || 0) === requestedAt
    ) {
      return;
    }

    const { familyId, deviceId } = event.params;
    const push = await db
      .doc(`guardianFamilies/${familyId}/devices/${deviceId}/push/current`)
      .get();
    const token = push.exists ? push.get("token") : null;
    if (typeof token !== "string" || token.length < 20) {
      console.log("Guardian screen-share request has no registered FCM token", familyId, deviceId);
      return;
    }

    try {
      await getMessaging().send({
        token,
        android: { priority: "high" },
        data: {
          type: "screen_share_request",
          familyId: String(familyId),
          deviceId: String(deviceId),
          requestedAtMillis: String(requestedAt),
        },
      });
      console.log("Guardian screen-share request notification sent", familyId, deviceId);
    } catch (error) {
      console.error("Guardian screen-share FCM send failed", familyId, deviceId, error);
    }
  },
);
