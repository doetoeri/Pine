import {
  corsHeaders,
  publicProfile,
  requireProfile,
  syncCompatibilityRole,
} from "../../lib/class-accounts.mjs";
import { sendJson } from "../../lib/request.mjs";

export default async function accountSession(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  if (req.method !== "GET") return sendJson(res, 405, { error: "method-not-allowed" }, headers);

  try {
    const { profile } = await requireProfile(req);
    // 로그인할 때 신형 계정 역할을 기존 Firestore Rules 호환 문서에 동기화한다.
    // 기존 학생도 별도 마이그레이션 없이 다음 로그인부터 부회장/과목 담당 권한을 적용받는다.
    await syncCompatibilityRole(profile, profile.uid);
    return sendJson(res, 200, { account: publicProfile(profile) }, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "session-failed" }, headers);
  }
}
