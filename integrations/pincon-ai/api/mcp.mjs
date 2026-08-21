import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { enforceAuth } from "../lib/auth.mjs";
import {
  getAssignments,
  getMeal,
  getNotices,
  getSchoolEvents,
  getTimetable,
  getToday,
  getUpcoming,
} from "../lib/pincon-data.mjs";

const classKey = z.string().regex(/^([1-3])-(10|[1-9])$/, "Use classKey like 1-8.");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").optional();

function result(data) {
  return {
    content: [{
      type: "text",
      text: JSON.stringify(data, null, 2),
    }],
  };
}

function buildServer() {
  const server = new McpServer({
    name: "pincon",
    version: "0.1.0",
  });

  server.registerTool("get_today", {
    description: "Get today's PinCon timetable, meal, assignments, notices, and events for one class.",
    inputSchema: z.object({ classKey, date }),
  }, async (input) => result(await getToday(input)));

  server.registerTool("get_timetable", {
    description: "Get the PinCon timetable for a class on a date.",
    inputSchema: z.object({ classKey, date }),
  }, async (input) => result(await getTimetable(input)));

  server.registerTool("get_meal", {
    description: "Get the school meal stored in PinCon for a date.",
    inputSchema: z.object({ date }),
  }, async (input) => result(await getMeal(input)));

  server.registerTool("get_assignments", {
    description: "Get class assignments and assessments within a date range.",
    inputSchema: z.object({
      classKey,
      startDate: date,
      endDate: date,
    }),
  }, async (input) => result(await getAssignments(input)));

  server.registerTool("get_notices", {
    description: "Get recent visible PinCon notices for a class.",
    inputSchema: z.object({
      classKey,
      limit: z.number().int().min(1).max(100).optional(),
    }),
  }, async (input) => result(await getNotices(input)));

  server.registerTool("get_school_events", {
    description: "Get class events and grade-relevant academic schedules in a date range.",
    inputSchema: z.object({
      classKey,
      startDate: date,
      endDate: date,
    }),
  }, async (input) => result(await getSchoolEvents(input)));

  server.registerTool("get_upcoming", {
    description: "Get upcoming assignments and events for the next several days.",
    inputSchema: z.object({
      classKey,
      date,
      days: z.number().int().min(1).max(31).optional(),
    }),
  }, async (input) => result(await getUpcoming(input)));

  return server;
}

const mcpHandler = createMcpHandler(buildServer, { responseMode: "json" });
const nodeHandler = toNodeHandler(mcpHandler);

export default async function pinconMcp(req, res) {
  if (!enforceAuth(req, res)) return;
  return nodeHandler(req, res);
}
