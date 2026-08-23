export const DEFAULT_BRAND_TAGLINE = "NEXT";
export const BRAND_TAGLINE_MAX_LENGTH = 24;

function textLength(value) {
  return [...String(value || "")].length;
}

export function normalizeBrandTagline(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateBrandTagline(value) {
  const normalized = normalizeBrandTagline(value);
  if (textLength(normalized) > BRAND_TAGLINE_MAX_LENGTH) {
    throw new Error(`작은 문구는 ${BRAND_TAGLINE_MAX_LENGTH}자 이하로 입력해 주세요.`);
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
  return normalizeBrandTagline(settings.brandTagline);
}

export function brandTaglineLength(value) {
  return textLength(normalizeBrandTagline(value));
}
