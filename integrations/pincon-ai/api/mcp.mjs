import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { enforceAuth } from "../lib/auth.mjs";
import { currentAuth, runWithAuth } from "../lib/auth-context.mjs";
import { OAUTH_SCOPE } from "../lib/oauth-config.mjs";
import {
  getAssignments,
  getMeal,
  getNotices,
  getSchoolEvents,
  getTimetable,
  getToday,
  getUpcoming,
} from "../lib/pincon-data.mjs";

const requestedClassKey = z.string().regex(/^([1-3])-(10|[1-9])$/, "Use classKey like 1-8.").optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").optional();
const securitySchemes = [{ type: "oauth2", scopes: [OAUTH_SCOPE] }];
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
};

function toolMeta() {
  return {
    securitySchemes,
    annotations,
    _meta: { securitySchemes },
  };
}

function result(data) {
  return {
    content: [{
      type: "text",
      text: JSON.stringify(data, null, 2),
    }],
  };
}

function classKeyFor(input = {}) {
  const auth = currentAuth();
  const supplied = input.classKey || null;

  if (auth?.type === "user") {
    if (!auth.classKey) throw new Error("Your PinCon connection is not linked to a class.");
    if (supplied && supplied !== auth.classKey) {
      throw new Error("This PinCon connection can only read the class selected during login.");
    }
    return auth.classKey;
  }

  if (!supplied) throw new Error("classKey is required for service-key requests.");
  return supplied;
}

function withClass(input = {}) {
  return { ...input, classKey: classKeyFor(input) };
}

function buildServer() {
  const server = new McpServer({
    name: "pincon",
    version: "0.2.0",
  });

  server.registerTool("get_today", {
    title: "Get today's school brief",
    description: "Get today's PinCon timetable, meal, assignments, notices, and events for the connected class.",
    inputSchema: z.object({ classKey: requestedClassKey, date }),
    ...toolMeta(),
  }, async (input) => result(await getToday(withClass(input))));

  server.registerTool("get_timetable", {
    title: "Get timetable",
    description: "Get the PinCon timetable for the connected class on a date.",
    inputSchema: z.object({ classKey: requestedClassKey, date }),
    ...toolMeta(),
  }, async (input) => result(await getTimetable(withClass(input))));

  server.registerTool("get_meal", {
    title: "Get school meal",
    description: "Get the school meal stored in PinCon for a date.",
    inputSchema: z.object({ date }),
    ...toolMeta(),
  }, async (input) => result(await getMeal(input)));

  server.registerTool("get_assignments", {
    title: "Get assignments and assessments",
    description: "Get assignments and assessments for the connected class within a date range.",
    inputSchema: z.object({
      classKey: requestedClassKey,
      startDate: date,
      endDate: date,
    }),
    ...toolMeta(),
  }, async (input) => result(await getAssignments(withClass(input))));

  server.registerTool("get_notices", {
    title: "Get class notices",
    description: "Get recent visible PinCon notices for the connected class.",
    inputSchema: z.object({
      classKey: requestedClassKey,
      limit: z.number().int().min(1).max(100).optional(),
    }),
    ...toolMeta(),
  }, async (input) => result(await getNotices(withClass(input))));

  server.registerTool("get_school_events", {
    title: "Get school events",
    description: "Get class events and grade-relevant academic schedules in a date range.",
    inputSchema: z.object({
      classKey: requestedClassKey,
      startDate: date,
      endDate: date,
    }),
    ...toolMeta(),
  }, async (input) => result(await getSchoolEvents(withClass(input))));

  server.registerTool("get_upcoming", {
    title: "Get upcoming school work",
    description: "Get upcoming assignments and events for the connected class for the next several days.",
    inputSchema: z.object({
      classKey: requestedClassKey,
      date,
      days: z.number().int().min(1).max(31).optional(),
    }),
    ...toolMeta(),
  }, async (input) => result(await getUpcoming(withClass(input))));

  return server;
}

const mcpHandler = createMcpHandler(buildServer, { responseMode: "json" });
const nodeHandler = toNodeHandler(mcpHandler);

export default async function pinconMcp(req, res) {
  const principal = await enforceAuth(req, res);
  if (!principal) return;
  return runWithAuth(principal, () => nodeHandler(req, res));
}
