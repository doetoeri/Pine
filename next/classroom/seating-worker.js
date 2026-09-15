import { seatingCandidates } from "../../integrations/pincon-ai/lib/seating-planner.mjs";

self.onmessage = ({ data }) => {
  try {
    for (const result of seatingCandidates(data.general, data.ids, { seed: data.seed })) self.postMessage({ type: "progress", ...result });
  } catch (error) {
    self.postMessage({ type: "error", message: error.message || "배치를 만들지 못했습니다." });
  }
};
