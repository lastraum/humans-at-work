import { Room, RoomEvent } from "livekit-client";
import type { AuthIdentity } from "@dcl/crypto/dist/types";
import { DCL_WORLD, resolveWorldLiveKit } from "./dcl/worldHandshake";
import { encodeRfc4ChatPacket, tryDecodeRfc4Chat } from "./dcl/rfc4Chat";
import type { ChatChannel } from "./protocol";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type OfficePayload = {
  type: "haw-office";
  text: string;
  deskId: string;
  name: string;
};

export function connectWorldChat(opts: {
  identity: { id: string; name: string };
  address: string;
  auth: AuthIdentity;
  worldName?: string;
  onChat: (fromId: string, name: string, text: string, channel: ChatChannel, deskId?: string) => void;
  onStatus?: (text: string) => void;
}) {
  const room = new Room();
  let connected = false;
  let reconnecting = false;
  let auth = opts.auth;
  const worldName = opts.worldName ?? DCL_WORLD;

  room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
    if (participant?.isLocal) return;
    const fromId = participant?.identity?.trim().toLowerCase() || "";
    const name = participant?.name?.trim() || fromId.slice(0, 10);
    try {
      const json = JSON.parse(decoder.decode(payload)) as OfficePayload;
      if (json.type === "haw-office" && json.text) {
        opts.onChat(fromId, json.name || name, json.text, "office", json.deskId);
        return;
      }
    } catch {
      /* not JSON */
    }
    const text = tryDecodeRfc4Chat(payload);
    if (text) {
      const office = topic?.startsWith("office:") ? topic.slice("office:".length) : undefined;
      opts.onChat(fromId, name, text, office ? "office" : "floor", office);
    }
  });
  room.on(RoomEvent.Disconnected, () => {
    connected = false;
    if (!reconnecting) opts.onStatus?.("DCL world chat offline");
  });

  const start = async () => {
    opts.onStatus?.(`signing into ${worldName}…`);
    const { url, token } = await resolveWorldLiveKit(auth, worldName);
    await room.connect(url, token);
    connected = true;
    if (opts.identity.name) void room.localParticipant.setName(opts.identity.name);
    opts.onStatus?.(`DCL world chat · ${worldName}`);
    return true;
  };

  const fail = (err: unknown) => {
    connected = false;
    opts.onStatus?.(`DCL world chat failed: ${String(err)}`);
  };

  let gate: Promise<unknown> = start().catch(fail);

  return {
    ready: () => connected && room.state === "connected",
    sendChat(text: string, channel: ChatChannel, destinations: string[], deskId?: string) {
      if (!this.ready()) return false;
      if (channel === "office") {
        if (!deskId || destinations.length === 0) return true;
        const payload: OfficePayload = {
          type: "haw-office",
          text,
          deskId,
          name: opts.identity.name,
        };
        void room.localParticipant.publishData(encoder.encode(JSON.stringify(payload)), {
          reliable: true,
          destinationIdentities: destinations,
        });
        return true;
      }
      void room.localParticipant.publishData(Uint8Array.from(encodeRfc4ChatPacket(text)), { reliable: true });
      return true;
    },
    reconnect(next: AuthIdentity, _address: string) {
      auth = next;
      reconnecting = true;
      gate = gate
        .catch(() => undefined)
        .then(() => room.disconnect())
        .then(() => {
          reconnecting = false;
          return start();
        })
        .catch((err) => {
          reconnecting = false;
          fail(err);
        });
      return gate;
    },
    disconnect() {
      void room.disconnect();
    },
  };
}
