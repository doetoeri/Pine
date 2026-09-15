export const DEMO_KEY = "pincon.seating.demo.v1";
export function demoView() {
  const roster = Array.from({ length: 34 }, (_, i) => ({ uid: `demo-${i + 1}`, number: i + 1, name: `학생 ${String(i + 1).padStart(2, "0")}` }));
  return {
    classKey: "예시 1-8", roster, updatedAtMs: 0, capabilities: { seatingPlanner: 1 }, permissions: { canEdit: true },
    classroomLayout: { general: {
      rows: 6, cols: 6, sections: [6, 6, 5], blocked: [34, 35], seats: roster.map(s => s.uid).concat(["", ""]),
      focusStudentIds: ["demo-2", "demo-6", "demo-10", "demo-14", "demo-20"],
      separationPairs: [["demo-2", "demo-3"], ["demo-6", "demo-7"], ["demo-14", "demo-15"]],
      nominations: [],
    } },
  };
}
