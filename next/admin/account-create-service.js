import { accountRequest } from "../core/student-auth.js?v=20260903-identity2";

export const ACCOUNT_CREATE_LIMIT = 60;
const ACCOUNT_CREATE_ENDPOINT = "/api/accounts/create";

export function studentNumberFromParts(grade, classNumber, number) {
  const g = Number(grade);
  const c = Number(classNumber);
  const n = Number(number);
  if (!Number.isInteger(g) || g < 1 || g > 3) return "";
  if (!Number.isInteger(c) || c < 1 || c > 10) return "";
  if (!Number.isInteger(n) || n < 1 || n > 60) return "";
  return `${g}${String(c).padStart(2, "0")}${String(n).padStart(2, "0")}`;
}

export function partsFromStudentNumber(value) {
  const studentNumber = String(value || "").trim();
  if (!/^\d{5}$/.test(studentNumber)) return null;
  const grade = Number(studentNumber.slice(0, 1));
  const classNumber = Number(studentNumber.slice(1, 3));
  const number = Number(studentNumber.slice(3, 5));
  if (grade < 1 || grade > 3 || classNumber < 1 || classNumber > 10 || number < 1 || number > 60) return null;
  return { studentNumber, grade, classNumber, number };
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function buildStudentAccount({ name, grade, classNumber, number, studentNumber = "" } = {}) {
  const parsed = studentNumber ? partsFromStudentNumber(studentNumber) : null;
  const identity = parsed || {
    grade: Number(grade),
    classNumber: Number(classNumber),
    number: Number(number),
    studentNumber: studentNumberFromParts(grade, classNumber, number),
  };
  return {
    studentNumber: identity.studentNumber || "",
    name: cleanName(name),
    grade: Number(identity.grade || 0),
    classNumber: Number(identity.classNumber || 0),
    number: Number(identity.number || 0),
    roles: ["STUDENT"],
    subjectRoles: [],
    departmentId: "",
    onePersonRoleId: "",
    status: "ACTIVE",
  };
}

export function validateStudentAccount(account) {
  if (!account?.name) return "이름을 입력해주세요.";
  if (!/^\d{5}$/.test(String(account.studentNumber || ""))) return "학번을 만들 수 없습니다.";
  if (!Number.isInteger(account.grade) || account.grade < 1 || account.grade > 3) return "학년을 확인해주세요.";
  if (!Number.isInteger(account.classNumber) || account.classNumber < 1 || account.classNumber > 10) return "반을 확인해주세요.";
  if (!Number.isInteger(account.number) || account.number < 1 || account.number > 60) return "번호를 확인해주세요.";
  const expected = studentNumberFromParts(account.grade, account.classNumber, account.number);
  if (expected !== account.studentNumber) return "학번과 학년·반·번호가 일치하지 않습니다.";
  return "";
}

function splitRosterLine(line) {
  if (/[\t,]/.test(line)) return line.split(/[\t,]/).map((item) => item.trim()).filter(Boolean);
  return line.trim().split(/\s+/).filter(Boolean);
}

function looksLikeHeader(columns) {
  const text = columns.join(" ").toLowerCase();
  return /학번|이름|번호|student|name/.test(text);
}

function rowFromColumns(columns, defaults) {
  if (!columns.length) return { account: null, error: "빈 행입니다." };

  if (columns.length >= 5 && /^\d{5}$/.test(columns[0]) && /^\d+$/.test(columns[2]) && /^\d+$/.test(columns[3]) && /^\d+$/.test(columns[4])) {
    const [studentNumber, name, grade, classNumber, number] = columns;
    const account = buildStudentAccount({ studentNumber, name, grade, classNumber, number });
    const mismatch = studentNumberFromParts(Number(grade), Number(classNumber), Number(number)) !== studentNumber
      ? "학번과 학년·반·번호가 일치하지 않습니다."
      : "";
    return { account, error: mismatch || validateStudentAccount(account) };
  }

  if (/^\d{5}$/.test(columns[0])) {
    const parsed = partsFromStudentNumber(columns[0]);
    const name = cleanName(columns.slice(1).join(" "));
    if (!parsed) return { account: null, error: "학번 형식이 올바르지 않습니다." };
    const account = buildStudentAccount({ ...parsed, name });
    return { account, error: validateStudentAccount(account) };
  }

  if (/^\d{1,2}$/.test(columns[0])) {
    const number = Number(columns[0]);
    const name = cleanName(columns.slice(1).join(" "));
    const account = buildStudentAccount({ ...defaults, number, name });
    return { account, error: validateStudentAccount(account) };
  }

  if (columns.length >= 2 && /^\d{1,2}$/.test(columns.at(-1))) {
    const number = Number(columns.at(-1));
    const name = cleanName(columns.slice(0, -1).join(" "));
    const account = buildStudentAccount({ ...defaults, number, name });
    return { account, error: validateStudentAccount(account) };
  }

  return { account: null, error: "‘번호 이름’ 또는 ‘학번 이름’ 형식으로 입력해주세요." };
}

export function parseRoster(value, { grade, classNumber } = {}) {
  const defaults = { grade: Number(grade), classNumber: Number(classNumber) };
  const rawLines = String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows = [];

  rawLines.slice(0, ACCOUNT_CREATE_LIMIT).forEach((line, index) => {
    const columns = splitRosterLine(line);
    if (index === 0 && looksLikeHeader(columns)) return;
    const parsed = rowFromColumns(columns, defaults);
    rows.push({ line: index + 1, source: line, ...parsed });
  });

  const seen = new Map();
  for (const row of rows) {
    if (!row.account || row.error) continue;
    const key = row.account.studentNumber;
    if (seen.has(key)) {
      row.error = `앞 행과 학번이 중복됩니다. (${key})`;
      const previous = seen.get(key);
      if (!previous.error) previous.error = `뒤 행과 학번이 중복됩니다. (${key})`;
    } else {
      seen.set(key, row);
    }
  }

  if (rawLines.length > ACCOUNT_CREATE_LIMIT) {
    rows.push({ line: ACCOUNT_CREATE_LIMIT + 1, source: "", account: null, error: `한 번에 최대 ${ACCOUNT_CREATE_LIMIT}명까지 추가할 수 있습니다.` });
  }

  return {
    rows,
    valid: rows.filter((row) => row.account && !row.error).map((row) => row.account),
    errors: rows.filter((row) => row.error),
  };
}

export async function createOneAccount(account) {
  const error = validateStudentAccount(account);
  if (error) throw new Error(error);
  return accountRequest(ACCOUNT_CREATE_ENDPOINT, {
    method: "POST",
    body: { mode: "single", account },
    networkRetries: 0,
  });
}

export async function createRosterAccounts(accounts) {
  if (!Array.isArray(accounts) || !accounts.length) throw new Error("추가할 학생이 없습니다.");
  if (accounts.length > ACCOUNT_CREATE_LIMIT) throw new Error(`한 번에 최대 ${ACCOUNT_CREATE_LIMIT}명까지 추가할 수 있습니다.`);
  return accountRequest(ACCOUNT_CREATE_ENDPOINT, {
    method: "POST",
    body: { mode: "bulk", accounts },
    networkRetries: 0,
  });
}
