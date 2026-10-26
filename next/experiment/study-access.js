// The single notification study can be operated only by a manager responsible
// for every target class. Legacy PinCon research used the 1-8 cohort.
export function studyAccess(user, role, config) {
  const signedIn = Boolean(user?.uid && !user.isAnonymous);
  const schoolAdmin = signedIn && role?.enabled === true && role.level === "school";
  const targets = config?.targetClassKeys?.length ? config.targetClassKeys : ["1-8"];
  const classKeys = Array.isArray(role?.classKeys) ? role.classKeys : [];
  const classAdmin = signedIn && role?.enabled === true
    && ["class", "grade", "president"].includes(role.level);
  return { canManage: schoolAdmin || (classAdmin && targets.every((key) => classKeys.includes(key))),
    schoolAdmin, classKeys: schoolAdmin ? null : classKeys,
    label: schoolAdmin ? "학교 관리자" : classAdmin ? "학급 관리자" : "참가자" };
}
