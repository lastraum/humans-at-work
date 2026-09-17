import type { ChatChannel, Privacy } from "./protocol";

export type MacAuth = {
  email?: string;
  googleClientId?: string | null;
  onEmailStart: (email: string) => Promise<{ ok: boolean; error?: string; devCode?: string; mailed?: boolean }>;
  onEmailVerify: (email: string, code: string) => Promise<{ ok: boolean; error?: string }>;
  onGoogle: (credential: string) => Promise<{ ok: boolean; error?: string }>;
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
  onName: (name: string) => boolean | Promise<boolean | void> | void;
  getPrivacy: () => Privacy;
  onPrivacy: (privacy: Privacy) => void;
  hasDesk: () => boolean;
  signedIn?: () => boolean;
  onChat: (text: string, channel: ChatChannel) => void;
  onKnockReply?: (fromId: string, accept: boolean) => void;
  onBlock?: (id: string, on: boolean) => void;
  onDebugKnock?: () => void;
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
  const chatHint = root.querySelector<HTMLElement>("#mac-chat-office-hint");
  const floorHint = root.querySelector<HTMLElement>("#mac-chat-floor-hint");
  const chatTabs = root.querySelectorAll<HTMLButtonElement>("[data-chat]");
  const chatForm = root.querySelector<HTMLFormElement>("#mac-chat-form")!;
  const chatInput = root.querySelector<HTMLInputElement>("#mac-chat-input")!;
  let chatChannel: ChatChannel = "office";
  let chatOffice: string | null = null;
  let claimed = false;
  const officeLogs = new Map<string, HTMLElement[]>();
  const privacyHint = root.querySelector("#mac-privacy-hint")!;
  const privacyBtns = root.querySelectorAll<HTMLInputElement>("input[name='mac-privacy']");
  const alertEl = root.querySelector<HTMLElement>("#mac-alert")!;
  const alertBody = root.querySelector("#mac-alert-body")!;
  const debugKnock = root.querySelector<HTMLButtonElement>("#mac-debug-knock");
  const bootBtn = root.querySelector<HTMLButtonElement>("#mac-boot");
  let knockFrom = "";

  const showPanel = (id: string) => {
    panels.forEach((panel) => {
      panel.hidden = panel.id !== id;
    });
    icons.forEach((icon) => {
      icon.classList.toggle("on", icon.dataset.mac === id.replace("mac-", ""));
    });
  };

  closeBtn.addEventListener("click", () => {
    root.classList.toggle("collapsed");
  });
  icons.forEach((icon) => {
    icon.addEventListener("click", () => {
      if ((icon.dataset.mac === "chat" || icon.dataset.mac === "privacy") && !opts.signedIn?.()) {
        askSignIn(icon.dataset.mac === "chat" ? "Sign in to chat." : "Sign in to take an office.");
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
  nameInput.value = opts.getName();
  const nameSave = root.querySelector<HTMLButtonElement>("#mac-name-save");
  const nameHint = root.querySelector<HTMLElement>("#mac-name-hint");
  const nameHintRest = nameHint?.textContent ?? "This shows on your door plate.";
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
  const commitName = () => {
    const name = nameInput.value.trim();
    if (!name) {
      flashName("Type a name first.", false);
      return;
    }
    void Promise.resolve(opts.onName(name)).then((ok) => {
      flashName(ok === false ? "Couldn't save." : "Saved.", ok !== false);
    });
  };
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitName();
    }
  });
  nameSave?.addEventListener("click", commitName);

  const accountIn = root.querySelector<HTMLElement>("#mac-account-in");
  const accountOut = root.querySelector<HTMLElement>("#mac-account-out");
  const accountEmail = root.querySelector<HTMLElement>("#mac-account-email");
  const emailInput = root.querySelector<HTMLInputElement>("#mac-email");
  const emailSend = root.querySelector<HTMLButtonElement>("#mac-email-send");
  const emailCodeWrap = root.querySelector<HTMLElement>("#mac-email-code-wrap");
  const emailCode = root.querySelector<HTMLInputElement>("#mac-email-code");
  const emailVerify = root.querySelector<HTMLButtonElement>("#mac-email-verify");
  const authHint = root.querySelector<HTMLElement>("#mac-auth-hint");
  const googleWrap = root.querySelector<HTMLElement>("#mac-google-wrap");
  const googleHost = root.querySelector<HTMLElement>("#mac-google");
  const logoutBtn = root.querySelector<HTMLButtonElement>("#mac-logout");
  let googleReady = false;

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

  const loadGoogle = () => {
    const clientId = opts.auth?.googleClientId;
    if (!clientId || !googleHost || googleReady) return;
    const render = () => {
      const gsi = window.google?.accounts?.id;
      if (!gsi) return;
      gsi.initialize({
        client_id: clientId,
        callback: (response) => {
          setAuthHint("Signing in…");
          void opts.auth?.onGoogle(response.credential).then((result) => {
            if (!result.ok) setAuthHint(result.error || "Google sign-in failed");
          });
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      googleHost.replaceChildren();
      gsi.renderButton(googleHost, {
        type: "standard",
        theme: "outline",
        size: "medium",
        text: "continue_with",
        width: 300,
      });
      googleReady = true;
      if (googleWrap) googleWrap.hidden = false;
    };
    if (window.google?.accounts?.id) {
      render();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>("script[data-gsi]");
    if (existing) {
      existing.addEventListener("load", render, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.gsi = "1";
    script.addEventListener("load", render, { once: true });
    document.head.appendChild(script);
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
  if (opts.auth?.googleClientId) {
    if (googleWrap) googleWrap.hidden = false;
    loadGoogle();
  } else if (googleWrap) googleWrap.hidden = true;

  emailSend?.addEventListener("click", () => {
    const email = emailInput?.value.trim() ?? "";
    if (!email) {
      setAuthHint("Type your email first.");
      return;
    }
    if (!opts.auth) return;
    emailSend.disabled = true;
    setAuthHint("Sending code…");
    void opts.auth.onEmailStart(email).then((result) => {
      emailSend.disabled = false;
      if (!result.ok) {
        setAuthHint(result.error || "Could not send code");
        return;
      }
      if (emailCodeWrap) emailCodeWrap.hidden = false;
      emailCode?.focus();
      if (result.devCode) {
        setAuthHint(`Dev code: ${result.devCode}`);
      } else if (result.mailed) {
        setAuthHint("Check your email for a 6-digit code.");
      } else {
        setAuthHint("Code printed in the server log.");
      }
    });
  });
  emailVerify?.addEventListener("click", () => {
    const email = emailInput?.value.trim() ?? "";
    const code = emailCode?.value.trim() ?? "";
    if (!email || !code) {
      setAuthHint("Email and code both needed.");
      return;
    }
    if (!opts.auth) return;
    emailVerify.disabled = true;
    setAuthHint("Signing in…");
    void opts.auth.onEmailVerify(email, code).then((result) => {
      emailVerify.disabled = false;
      if (!result.ok) setAuthHint(result.error || "Wrong code");
    });
  });
  emailCode?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") emailVerify?.click();
  });
  emailInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (emailCodeWrap && !emailCodeWrap.hidden) emailVerify?.click();
      else emailSend?.click();
    }
  });
  logoutBtn?.addEventListener("click", () => {
    logoutBtn.disabled = true;
    void opts.auth
      ?.onLogout()
      .catch(() => undefined)
      .finally(() => {
        logoutBtn.disabled = false;
      });
  });
  const paintChat = () => {
    if (!opts.signedIn?.()) {
      chatLogFloor.hidden = true;
      chatLogOffice.hidden = true;
      if (floorHint) {
        floorHint.hidden = false;
        floorHint.textContent = "Sign in to chat.";
      }
      if (chatHint) chatHint.hidden = true;
      chatInput.disabled = true;
      chatInput.placeholder = "Sign in to talk…";
      chatTabs.forEach((tab) => {
        tab.classList.toggle("on", tab.dataset.chat === chatChannel);
        tab.disabled = true;
      });
      return;
    }
    if (!claimed && chatChannel === "floor") chatChannel = "office";
    const inOffice = Boolean(chatOffice);
    const floorLocked = !claimed;
    chatLogFloor.hidden = chatChannel !== "floor" || floorLocked;
    chatLogOffice.hidden = chatChannel !== "office" || !inOffice;
    if (floorHint) {
      floorHint.hidden = !(chatChannel === "floor" && floorLocked);
      floorHint.textContent = "Claim an office to talk on the floor.";
    }
    if (chatHint) chatHint.hidden = chatChannel !== "office" || inOffice;
    chatInput.disabled =
      (chatChannel === "office" && !inOffice) || (chatChannel === "floor" && floorLocked);
    chatInput.placeholder =
      chatChannel === "office" ? "Message this office…" : "Message the floor…";
    chatTabs.forEach((tab) => {
      tab.classList.toggle("on", tab.dataset.chat === chatChannel);
      tab.disabled = tab.dataset.chat === "floor" && floorLocked;
    });
    if (chatChannel === "office" && inOffice) {
      chatLogOffice.replaceChildren(...(officeLogs.get(chatOffice!) ?? []));
      chatLogOffice.scrollTop = chatLogOffice.scrollHeight;
    }
  };

  const rowEl = (name: string, text: string, self: boolean) => {
    const row = document.createElement("div");
    row.className = "mac-chat-row" + (self ? " self" : "");
    row.innerHTML = `<b></b> <span></span>`;
    row.querySelector("b")!.textContent = name;
    row.querySelector("span")!.textContent = text;
    return row;
  };

  chatTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.dataset.chat === "floor" && !claimed) return;
      chatChannel = tab.dataset.chat === "office" ? "office" : "floor";
      paintChat();
    });
  });
  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!opts.signedIn?.()) {
      askSignIn("Sign in to chat.");
      return;
    }
    const text = chatInput.value.trim();
    if (!text) return;
    if (chatChannel === "office" && !chatOffice) return;
    if (chatChannel === "floor" && !claimed) return;
    opts.onChat(text, chatChannel);
    chatInput.value = "";
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
  debugKnock?.addEventListener("click", () => opts.onDebugKnock?.());
  bootBtn?.addEventListener("click", () => {
    if (!opts.hasDesk()) return;
    opts.onBoot?.();
  });

  privacyBtns.forEach((btn) => {
    btn.disabled = true;
  });
  showPanel("mac-chat");
  paintChat();

  return {
    setPrivacy(privacy: Privacy) {
      privacyBtns.forEach((btn) => {
        btn.checked = btn.value === privacy;
      });
    },
    setHasDesk(on: boolean) {
      claimed = on;
      root.hidden = false;
      privacyHint.textContent = on
        ? "This is what the floor sees."
        : "Claim an office to set this.";
      privacyBtns.forEach((btn) => {
        btn.disabled = !on;
      });
      if (bootBtn) bootBtn.disabled = !on;
      if (!on) {
        alertEl.hidden = true;
        knockFrom = "";
      }
      paintChat();
    },
    setName(name: string) {
      if (document.activeElement !== nameInput) nameInput.value = name;
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
      if (!claimed) return;
      if (opts.getPrivacy() === "focus") return;
      knockFrom = fromId;
      root.classList.remove("collapsed");
      alertBody.textContent = `${fromName} is at your door.`;
      alertEl.hidden = false;
    },
    hideKnock() {
      alertEl.hidden = true;
      knockFrom = "";
    },
    setChatRoom(deskId: string | null) {
      if (chatOffice === deskId) return;
      chatOffice = deskId;
      paintChat();
    },
    setFloor(
      rows: {
        peerId: string;
        name: string;
        desk: string;
        privacy: string;
        time: string;
        self?: boolean;
        blocked?: boolean;
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
          "People checked into an office. Block hides their floor chat, knocks, and keeps them out of your office.";
      }
      for (const row of rows) {
        const el = document.createElement("div");
        el.className = "mac-floor-row" + (row.self ? " self" : "") + (row.blocked ? " blocked" : "");
        const mode = row.privacy === "focus" ? "Focus" : row.privacy === "busy" ? "Busy" : "Open";
        el.innerHTML = `<div class="mac-floor-who"><b></b><span></span></div><div class="mac-floor-meta"><div class="mac-floor-time"></div></div>`;
        el.querySelector("b")!.textContent = row.name;
        el.querySelector("span")!.textContent = `${row.desk} · ${mode}`;
        el.querySelector(".mac-floor-time")!.textContent = row.time;
        if (!row.self) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "mac-floor-block";
          btn.textContent = row.blocked ? "Unblock" : "Block";
          btn.addEventListener("click", (event) => {
            event.stopPropagation();
            opts.onBlock?.(row.peerId, !row.blocked);
          });
          el.querySelector(".mac-floor-meta")!.appendChild(btn);
        }
        list.appendChild(el);
      }
    },
    addChat(name: string, text: string, self = false, channel: ChatChannel = "floor", deskId?: string) {
      if (!opts.signedIn?.()) return;
      if (channel === "floor" && !claimed) return;
      const row = rowEl(name, text, self);
      if (channel === "office") {
        const id = deskId ?? chatOffice;
        if (!id) return;
        const list = officeLogs.get(id) ?? [];
        list.push(row);
        while (list.length > 40) list.shift();
        officeLogs.set(id, list);
        if (chatChannel === "office" && chatOffice === id) {
          chatLogOffice.appendChild(row);
          chatLogOffice.scrollTop = chatLogOffice.scrollHeight;
        }
        return;
      }
      chatLogFloor.appendChild(row);
      while (chatLogFloor.children.length > 40) chatLogFloor.removeChild(chatLogFloor.children[0]);
      chatLogFloor.scrollTop = chatLogFloor.scrollHeight;
    },
  };
}
