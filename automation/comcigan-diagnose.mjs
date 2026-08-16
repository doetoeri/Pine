import Comcigan from "parse-comcigan";

const schools = await Comcigan.search("고촌고등학교");
const school = schools.find((item) => String(item.name || "") === "고촌고등학교") ?? schools[0];
if (!school) throw new Error("고촌고등학교를 찾지 못했습니다.");
const client = new Comcigan(Number(school.code ?? school.schoolCode));
const raw = await client.timetable({ grade: 1, classNum: 8 });
console.log("COMCIGAN_DIAGNOSTIC_START");
console.log(JSON.stringify({ school, raw }, null, 2).slice(0, 30000));
console.log("COMCIGAN_DIAGNOSTIC_END");
