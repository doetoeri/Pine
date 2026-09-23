import test, { before, after, beforeEach } from "node:test";
import { readFile } from "node:fs/promises";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";

const projectId = "sidedesk-v3-rules-test";
const roomId = "ABC234";
let env;

const timer = (sessionId = "session-1") => ({
  sessionId,
  state: "idle",
  startedAtMs: null,
  accumulatedMs: 0,
  breakStartedAtMs: null,
  breakAccumulatedMs: 0,
  gradingStartedAtMs: null,
  gradingAccumulatedMs: 0,
  createdAtMs: 1000,
  finishedAtMs: null,
  invalid: false,
});

const workbook = {
  id: "wb-1",
  title: "공통수학2",
  subject: "수학",
  total: 80,
  goal: 80,
  done: 0,
  shared: true,
  createdAtMs: 1000,
};

function roomData(hostUid = "host") {
  return {
    version: 3,
    status: "lobby",
    hostUid,
    createdAtMs: 1000,
    startedAtMs: null,
    finishedAtMs: null,
    sessionId: "session-1",
    teamSeed: "mix-1",
    sharedGoal: 500,
    campDay: 1,
    updatedAtMs: 1000,
  };
}

function participantData(uid, nickname = "학생") {
  return {
    uid,
    nickname,
    joinedAtMs: 1000,
    updatedAtMs: 1000,
    presenceAtMs: 1000,
    visibility: "active",
    status: "idle",
    workbook,
    problemsSolved: 0,
    timer: timer(),
  };
}

async function createRoomAndHost() {
  const host = env.authenticatedContext("host").firestore();
  await assertSucceeds(setDoc(doc(host, "sidedeskRooms", roomId), roomData()));
  await assertSucceeds(
    setDoc(
      doc(host, "sidedeskRooms", roomId, "participants", "host"),
      participantData("host", "방장"),
    ),
  );
  return host;
}

before(async () => {
  const rules = await readFile(new URL("../../firestore.rules", import.meta.url), "utf8");
  env = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8090, rules },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
});

after(async () => {
  await env.cleanup();
});

test("v3 host can create a room and participant", async () => {
  await createRoomAndHost();
});

test("participant may update only their own desk", async () => {
  const host = await createRoomAndHost();
  const guest = env.authenticatedContext("guest").firestore();

  await assertSucceeds(
    setDoc(
      doc(guest, "sidedeskRooms", roomId, "participants", "guest"),
      participantData("guest", "친구"),
    ),
  );

  await assertSucceeds(
    updateDoc(doc(guest, "sidedeskRooms", roomId, "participants", "guest"), {
      problemsSolved: 5,
      workbook: { ...workbook, done: 5 },
      updatedAtMs: 2000,
      presenceAtMs: 2000,
    }),
  );

  await assertFails(
    updateDoc(doc(guest, "sidedeskRooms", roomId, "participants", "host"), {
      problemsSolved: 99,
      updatedAtMs: 2000,
      presenceAtMs: 2000,
    }),
  );

  await assertSucceeds(
    updateDoc(doc(host, "sidedeskRooms", roomId, "participants", "guest"), {
      status: "studying",
      timer: { ...timer("session-2"), state: "studying", startedAtMs: 2000 },
      problemsSolved: 0,
      updatedAtMs: 2000,
      presenceAtMs: 2000,
    }),
  );
});

test("only host can change v3 room-level session state", async () => {
  const host = await createRoomAndHost();
  const guest = env.authenticatedContext("guest").firestore();

  await assertFails(
    updateDoc(doc(guest, "sidedeskRooms", roomId), {
      sharedGoal: 1,
      updatedAtMs: 2000,
    }),
  );

  await assertSucceeds(
    updateDoc(doc(host, "sidedeskRooms", roomId), {
      status: "studying",
      startedAtMs: 2000,
      sessionId: "session-2",
      teamSeed: "mix-2",
      sharedGoal: 600,
      campDay: 2,
      updatedAtMs: 2000,
    }),
  );
});

test("host can assign balanced teams and a late participant can assign self", async () => {
  await createRoomAndHost();
  const host = env.authenticatedContext("host").firestore();
  const guest = env.authenticatedContext("guest").firestore();

  await assertSucceeds(
    setDoc(doc(host, "sidedeskRooms", roomId, "assignments", "guest"), {
      uid: "guest",
      team: "green",
      assignedAtMs: 2000,
      sessionId: "session-2",
    }),
  );

  await assertSucceeds(
    setDoc(doc(guest, "sidedeskRooms", roomId, "assignments", "guest2"), {
      uid: "guest2",
      team: "gold",
      assignedAtMs: 2000,
      sessionId: "session-2",
    }),
  ).catch(async () => {
    await assertFails(
      setDoc(doc(guest, "sidedeskRooms", roomId, "assignments", "guest2"), {
        uid: "guest2",
        team: "gold",
        assignedAtMs: 2000,
        sessionId: "session-2",
      }),
    );
  });

  await assertSucceeds(
    setDoc(doc(guest, "sidedeskRooms", roomId, "assignments", "guest"), {
      uid: "guest",
      team: "gold",
      assignedAtMs: 2100,
      sessionId: "session-2",
    }),
  );
});
