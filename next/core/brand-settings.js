export const DEFAULT_BRAND_TAGLINE = "";
export const BRAND_TAGLINE_MAX_LENGTH = 24;

const LEGACY_PRODUCT_TAGLINES = new Set([
  "alpha",
  "next",
  "next beta",
  "safe rebuild",
  "beta",
  "pincon beta",
]);

function textLength(value) {
  return [...String(value || "")].length;
}

export function normalizeBrandTagline(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isLegacyProductTagline(value) {
  return LEGACY_PRODUCT_TAGLINES.has(normalizeBrandTagline(value).toLocaleLowerCase("en-US"));
}

export function validateBrandTagline(value) {
  if (globalThis.PINCON_FORCE_READONLY === true) {
    throw new Error("현재 PinCon은 읽기 전용입니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.");
  }
  const normalized = normalizeBrandTagline(value);
  if (textLength(normalized) > BRAND_TAGLINE_MAX_LENGTH) {
    throw new Error(`작은 문구는 ${BRAND_TAGLINE_MAX_LENGTH}자 이하로 입력해 주세요.`);
  }
  if (isLegacyProductTagline(normalized)) {
    throw new Error("제품 이름과 겹치는 문구 대신 학급을 설명하는 문구를 입력해 주세요.");
  }
  return normalized;
}

export function classBrandSettings(data = {}, classKey = "") {
  const rows = Array.isArray(data?.classSettings) ? data.classSettings : [];
  return rows.find((item) => item?.id === classKey)
    || rows.find((item) => item?.classKey === classKey)
    || null;
}

export function brandTaglineFor(data = {}, classKey = "") {
  const settings = classBrandSettings(data, classKey);
  if (!settings || !Object.prototype.hasOwnProperty.call(settings, "brandTagline")) {
    return DEFAULT_BRAND_TAGLINE;
  }
  const tagline = normalizeBrandTagline(settings.brandTagline);
  return isLegacyProductTagline(tagline) ? "" : tagline;
}

export function brandTaglineLength(value) {
  return textLength(normalizeBrandTagline(value));
}
