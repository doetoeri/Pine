export function draftFromText(text, year = new Date().getFullYear()) {
  const lines = String(text || "").split(/\n/).map(s=>s.trim()).filter(Boolean);
  const raw = lines.join("\n").slice(0,8000);
  const field = (label) => lines.find(s=>new RegExp(`^(${label})\\s*[:：]`).test(s))?.replace(/^[^:：]+[:：]\s*/, "") || "";
  const date = (value) => {
    const match = String(value).match(/(?:(20\d{2})[.년\/-]\s*)?(\d{1,2})[.월\/-]\s*(\d{1,2})(?:일)?/);
    if (!match) return "";
    const y=+(match[1] || year), m=+match[2], d=+match[3];
    if (m < 1 || m > 12 || d < 1 || d > 31) return "";
    const iso=`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    return new Date(`${iso}T00:00:00Z`).toISOString().slice(0,10)===iso ? iso : "";
  };
  return { status:"draft", published:false, title:(field("제목") || lines[0] || "사진 공지 초안").slice(0,100), subject:field("과목"), date:date(field("날짜|일시")), dueDate:date(field("제출일|마감")), range:field("범위"), materials:field("준비물"), location:field("장소"), body:raw.slice(0,1800), priority:"normal", reviewRequired:true };
}
