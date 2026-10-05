import type { AuthProvider } from "./authProviders";
import { LOOK_PARTS, randomLook, type AvatarLook, type LookPart } from "./avatarLook";
import { privacyLabel, type ChatChannel, type Privacy } from "./protocol";
import { timezoneLabel } from "./conferenceReserve";
import { chatSoundOn, playChatSound, playUiSound, setChatSound, setUiSound, uiSoundOn } from "./chatSounds";
import { XP_PER_MINUTE, xpRateLabel } from "./xp";

type ChatTab = ChatChannel | "whisper" | "requests";

type WhisperThread = { peerId: string; name: string; pending?: boolean; open?: boolean; last?: string };

type InboxItem = {
  kind: "whisper" | "knock";
  fromId: string;
  fromName: string;
  text: string;
};

export type MacAuth = {
  email?: string;
  providers: AuthProvider[];
  onProvider: (provider: AuthProvider) => Promise<{ ok: boolean; error?: string }>;
  onLogout: () => Promise<void>;
};

export type MacOfficeAd = {
  enabled: boolean;
  previewUrl?: string | null;
};

export type MacOfficeAdHandlers = {
  get: () => MacOfficeAd;
  setEnabled: (on: boolean) => void | Promise<void>;
  setImage: (file: File) => Promise<{ ok: boolean; error?: string; previewUrl?: string | null }>;
};

export function attachMac(opts: {
  root: HTMLElement;
  getName: () => string;
  getCompany?: () => string;
  getProfileUrl?: () => string;
  getLook?: () => AvatarLook;
  onLook?: (look: AvatarLook) => void;
  onName: (name: string) => boolean | Promise<boolean | void> | void;
  onSaveProfile?: (opts: {
    name: string;
    company: string;
    profileUrl: string;
  }) => boolean | Promise<boolean | void> | void;
  getPrivacy: () => Privacy;
  onPrivacy: (privacy: Privacy) => void;
  hasDesk: () => boolean;
  signedIn?: () => boolean;
  onChat: (text: string, channel: ChatChannel) => void;
  onWhisper?: (text: string, toId: string) => void;
  onWhisperReply?: (fromId: string, accept: boolean) => void;
  onWhisperEnd?: (peerId: string) => void;
  onInspectPerson?: (peerId: string, name: string) => void;
  onGoTo?: (deskId: string) => void;
  onChatAvailable?: (on: boolean) => void;
  onShareTz?: (on: boolean) => void;
  onKnockReply?: (fromId: string, accept: boolean) => void;
  onBlock?: (id: string, on: boolean) => void;
  onBoot?: () => void;
  auth?: MacAuth;
  officeAd?: MacOfficeAdHandlers;
}) {
  const root = opts.root;
  const closeBtn = root.querySelector(".mac-close")!;
  const icons = root.querySelectorAll<HTMLButtonElement>("[data-mac]");
  const panels = root.querySelectorAll<HTMLElement>(".mac-panel");
  const nameInput = root.querySelector<HTMLInputElement>("#mac-name")!;
  const chatLogFloor = root.querySelector<HTMLElement>("#mac-chat-log-floor")!;
  const chatLogOffice = root.querySelector<HTMLElement>("#mac-chat-log-office")!;
  const chatLogWhisper = root.querySelector<HTMLElement>("#mac-chat-log-whisper")!;
  const chatLogRequests = root.querySelector<HTMLElement>("#mac-chat-log-requests")!;
  const chatHint = root.querySelector<HTMLElement>("#mac-chat-office-hint");
  const floorHint = root.querySelector<HTMLElement>("#mac-chat-floor-hint");
  const whisperHint = root.querySelector<HTMLElement>("#mac-chat-whisper-hint");
  const chatForm = root.querySelector<HTMLFormElement>("#mac-chat-form")!;
  const chatInput = root.querySelector<HTMLInputElement>("#mac-chat-input")!;
  const availableBox = root.querySelector<HTMLInputElement>("#mac-chat-available");
  const shareTzBox = root.querySelector<HTMLInputElement>("#mac-share-tz");
  const tzReadout = root.querySelector<HTMLElement>("#mac-tz-readout");
  const whisperPeople = root.querySelector<HTMLElement>("#mac-whisper-people");
  const chatIconBadge = root.querySelector<HTMLElement>("#mac-chat-icon-badge");
  const chatIconBtn = root.querySelector<HTMLButtonElement>('[data-mac="chat"]');
  let chatTab: ChatTab = "floor";
  let chatOffice: string | null = null;
  let unreadFloor = false;
  let unreadRequests = false;
  const unreadOffices = new Set<string>();
  const unreadWhispers = new Set<string>();
  let claimed = false;
  let quiet = false;
  let whisperPeer: string | null = null;
  const officeLogs = new Map<string, HTMLElement[]>();
  const whisperLogs = new Map<string, HTMLElement[]>();
  const whisperThreads: WhisperThread[] = [];
  const inbox: InboxItem[] = [];
  const privacyHint = root.querySelector("#mac-privacy-hint")!;
  const privacyBtns = root.querySelectorAll<HTMLInputElement>("input[name='mac-privacy']");
  const alertEl = root.querySelector<HTMLElement>("#mac-alert")!;
  const alertBody = root.querySelector("#mac-alert-body")!;
  const bootBtn = root.querySelector<HTMLButtonElement>("#mac-boot");
  const helpXp = root.querySelector<HTMLElement>("#mac-help-xp");
  let knockFrom = "";
  if (helpXp) {
    helpXp.replaceChildren();
    const label = document.createElement("b");
    label.textContent = "XP. ";
    helpXp.append(
      label,
      document.createTextNode(
        `${xpRateLabel()} on the clock — ${XP_PER_MINUTE} XP a minute, including while this tab sits in the background. It shows in the top left. Taking a desk does not add more. A guest visit lasts five minutes, then the clock stops until you sign in.`,
      ),
    );
  }

  const syncSplit = () => {
    const chatting =
      !root.querySelector<HTMLElement>("#mac-chat")?.hidden && !root.classList.contains("collapsed");
    root.classList.toggle("chat-split", chatting);
    root.parentElement?.classList.toggle("chat-split", chatting);
  };

  const showPanel = (id: string) => {
    panels.forEach((panel) => {
      panel.hidden = panel.id !== id;
    });
    icons.forEach((icon) => {
      icon.classList.toggle("on", icon.dataset.mac === id.replace("mac-", ""));
    });
    syncSplit();
    if (id === "mac-chat") paintChat();
  };

  closeBtn.addEventListener("click", () => {
    root.classList.toggle("collapsed");
    syncSplit();
  });
  icons.forEach((icon) => {
    icon.addEventListener("click", () => {
      if (icon.dataset.mac === "privacy" && !opts.signedIn?.()) {
        askSignIn("Sign in to take an office.");
        return;
      }
      showPanel(`mac-${icon.dataset.mac}`);
    });
  });
  privacyBtns.forEach((btn) => {
    btn.addEventListener("change", () => {
      if (!opts.hasDesk()) return;
      opts.onPrivacy(btn.value as Privacy);
    });
  });
  const companyInput = root.querySelector<HTMLInputElement>("#mac-company");
  const profileUrlInput = root.querySelector<HTMLInputElement>("#mac-profile-url");
  nameInput.value = opts.getName();
  if (companyInput) companyInput.value = opts.getCompany?.() ?? "";
  if (profileUrlInput) profileUrlInput.value = opts.getProfileUrl?.() ?? "";
  const nameSave = root.querySelector<HTMLButtonElement>("#mac-name-save");
  const nameHint = root.querySelector<HTMLElement>("#mac-name-hint");
  const nameHintRest =
    nameHint?.textContent ?? "Name on your door. Company sits next to it on Floor. Profile link is on your card.";
  let nameHintTimer = 0;
  const flashName = (text: string, ok: boolean) => {
    if (!nameHint) return;
    nameHint.textContent = text;
    nameHint.classList.toggle("ok", ok);
    nameHint.classList.toggle("err", !ok);
    window.clearTimeout(nameHintTimer);
    nameHintTimer = window.setTimeout(() => {
      nameHint.textContent = nameHintRest;
      nameHint.classList.remove("ok", "err");
    }, 1800);
  };
  const commitProfile = () => {
    const name = nameInput.value.trim();
    if (!name) {
      flashName("Type a name first.", false);
      return;
    }
    const company = companyInput?.value.trim() ?? "";
    const profileUrl = profileUrlInput?.value.trim() ?? "";
    const save = opts.onSaveProfile
      ? opts.onSaveProfile({ name, company, profileUrl })
      : opts.onName(name);
    void Promise.resolve(save).then((ok) => {
      flashName(ok === false ? "Couldn't save." : "Saved.", ok !== false);
    });
  };
  const profileEnter = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commitProfile();
  };
  nameInput.addEventListener("keydown", profileEnter);
  companyInput?.addEventListener("keydown", profileEnter);
  profileUrlInput?.addEventListener("keydown", profileEnter);
  nameSave?.addEventListener("click", commitProfile);

  const lookRows = root.querySelector<HTMLElement>("#mac-look-rows");
  const genderButtons = Array.from(root.querySelectorAll<HTMLButtonElement>(".mac-gender button"));
  const randomLookBtn = root.querySelector<HTMLButtonElement>("#mac-look-random");
  let shownLook: AvatarLook | null = opts.getLook?.() ?? null;
  const paintLook = (look: AvatarLook) => {
    shownLook = look;
    for (const button of genderButtons) {
      const on = button.dataset.gender === look.gender;
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    }
    for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>(".mac-swatch"))) {
      const on = button.dataset.color === look[button.dataset.part as LookPart];
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    }
  };
  if (lookRows && shownLook) {
    for (const part of LOOK_PARTS) {
      const row = document.createElement("div");
      row.className = "mac-swatch-row";
      const label = document.createElement("span");
      label.textContent = part.label;
      const swatches = document.createElement("div");
      swatches.className = "mac-swatches";
      for (const color of part.colors) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mac-swatch";
        button.dataset.part = part.key;
        button.dataset.color = color;
        button.style.background = color;
        button.title = color;
        button.setAttribute("aria-label", `${part.label} ${color}`);
        button.addEventListener("click", () => {
          if (!shownLook) return;
          opts.onLook?.({ ...shownLook, [part.key]: color });
        });
        swatches.append(button);
      }
      row.append(label, swatches);
      lookRows.append(row);
    }
    paintLook(shownLook);
  }
  for (const button of genderButtons) {
    button.addEventListener("click", () => {
      const gender = button.dataset.gender === "m" ? "m" : "f";
      if (!shownLook || shownLook.gender === gender) return;
      opts.onLook?.({ ...shownLook, gender });
    });
  }
  randomLookBtn?.addEventListener("click", () => {
    if (!shownLook) return;
    opts.onLook?.(randomLook(shownLook.gender, shownLook));
  });

  const accountIn = root.querySelector<HTMLElement>("#mac-account-in");
  const accountOut = root.querySelector<HTMLElement>("#mac-account-out");
  const accountEmail = root.querySelector<HTMLElement>("#mac-account-email");
  const authHint = root.querySelector<HTMLElement>("#mac-auth-hint");
  const logoutBtn = root.querySelector<HTMLButtonElement>("#mac-logout");

  const setAuthHint = (text: string) => {
    if (authHint) authHint.textContent = text;
  };

  const askSignIn = (reason: string) => {
    root.classList.remove("collapsed");
    showPanel("mac-profile");
    setAuthHint(reason);
  };

  const paintAccount = (email?: string) => {
    const signedIn = Boolean(email);
    if (accountIn) accountIn.hidden = !signedIn;
    if (accountOut) accountOut.hidden = signedIn;
    if (accountEmail) accountEmail.textContent = email ?? "";
    if (signedIn) setAuthHint("");
  };

  const adEnabled = root.querySelector<HTMLInputElement>("#mac-ad-enabled");
  const adDrop = root.querySelector<HTMLElement>("#mac-ad-drop");
  const adFile = root.querySelector<HTMLInputElement>("#mac-ad-file");
  const adPreview = root.querySelector<HTMLImageElement>("#mac-ad-preview");
  const adLabel = root.querySelector<HTMLElement>("#mac-ad-drop-label");
  const adHint = root.querySelector<HTMLElement>("#mac-ad-hint");
  const adSave = root.querySelector<HTMLButtonElement>("#mac-ad-save");
  const adHintRest = adHint?.textContent ?? "Pick or drop an image, then Save. Images are resized to 512px on the long side.";
  let adHintTimer = 0;
  let pendingAd: File | null = null;
  let pendingPreview: string | null = null;
  const flashAd = (text: string, ok: boolean, persist = false) => {
    if (!adHint) return;
    adHint.textContent = text;
    adHint.classList.toggle("ok", ok);
    adHint.classList.toggle("err", !ok);
    window.clearTimeout(adHintTimer);
    if (persist) return;
    adHintTimer = window.setTimeout(() => {
      adHint.textContent = adHintRest;
      adHint.classList.remove("ok", "err");
    }, 2200);
  };
  const showAdPreview = (url: string | null | undefined) => {
    const next = url ?? "";
    if (adPreview) {
      if (next) {
        adPreview.src = next;
        adPreview.hidden = false;
      } else {
        adPreview.removeAttribute("src");
        adPreview.hidden = true;
      }
    }
    adDrop?.classList.toggle("has-image", Boolean(next));
    if (adLabel) adLabel.textContent = next ? "Replace image" : "Drop an image or click to choose";
  };
  const paintOfficeAd = (state?: MacOfficeAd) => {
    const next = state ?? opts.officeAd?.get() ?? { enabled: false, previewUrl: null };
    if (adEnabled) adEnabled.checked = Boolean(next.enabled);
    if (pendingPreview) {
      showAdPreview(pendingPreview);
    } else {
      showAdPreview(next.previewUrl);
    }
    if (adSave) adSave.disabled = !pendingAd;
  };
  adEnabled?.addEventListener("change", () => {
    void opts.officeAd?.setEnabled(Boolean(adEnabled.checked));
  });
  const pickAdFile = () => adFile?.click();
  adDrop?.addEventListener("click", pickAdFile);
  adDrop?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pickAdFile();
    }
  });
  adDrop?.addEventListener("dragover", (event) => {
    event.preventDefault();
    adDrop.classList.add("over");
  });
  adDrop?.addEventListener("dragleave", () => adDrop.classList.remove("over"));
  adDrop?.addEventListener("drop", (event) => {
    event.preventDefault();
    adDrop.classList.remove("over");
    const file = event.dataTransfer?.files?.[0];
    if (file) takeAdFile(file);
  });
  adFile?.addEventListener("change", () => {
    const file = adFile.files?.[0];
    adFile.value = "";
    if (file) takeAdFile(file);
  });
  const takeAdFile = (file: File) => {
    if (!opts.officeAd) return;
    if (pendingPreview?.startsWith("blob:")) URL.revokeObjectURL(pendingPreview);
    pendingAd = file;
    pendingPreview = URL.createObjectURL(file);
    showAdPreview(pendingPreview);
    if (adSave) adSave.disabled = false;
    flashAd("Click Save to upload.", true, true);
  };
  const commitAd = () => {
    if (!opts.officeAd) return;
    if (!pendingAd) {
      flashAd("Choose an image first.", false);
      return;
    }
    const file = pendingAd;
    if (adSave) adSave.disabled = true;
    flashAd("Saving…", true, true);
    void opts.officeAd.setImage(file).then((result) => {
      if (!result.ok) {
        if (adSave) adSave.disabled = !pendingAd;
        flashAd(result.error || "Couldn't save.", false);
        return;
      }
      if (pendingPreview?.startsWith("blob:")) URL.revokeObjectURL(pendingPreview);
      pendingAd = null;
      pendingPreview = null;
      paintOfficeAd({ enabled: adEnabled?.checked ?? true, previewUrl: result.previewUrl });
      flashAd("Saved to server.", true);
    });
  };
  adSave?.addEventListener("click", commitAd);
  paintOfficeAd();

  paintAccount(opts.auth?.email);
  const allowedProviders = new Set(opts.auth?.providers ?? []);
  for (const button of Array.from(accountOut?.querySelectorAll<HTMLButtonElement>("[data-provider]") ?? [])) {
    const provider = button.dataset.provider as AuthProvider | undefined;
    const shown = Boolean(provider && allowedProviders.has(provider));
    button.hidden = !shown;
    if (!shown || !provider) continue;
    button.addEventListener("click", () => {
      if (!opts.auth) return;
      button.disabled = true;
      setAuthHint("Redirecting…");
      void opts.auth.onProvider(provider).then((result) => {
        if (result.ok) return;
        button.disabled = false;
        setAuthHint(result.error || "Sign-in failed.");
      });
    });
  }
  if (opts.auth && allowedProviders.size === 0) setAuthHint("Sign-in isn't configured.");
  logoutBtn?.addEventListener("click", () => {
    logoutBtn.disabled = true;
    void opts.auth
      ?.onLogout()
      .catch(() => undefined)
      .finally(() => {
        logoutBtn.disabled = false;
      });
  });
  const paintBadges = () => {
    const n = inbox.length;
    const label = n > 9 ? "9+" : String(n);
    if (chatIconBadge) {
      chatIconBadge.hidden = n === 0;
      chatIconBadge.textContent = label;
    }
    chatIconBtn?.classList.toggle("has-badge", n > 0);
  };

  const paintInbox = () => {
    chatLogRequests.replaceChildren();
    for (const item of inbox) {
      const el = document.createElement("div");
      el.className = "mac-request-row";
      const copy = document.createElement("div");
      copy.className = "mac-request-copy";
      const who = document.createElement("b");
      who.textContent = item.fromName;
      const line = document.createElement("span");
      line.textContent =
        item.kind === "knock"
          ? " is at your door."
          : item.text
            ? ` “${item.text}”`
            : " wants to whisper.";
      copy.append(who, line);
      const btns = document.createElement("div");
      btns.className = "mac-request-btns";
      const yes = document.createElement("button");
      yes.type = "button";
      yes.textContent = item.kind === "knock" ? "Open door" : "Talk";
      yes.addEventListener("click", () => {
        if (item.kind === "knock") opts.onKnockReply?.(item.fromId, true);
        else opts.onWhisperReply?.(item.fromId, true);
        const at = inbox.indexOf(item);
        if (at >= 0) inbox.splice(at, 1);
        paintInbox();
        paintBadges();
        paintChat();
      });
      const no = document.createElement("button");
      no.type = "button";
      no.textContent = item.kind === "knock" ? "Decline" : "Ignore";
      no.addEventListener("click", () => {
        if (item.kind === "knock") opts.onKnockReply?.(item.fromId, false);
        else opts.onWhisperReply?.(item.fromId, false);
        const at = inbox.indexOf(item);
        if (at >= 0) inbox.splice(at, 1);
        paintInbox();
        paintBadges();
      });
      const block = document.createElement("button");
      block.type = "button";
      block.textContent = "Block";
      block.addEventListener("click", () => {
        if (item.kind === "knock") opts.onKnockReply?.(item.fromId, false);
        else opts.onWhisperReply?.(item.fromId, false);
        opts.onBlock?.(item.fromId, true);
        const at = inbox.indexOf(item);
        if (at >= 0) inbox.splice(at, 1);
        paintInbox();
        paintBadges();
      });
      btns.append(yes, no, block);
      el.append(copy, btns);
      chatLogRequests.appendChild(el);
    }
    paintBadges();
    paintChannels();
  };

  const closeWhisper = (peerId: string) => {
    unreadWhispers.delete(peerId);
    const selected = chatTab === "whisper" && whisperPeer === peerId;
    const idx = whisperThreads.findIndex((t) => t.peerId === peerId);
    if (idx >= 0) whisperThreads.splice(idx, 1);
    whisperLogs.delete(peerId);
    for (let i = inbox.length - 1; i >= 0; i--) {
      if (inbox[i].kind === "whisper" && inbox[i].fromId === peerId) inbox.splice(i, 1);
    }
    if (selected) {
      chatTab = "requests";
      whisperPeer = null;
      chatLogWhisper.replaceChildren();
    } else if (whisperPeer === peerId) {
      whisperPeer = null;
    }
    paintInbox();
    paintChat();
  };

  const addChannel = (
    title: string,
    preview: string,
    on: boolean,
    click: () => void,
    extra?: { badge?: number; unread?: boolean; onEnd?: () => void },
  ) => {
    if (!whisperPeople) return;
    const row = document.createElement("div");
    row.className = "mac-whisper-thread" + (on ? " on" : "");
    const who = document.createElement("button");
    who.type = "button";
    who.className = "mac-whisper-thread-who";
    const name = document.createElement("b");
    name.textContent = title;
    if (extra?.badge) {
      const badge = document.createElement("span");
      badge.className = "mac-tab-badge";
      badge.textContent = extra.badge > 9 ? "9+" : String(extra.badge);
      name.append(" ", badge);
    }
    if (extra?.unread) {
      const dot = document.createElement("span");
      dot.className = "mac-unread";
      dot.title = "New";
      name.append(dot);
    }
    const sub = document.createElement("span");
    sub.textContent = preview;
    who.append(name, sub);
    who.addEventListener("click", click);
    row.appendChild(who);
    if (extra?.onEnd) {
      const end = document.createElement("button");
      end.type = "button";
      end.className = "mac-whisper-end";
      end.textContent = "End";
      end.addEventListener("click", (event) => {
        event.stopPropagation();
        extra.onEnd?.();
      });
      row.appendChild(end);
    }
    whisperPeople.appendChild(row);
  };

  const paintChannels = () => {
    if (!whisperPeople) return;
    whisperPeople.replaceChildren();
    const inOffice = Boolean(chatOffice);
    const inConference = Boolean(chatOffice?.startsWith("conf"));
    addChannel("Floor", "everyone here", chatTab === "floor", () => {
      unreadFloor = false;
      chatTab = "floor";
      paintChat();
      chatInput.focus();
    }, { unread: unreadFloor });
    if (inOffice) {
      addChannel(inConference ? "Conference" : "Office", "this room", chatTab === "office", () => {
        if (chatOffice) unreadOffices.delete(chatOffice);
        chatTab = "office";
        paintChat();
        chatInput.focus();
      }, { unread: Boolean(chatOffice && unreadOffices.has(chatOffice)) });
    }
    addChannel(
      "Requests",
      inbox.length ? `${inbox.length} waiting` : "none",
      chatTab === "requests",
      () => {
        unreadRequests = false;
        chatTab = "requests";
        paintChat();
      },
      { badge: inbox.length, unread: unreadRequests },
    );
    for (const thread of whisperThreads) {
      addChannel(
        thread.name,
        thread.pending ? "waiting…" : thread.last || (thread.open ? "connected" : ""),
        chatTab === "whisper" && whisperPeer === thread.peerId,
        () => {
          unreadWhispers.delete(thread.peerId);
          whisperPeer = thread.peerId;
          chatTab = "whisper";
          paintChat();
          chatInput.focus();
        },
        {
          unread: unreadWhispers.has(thread.peerId),
          onEnd: () => {
            opts.onWhisperEnd?.(thread.peerId);
            closeWhisper(thread.peerId);
          },
        },
      );
    }
  };

  const paintChat = () => {
    const inOffice = Boolean(chatOffice);
    if (chatTab === "office" && !inOffice) chatTab = "floor";
    if (chatTab === "whisper" && !whisperPeer) chatTab = "requests";
    if (availableBox) availableBox.disabled = false;
    const thread = whisperThreads.find((t) => t.peerId === whisperPeer);
    const whisperOpen = Boolean(thread?.open);
    chatLogFloor.hidden = chatTab !== "floor" || quiet;
    chatLogOffice.hidden = chatTab !== "office" || !inOffice || quiet;
    chatLogWhisper.hidden = chatTab !== "whisper" || quiet;
    chatLogRequests.hidden = chatTab !== "requests";
    syncSplit();
    if (floorHint) {
      floorHint.hidden = !quiet;
      floorHint.textContent = "Quiet — the library is silent.";
    }
    if (chatHint) chatHint.hidden = quiet || chatTab !== "office" || inOffice;
    if (whisperHint) {
      const show =
        !quiet &&
        chatTab === "whisper" &&
        (!whisperPeer || Boolean(thread?.pending) || !whisperOpen);
      whisperHint.hidden = !show;
      whisperHint.textContent = thread?.pending
        ? `Waiting for ${thread.name} to accept.`
        : whisperPeer && !whisperOpen
          ? "Send a line — that’s the request."
          : "Click someone on the floor, or wait for a request.";
    }
    const canType =
      !quiet &&
      ((chatTab === "office" && inOffice) ||
        chatTab === "floor" ||
        (chatTab === "whisper" && Boolean(whisperPeer) && !thread?.pending));
    chatInput.disabled = !canType || chatTab === "requests";
    chatInput.placeholder = quiet
      ? "Quiet — library"
      : chatTab === "office"
        ? chatOffice?.startsWith("conf")
          ? "Message this conference…"
          : "Message this office…"
        : chatTab === "whisper"
          ? thread?.pending
            ? "Waiting…"
            : whisperOpen
              ? `Whisper ${thread?.name ?? ""}…`
              : whisperPeer
                ? "Send a whisper request…"
                : "Pick someone to whisper…"
          : chatTab === "requests"
            ? "Requests live here — no popups."
            : "Message the floor…";
    if (chatTab === "office" && inOffice) {
      chatLogOffice.replaceChildren(...(officeLogs.get(chatOffice!) ?? []));
      chatLogOffice.scrollTop = chatLogOffice.scrollHeight;
    }
    if (chatTab === "whisper" && whisperPeer) {
      chatLogWhisper.replaceChildren(...(whisperLogs.get(whisperPeer) ?? []));
      chatLogWhisper.scrollTop = chatLogWhisper.scrollHeight;
    }
    paintChannels();
  };

  const chatTime = () =>
    new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const addBubble = (row: HTMLElement, text: string) => {
    const bubble = document.createElement("div");
    bubble.className = "mac-chat-bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
  };

  const sameSpeaker = (el: HTMLElement, name: string, self: boolean, fromId?: string) => {
    if (el.classList.contains("self") !== self) return false;
    if (fromId && el.dataset.peerId) return el.dataset.peerId === fromId;
    return el.dataset.name === name;
  };

  const rowEl = (name: string, text: string, self: boolean, fromId?: string) => {
    const row = document.createElement("div");
    row.className = "mac-chat-row" + (self ? " self" : "");
    row.dataset.name = name;
    if (fromId) row.dataset.peerId = fromId;
    const head = document.createElement("div");
    head.className = "mac-chat-head";
    const who = document.createElement("b");
    who.textContent = name;
    const time = document.createElement("span");
    time.className = "mac-chat-time";
    time.textContent = chatTime();
    head.append(who, time);
    row.appendChild(head);
    addBubble(row, text);
    return row;
  };

  const pushMsg = (list: HTMLElement[], name: string, text: string, self: boolean, fromId?: string) => {
    const last = list[list.length - 1];
    if (last && sameSpeaker(last, name, self, fromId)) {
      addBubble(last, text);
      return last;
    }
    const row = rowEl(name, text, self, fromId);
    list.push(row);
    while (list.length > 40) list.shift();
    return row;
  };

  availableBox?.addEventListener("change", () => {
    opts.onChatAvailable?.(Boolean(availableBox.checked));
  });
  const paintTz = () => {
    if (tzReadout) tzReadout.textContent = timezoneLabel();
  };
  if (shareTzBox) {
    shareTzBox.checked = false;
    try {
      shareTzBox.checked = localStorage.getItem("haw-share-tz") === "1";
    } catch {
      /* ignore */
    }
    paintTz();
    shareTzBox.addEventListener("change", () => {
      try {
        localStorage.setItem("haw-share-tz", shareTzBox.checked ? "1" : "0");
      } catch {
        /* ignore */
      }
      paintTz();
      opts.onShareTz?.(shareTzBox.checked);
    });
  }
  for (const kind of ["floor", "office", "whisper"] as const) {
    const box = root.querySelector<HTMLInputElement>(`#mac-sound-${kind}`);
    if (!box) continue;
    box.checked = chatSoundOn(kind);
    box.addEventListener("change", () => {
      const on = box.checked;
      setChatSound(kind, on);
      if (on) playChatSound(kind);
    });
  }
  const uiBox = root.querySelector<HTMLInputElement>("#mac-sound-ui");
  if (uiBox) {
    uiBox.checked = uiSoundOn();
    uiBox.addEventListener("change", () => {
      const on = uiBox.checked;
      setUiSound(on);
      if (on) playUiSound("sit");
    });
  }
  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    if (quiet) return;
    if (chatTab === "requests") return;
    if (chatTab === "office" && !chatOffice) return;
    if (chatTab === "whisper") {
      if (!whisperPeer) return;
      const thread = whisperThreads.find((t) => t.peerId === whisperPeer);
      if (thread?.pending) return;
      if (!thread) {
        whisperThreads.push({ peerId: whisperPeer, name: whisperPeer.slice(0, 8), pending: true });
      } else if (!thread.open) {
        thread.pending = true;
      }
      opts.onWhisper?.(text, whisperPeer);
      chatInput.value = "";
      paintChat();
      return;
    }
    if (chatTab === "floor" || chatTab === "office") {
      opts.onChat(text, chatTab);
      chatInput.value = "";
    }
  });

  root.querySelector("#mac-alert-ok")?.addEventListener("click", () => {
    const fromId = knockFrom;
    alertEl.hidden = true;
    knockFrom = "";
    if (fromId) opts.onKnockReply?.(fromId, true);
  });
  root.querySelector("#mac-alert-no")?.addEventListener("click", () => {
    const fromId = knockFrom;
    alertEl.hidden = true;
    knockFrom = "";
    if (fromId) opts.onKnockReply?.(fromId, false);
  });
  root.querySelector("#mac-alert-block")?.addEventListener("click", () => {
    const fromId = knockFrom;
    alertEl.hidden = true;
    knockFrom = "";
    if (fromId) {
      opts.onKnockReply?.(fromId, false);
      opts.onBlock?.(fromId, true);
    }
  });
  bootBtn?.addEventListener("click", () => {
    if (!opts.hasDesk()) return;
    opts.onBoot?.();
  });

  privacyBtns.forEach((btn) => {
    btn.disabled = true;
  });
  showPanel("mac-chat");
  paintChat();

  const seeingChat = (tab: ChatTab, id?: string) => {
    const panel = root.querySelector<HTMLElement>("#mac-chat");
    const open = Boolean(panel && !panel.hidden && !root.classList.contains("collapsed"));
    if (!open || chatTab !== tab) return false;
    if (tab === "office") return chatOffice === id;
    if (tab === "whisper") return whisperPeer === id;
    return true;
  };

  return {
    setPrivacy(privacy: Privacy) {
      privacyBtns.forEach((btn) => {
        btn.checked = btn.value === privacy;
      });
      if (privacy !== "focus" && privacy !== "private") return;
      alertEl.hidden = true;
      knockFrom = "";
      for (let i = inbox.length - 1; i >= 0; i--) {
        if (inbox[i].kind === "knock") inbox.splice(i, 1);
      }
      paintInbox();
    },
    setHasDesk(on: boolean) {
      claimed = on;
      root.hidden = false;
      privacyHint.textContent = on
        ? "Busy, Focus, and Private ignore new whispers. Private keeps whoever is already inside and blocks everyone else."
        : "Claim an office to set this.";
      privacyBtns.forEach((btn) => {
        btn.disabled = !on;
      });
      if (bootBtn) bootBtn.disabled = !on;
      if (!on) {
        alertEl.hidden = true;
        knockFrom = "";
        for (let i = inbox.length - 1; i >= 0; i--) {
          if (inbox[i].kind === "knock") inbox.splice(i, 1);
        }
        paintInbox();
      }
      paintChat();
    },
    setName(name: string) {
      if (document.activeElement !== nameInput) nameInput.value = name;
    },
    setCompany(company: string) {
      if (companyInput && document.activeElement !== companyInput) companyInput.value = company;
    },
    setProfileUrl(url: string) {
      if (profileUrlInput && document.activeElement !== profileUrlInput) profileUrlInput.value = url;
    },
    setLook(look: AvatarLook) {
      paintLook(look);
    },
    setAccount(email?: string) {
      paintAccount(email);
      paintChat();
    },
    setOfficeAd(state: MacOfficeAd) {
      paintOfficeAd(state);
    },
    askSignIn,
    showKnock(fromName: string, fromId: string) {
      if (opts.getPrivacy() === "focus" || opts.getPrivacy() === "private") return;
      if (inbox.some((item) => item.kind === "knock" && item.fromId === fromId)) return;
      inbox.push({ kind: "knock", fromId, fromName, text: `${fromName} is at your door.` });
      paintInbox();
      paintChat();
    },
    hideKnock() {
      for (let i = inbox.length - 1; i >= 0; i--) {
        if (inbox[i].kind === "knock") inbox.splice(i, 1);
      }
      alertEl.hidden = true;
      knockFrom = "";
      paintInbox();
    },
    setChatAvailable(on: boolean) {
      if (availableBox) availableBox.checked = on;
    },
    composeWhisper(peerId: string, name: string, pending = false) {
      let thread = whisperThreads.find((t) => t.peerId === peerId);
      if (!thread) {
        thread = { peerId, name, pending };
        whisperThreads.push(thread);
      } else {
        thread.name = name;
        if (pending && !thread.open) thread.pending = true;
      }
      whisperPeer = peerId;
      chatTab = "whisper";
      root.classList.remove("collapsed");
      showPanel("mac-chat");
      paintChat();
      chatInput.focus();
    },
    openWhisper(peerId: string, name: string) {
      let thread = whisperThreads.find((t) => t.peerId === peerId);
      if (!thread) {
        thread = { peerId, name };
        whisperThreads.push(thread);
      }
      thread.name = name;
      thread.pending = false;
      thread.open = true;
      for (let i = inbox.length - 1; i >= 0; i--) {
        if (inbox[i].kind === "whisper" && inbox[i].fromId === peerId) inbox.splice(i, 1);
      }
      whisperPeer = peerId;
      chatTab = "whisper";
      paintInbox();
      paintChat();
    },
    failWhisper(peerId?: string) {
      const id = peerId ?? whisperPeer;
      const thread = whisperThreads.find((t) => t.peerId === id);
      if (thread) thread.pending = false;
      paintChat();
    },
    addWhisper(name: string, text: string, peerId: string, self = false, fromId?: string) {
      const thread = whisperThreads.find((t) => t.peerId === peerId);
      if (thread) thread.last = text;
      if (!self && !seeingChat("whisper", peerId)) unreadWhispers.add(peerId);
      const list = whisperLogs.get(peerId) ?? [];
      const prev = list[list.length - 1];
      const row = pushMsg(list, name, text, self, fromId ?? (self ? undefined : peerId));
      whisperLogs.set(peerId, list);
      if (chatTab === "whisper" && whisperPeer === peerId) {
        if (row !== prev) chatLogWhisper.appendChild(row);
        chatLogWhisper.scrollTop = chatLogWhisper.scrollHeight;
      }
      paintChannels();
    },
    addWhisperRequest(fromId: string, fromName: string, text?: string) {
      if (!seeingChat("requests")) unreadRequests = true;
      const existing = inbox.find((item) => item.kind === "whisper" && item.fromId === fromId);
      if (existing) existing.text = text ?? "";
      else inbox.push({ kind: "whisper", fromId, fromName, text: text ?? "" });
      paintInbox();
      paintChat();
    },
    endWhisper(peerId: string) {
      closeWhisper(peerId);
    },
    endAllWhispers() {
      whisperThreads.length = 0;
      whisperLogs.clear();
      whisperPeer = null;
      for (let i = inbox.length - 1; i >= 0; i--) {
        if (inbox[i].kind === "whisper") inbox.splice(i, 1);
      }
      paintInbox();
      paintChat();
    },
    setChatRoom(deskId: string | null) {
      if (chatOffice === deskId) return;
      chatOffice = deskId;
      paintChat();
    },
    setQuiet(on: boolean) {
      if (quiet === on) return;
      quiet = on;
      paintChat();
    },
    setFloor(
      rows: {
        peerId: string;
        name: string;
        deskId?: string;
        desk: string;
        privacy: string;
        time: string;
        company?: string;
        self?: boolean;
        blocked?: boolean;
        chatAvailable?: boolean;
      }[],
    ) {
      const list = root.querySelector("#mac-floor-list");
      const hint = root.querySelector("#mac-floor-hint");
      if (!list) return;
      list.replaceChildren();
      if (!rows.length) {
        if (hint) hint.textContent = "Nobody is checked into an office.";
        return;
      }
      if (hint) {
        hint.textContent =
          "People checked into an office. Go to walks you there. Whisper if they're available. Block hides their floor chat, knocks, and keeps them out of your office.";
      }
      for (const row of rows) {
        const el = document.createElement("div");
        el.className = "mac-floor-row" + (row.self ? " self" : "") + (row.blocked ? " blocked" : "");
        const mode = privacyLabel(row.privacy);
        el.innerHTML =
          `<div class="mac-floor-main"><div class="mac-floor-who"><b></b><span></span></div><div class="mac-floor-time"></div></div><div class="mac-floor-actions"></div>`;
        const label = row.company ? `${row.name} · ${row.company}` : row.name;
        el.querySelector("b")!.textContent = label;
        el.querySelector("span")!.textContent = `${row.desk} · ${mode}`;
        el.querySelector(".mac-floor-time")!.textContent = row.time;
        const actions = el.querySelector(".mac-floor-actions")!;
        if (row.deskId) {
          const go = document.createElement("button");
          go.type = "button";
          go.className = "mac-floor-goto";
          go.textContent = "Go to";
          go.addEventListener("click", (event) => {
            event.stopPropagation();
            opts.onGoTo?.(row.deskId!);
          });
          actions.appendChild(go);
        }
        if (!row.self) {
          const whisper = document.createElement("button");
          whisper.type = "button";
          whisper.className = "mac-floor-whisper";
          whisper.textContent = "Whisper";
          whisper.title = "Open whisper card";
          const inspect = (event: Event) => {
            event.stopPropagation();
            opts.onInspectPerson?.(row.peerId, row.name);
          };
          whisper.addEventListener("click", inspect);
          const who = el.querySelector<HTMLElement>(".mac-floor-who");
          if (who) {
            who.style.cursor = "pointer";
            who.title = "View";
            who.addEventListener("click", inspect);
          }
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "mac-floor-block";
          btn.textContent = row.blocked ? "Unblock" : "Block";
          btn.addEventListener("click", (event) => {
            event.stopPropagation();
            opts.onBlock?.(row.peerId, !row.blocked);
          });
          actions.appendChild(whisper);
          actions.appendChild(btn);
        }
        list.appendChild(el);
      }
    },
    renameSpeaker(peerId: string, name: string) {
      if (!peerId || !name) return;
      const retitle = (row: HTMLElement) => {
        if (row.dataset.peerId !== peerId) return;
        row.dataset.name = name;
        const who = row.querySelector(".mac-chat-head b");
        if (who) who.textContent = name;
      };
      for (const row of Array.from(chatLogFloor.children) as HTMLElement[]) retitle(row);
      for (const list of officeLogs.values()) for (const row of list) retitle(row);
      for (const list of whisperLogs.values()) for (const row of list) retitle(row);
      for (const thread of whisperThreads) {
        if (thread.peerId === peerId) thread.name = name;
      }
      for (const item of inbox) {
        if (item.fromId === peerId) item.fromName = name;
      }
      paintInbox();
      paintChat();
    },
    addChat(name: string, text: string, self = false, channel: ChatChannel = "floor", deskId?: string, fromId?: string) {
      if (quiet) return;
      if (channel === "office") {
        const id = deskId ?? chatOffice;
        if (!id) return;
        const list = officeLogs.get(id) ?? [];
        const prev = list[list.length - 1];
        const row = pushMsg(list, name, text, self, fromId);
        officeLogs.set(id, list);
        if (!self && !seeingChat("office", id)) unreadOffices.add(id);
        if (chatTab === "office" && chatOffice === id) {
          if (row !== prev) chatLogOffice.appendChild(row);
          chatLogOffice.scrollTop = chatLogOffice.scrollHeight;
        }
        paintChannels();
        return;
      }
      if (!self && !seeingChat("floor")) unreadFloor = true;
      paintChannels();
      const last = chatLogFloor.lastElementChild as HTMLElement | null;
      if (last && sameSpeaker(last, name, self, fromId)) {
        addBubble(last, text);
      } else {
        chatLogFloor.appendChild(rowEl(name, text, self, fromId));
      }
      while (chatLogFloor.children.length > 40) chatLogFloor.removeChild(chatLogFloor.children[0]);
      chatLogFloor.scrollTop = chatLogFloor.scrollHeight;
    },
  };
}
