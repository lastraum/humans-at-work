import * as THREE from "three";
import { createAvatar, setAvatarName, setAvatarPose } from "./createAvatars";
import { attachLocomotion, type Locomotion } from "./locomotion";
import type { Peer, Pose } from "./protocol";
import type { Avatar, FloorPlate } from "./types";

const SNAP_CANVAS = 80;

type Remote = {
  peer: Peer;
  group: THREE.Group;
  avatar: Avatar;
  walk: Locomotion;
  pendingSit: { x: number; y: number; facing: number } | null;
};

function asAvatar(peer: Peer): Avatar {
  return {
    id: peer.id,
    pose: peer.pose,
    facing: peer.facing,
    x: peer.x,
    y: peer.y,
    color: peer.color,
    col: peer.col,
    row: peer.row,
  };
}

export function attachRemoteHumans(opts: {
  plate: FloorPlate;
  root: THREE.Group;
  colliderRoots: THREE.Object3D[];
}) {
  const { plate, root, colliderRoots } = opts;
  const remotes = new Map<string, Remote>();

  const spawn = (peer: Peer) => {
    const existing = remotes.get(peer.id);
    if (existing) {
      existing.peer = peer;
      existing.walk.snap(peer);
      setAvatarName(existing.group, peer.name);
      return;
    }
    const avatar = asAvatar(peer);
    const group = createAvatar(avatar, plate, { editable: false, label: peer.name });
    root.add(group);
    remotes.set(peer.id, {
      peer,
      group,
      avatar,
      walk: attachLocomotion({ plate, object: group, avatar, colliderRoots }),
      pendingSit: null,
    });
  };

  return {
    spawn,
    remove(id: string) {
      const remote = remotes.get(id);
      if (!remote) return;
      remote.group.parent?.remove(remote.group);
      remotes.delete(id);
    },
    walkTo(id: string, x: number, y: number) {
      const remote = remotes.get(id);
      if (!remote) return;
      remote.pendingSit = null;
      if (remote.avatar.pose === "sit") setAvatarPose(remote.group, "stand");
      if (!remote.walk.setCanvasGoal(x, y)) {
        remote.walk.snap({ ...remote.walk.pose(), x, y, pose: "stand" });
      }
    },
    walkToSit(id: string, seat: { x: number; y: number; facing: number }) {
      const remote = remotes.get(id);
      if (!remote) return;
      if (remote.avatar.pose === "sit") setAvatarPose(remote.group, "stand");
      remote.pendingSit = seat;
      if (!remote.walk.setCanvasGoal(seat.x, seat.y)) {
        remote.pendingSit = null;
        setAvatarPose(remote.group, "sit");
        remote.walk.snap({ ...seat, pose: "sit" });
      }
    },
    correct(id: string, pose: Pose & { address?: string; name?: string }) {
      const remote = remotes.get(id);
      if (!remote) return;
      if (pose.address) remote.peer.address = pose.address;
      if (pose.name) {
        remote.peer.name = pose.name;
        setAvatarName(remote.group, pose.name);
      }
      const dx = pose.x - remote.avatar.x;
      const dy = pose.y - remote.avatar.y;
      const dist = Math.hypot(dx, dy);
      if (pose.pose === "sit") {
        if (remote.walk.moving() && dist >= SNAP_CANVAS) {
          remote.pendingSit = { x: pose.x, y: pose.y, facing: pose.facing };
          return;
        }
        remote.pendingSit = null;
        if (remote.avatar.pose !== "sit") setAvatarPose(remote.group, "sit");
        remote.walk.snap(pose);
        return;
      }
      if (pose.pose && pose.pose !== remote.avatar.pose) {
        setAvatarPose(remote.group, pose.pose);
      }
      if (remote.walk.moving() && dist < SNAP_CANVAS) return;
      if (!remote.walk.moving() && dist > 24 && remote.walk.setCanvasGoal(pose.x, pose.y)) return;
      remote.walk.snap(pose);
    },
    poses() {
      return [...remotes.values()].map((remote) => ({
        id: remote.avatar.id,
        name: remote.peer.name,
        address: remote.peer.address,
        x: remote.avatar.x,
        y: remote.avatar.y,
        col: remote.avatar.col,
        row: remote.avatar.row,
      }));
    },
    avatars() {
      return [...remotes.values()].map((remote) => ({
        id: remote.avatar.id,
        group: remote.group,
        col: remote.avatar.col,
        row: remote.avatar.row,
      }));
    },
    rename(id: string, name: string) {
      const remote = remotes.get(id);
      if (!remote) return;
      remote.peer.name = name;
      setAvatarName(remote.group, name);
    },
    update(dt: number) {
      for (const remote of remotes.values()) {
        remote.walk.update(dt);
        if (remote.pendingSit && !remote.walk.moving()) {
          const seat = remote.pendingSit;
          remote.pendingSit = null;
          setAvatarPose(remote.group, "sit");
          remote.walk.snap({ ...seat, pose: "sit" });
        }
      }
    },
    moving(id: string) {
      return Boolean(remotes.get(id)?.walk.moving());
    },
    count: () => remotes.size,
  };
}
