import accountSession from "../handlers/accounts/session.mjs";
import accountManage from "../handlers/accounts/manage.mjs";
import accountCreate from "../handlers/accounts/create.mjs";
import accountClaim from "../handlers/accounts/claim.mjs";
import accountLogin from "../handlers/accounts/login.mjs";
import accountReset from "../handlers/accounts/reset.mjs";
import changePin from "../handlers/accounts/change-pin.mjs";
import personalNotifications from "../handlers/accounts/personal-notifications.mjs";
import home from "../handlers/class-ops/home.mjs";
import cleaning from "../handlers/class-ops/cleaning.mjs";
import duties from "../handlers/class-ops/duties.mjs";
import phone from "../handlers/class-ops/phone.mjs";
import subject from "../handlers/class-ops/subject.mjs";
import settings from "../handlers/class-ops/settings.mjs";
import adminOverview from "../handlers/class-ops/admin-overview.mjs";
import { sendJson } from "../lib/request.mjs";

// Keep account and class-operation endpoints in one Vercel Function. The public URLs stay stable through vercel.json rewrites.
const ROUTES = Object.freeze({
  "account-session": accountSession,
  "account-manage": accountManage,
  "account-create": accountCreate,
  "account-claim": accountClaim,
  "account-login": accountLogin,
  "account-reset": accountReset,
  "account-change-pin": changePin,
  "personal-notifications": personalNotifications,
  home,
  cleaning,
  duties,
  phone,
  subject,
  settings,
  "admin-overview": adminOverview,
});

export default async function classOpsRouter(req, res) {
  const url = new URL(req.url || "/", "https://pincon.invalid");
  const route = String(url.searchParams.get("route") || "");
  const handler = ROUTES[route];
  if (!handler) return sendJson(res, 404, { error: "route-not-found" });
  return handler(req, res);
}
