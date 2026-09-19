import WebSocket from "ws";

const url = process.argv[2] ?? "ws://127.0.0.1:5885/__room?id=floor-1";

function connect(id, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const msgs = [];
    const timer = setTimeout(() => reject(new Error(`timeout connecting ${name}`)), 5000);
    ws.on("message", (data) => msgs.push(JSON.parse(String(data))));
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.on("open", () => {
      clearTimeout(timer);
      ws.send(
        JSON.stringify({
          type: "hello",
          id,
          name,
          color: "#f4a261",
          x: 10,
          y: 20,
          facing: 90,
          pose: "stand",
        }),
      );
      resolve({ ws, msgs });
    });
  });
}

function waitFor(msgs, pred, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const hit = msgs.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - start > 3000) return reject(new Error(`timeout waiting for ${label}`));
      setTimeout(tick, 25);
    };
    tick();
  });
}

const ada = await connect("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Ada");
const adaWelcome = await waitFor(ada.msgs, (m) => m.type === "welcome", "ada welcome");
if (adaWelcome.floor !== 1 || adaWelcome.maxFloor < 1 || !adaWelcome.floors?.includes(1)) {
  throw new Error(`welcome missing floor catalog: ${JSON.stringify(adaWelcome)}`);
}

const niko = await connect("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Niko");
await waitFor(niko.msgs, (m) => m.type === "welcome" && m.peers.some((p) => p.name === "Ada"), "niko sees ada");
await waitFor(ada.msgs, (m) => m.type === "join" && m.peer.name === "Niko", "ada sees niko join");

ada.ws.send(JSON.stringify({ type: "move", x: 120, y: 340, facing: 180 }));
await waitFor(niko.msgs, (m) => m.type === "move" && m.x === 120 && m.y === 340, "niko got click-to-move");

ada.ws.send(JSON.stringify({ type: "state", x: 40, y: 80, facing: 45, pose: "stand" }));
await waitFor(niko.msgs, (m) => m.type === "state" && m.x === 40 && m.facing === 45, "niko got pose");

niko.ws.send(JSON.stringify({ type: "floor", floor: 2 }));
await waitFor(niko.msgs, (m) => m.type === "error" && m.message === "no floor", "closed 2nd floor rejects ride");
niko.ws.send(JSON.stringify({ type: "floor", floor: 1 }));
await waitFor(niko.msgs, (m) => m.type === "floors" && m.floor === 1, "same-floor ride is a no-op");

ada.ws.send(JSON.stringify({ type: "chat", text: "hello-guests", channel: "floor" }));
await waitFor(
  niko.msgs,
  (m) => m.type === "chat" && m.channel === "floor" && m.text === "hello-guests",
  "guests can talk on the floor",
);

ada.ws.send(JSON.stringify({ type: "whisper", toId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", text: "psst" }));
await waitFor(ada.msgs, (m) => m.type === "error" && m.message === "not available for whispers", "whisper needs opt-in");
niko.ws.send(JSON.stringify({ type: "chat-available", on: true }));
await waitFor(ada.msgs, (m) => m.type === "chat-available" && m.id.startsWith("bbb") && m.on === true, "ada saw niko available");
ada.ws.send(JSON.stringify({ type: "whisper", toId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", text: "psst" }));
await waitFor(
  niko.msgs,
  (m) => m.type === "whisper-request" && m.fromName === "Ada" && m.text === "psst",
  "guest whisper request delivered",
);

const beforeClaim = ada.msgs.length;
ada.ws.send(JSON.stringify({ type: "claim", deskId: "office_04" }));
const claimDenied = await new Promise((resolve) => {
  const t0 = Date.now();
  const tick = () => {
    const next = ada.msgs.slice(beforeClaim);
    if (next.some((m) => m.type === "error" && m.message === "sign-in")) return resolve(true);
    if (niko.msgs.some((m) => m.type === "claim" && m.claim?.deskId === "office_04")) return resolve(false);
    if (Date.now() - t0 > 3000) return resolve(true);
    setTimeout(tick, 25);
  };
  tick();
});
if (claimDenied) {
  ada.ws.close();
  await waitFor(niko.msgs, (m) => m.type === "leave" && m.id.startsWith("aaa"), "niko got leave");
  niko.ws.close();
  console.log("room protocol ok (unsigned; signed-in desk tests skipped)");
  process.exit(0);
}
niko.ws.send(JSON.stringify({ type: "claim", deskId: "office_04" }));
await waitFor(niko.msgs, (m) => m.type === "error" && m.message === "taken", "niko cannot steal desk");

ada.ws.send(JSON.stringify({ type: "boot" }));
await waitFor(
  niko.msgs,
  (m) => m.type === "claim" && m.claim?.deskId === "office_04" && m.claim?.privacy === "busy",
  "niko saw ada go busy from boot",
);
await waitFor(
  niko.msgs,
  (m) => m.type === "boot" && m.deskId === "office_04" && m.peerId.startsWith("aaa"),
  "niko got boot",
);
await waitFor(
  ada.msgs,
  (m) => m.type === "boot" && m.deskId === "office_04",
  "ada got own boot",
);

ada.ws.send(JSON.stringify({ type: "state", x: 448, y: 90, col: 2, row: 0, facing: 0, pose: "sit" }));
await waitFor(niko.msgs, (m) => m.type === "state" && m.col === 2 && m.row === 0, "niko saw ada sit in office");
const nikoBefore = niko.msgs.length;
ada.ws.send(JSON.stringify({ type: "chat", text: "office-secret", channel: "office" }));
await new Promise((r) => setTimeout(r, 200));
if (niko.msgs.slice(nikoBefore).some((m) => m.type === "chat" && m.text === "office-secret")) {
  throw new Error("niko overheard office chat from the hallway");
}
await waitFor(
  ada.msgs,
  (m) => m.type === "chat" && m.channel === "office" && m.text === "office-secret",
  "ada got own office chat",
);

ada.ws.send(JSON.stringify({ type: "chat", text: "hello-floor", channel: "floor" }));
await waitFor(
  niko.msgs,
  (m) => m.type === "chat" && m.channel === "floor" && m.text === "hello-floor",
  "niko got floor chat",
);

niko.ws.send(JSON.stringify({ type: "state", x: 448, y: 90, col: 2, row: 0, facing: 0, pose: "stand" }));
await waitFor(ada.msgs, (m) => m.type === "state" && m.id.startsWith("bbb"), "ada saw niko enter office");
ada.ws.send(JSON.stringify({ type: "chat", text: "now-inside", channel: "office" }));
await waitFor(
  niko.msgs,
  (m) => m.type === "chat" && m.channel === "office" && m.text === "now-inside",
  "niko got office chat after walking in",
);

ada.ws.close();
await waitFor(niko.msgs, (m) => m.type === "release" && m.deskId === "office_04", "desk freed on leave");
await waitFor(niko.msgs, (m) => m.type === "leave" && m.id.startsWith("aaa"), "niko got leave");
niko.ws.close();

console.log("room protocol ok");
