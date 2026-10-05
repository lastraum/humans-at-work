/**
 * Layout checks for the workstation sheet on phone/tablet viewports.
 * Uses the system Chrome via puppeteer-core. Does not need a signed-in session.
 *
 *   CHROME_PATH=/usr/local/bin/google-chrome npm run test:mobile
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const PORT = 4178;
const CHROME = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";
const shots = "/opt/cursor/artifacts/screenshots";

const failures = [];

function assert(cond, message) {
  if (!cond) failures.push(message);
}

function boxOf(rect) {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function inside(rect, width, height, slack = 2) {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.left >= -slack &&
    rect.top >= -slack &&
    rect.right <= width + slack &&
    rect.bottom <= height + slack
  );
}

function overlaps(a, b) {
  return a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
}

async function startVite() {
  const child = spawn(
    "npx",
    ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk;
  });
  child.stderr.on("data", (chunk) => {
    log += chunk;
  });
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return child;
    } catch {
      /* not up yet */
    }
    if (child.exitCode != null) throw new Error(`vite exited\n${log}`);
    await delay(200);
  }
  child.kill("SIGTERM");
  throw new Error(`vite did not start\n${log}`);
}

async function prepare(page, { coarse }) {
  const client = await page.createCDPSession();
  await client.send("Emulation.setEmulatedMedia", {
    features: [{ name: "pointer", value: coarse ? "coarse" : "fine" }],
  });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => document.body.classList.contains("ready"));
  await page.evaluate(() => {
    document.querySelector("#join-gate")?.setAttribute("hidden", "");
    document.querySelector("#boot")?.setAttribute("hidden", "");
  });
}

async function showPanel(page, id) {
  await page.evaluate((panelId) => {
    const mac = document.querySelector("#mac");
    mac.classList.remove("collapsed");
    document.querySelectorAll(".mac-panel").forEach((panel) => {
      panel.hidden = panel.id !== panelId;
    });
    document.querySelector("#person-card").hidden = true;
    document.querySelector("#ad-visit").hidden = true;
    document.querySelector("#mac-peek").hidden = true;
  }, id);
  await delay(50);
}

async function measure(page) {
  return page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        display: style.display,
        visibility: style.visibility,
        fontSize: style.fontSize,
        position: style.position,
      };
    };
    const macBody = document.querySelector("#mac .mac-body")?.getBoundingClientRect();
    const input = document.querySelector("#mac-chat-input");
    const inputRect = input?.getBoundingClientRect();
    const inputVisible = Boolean(
      inputRect &&
        macBody &&
        inputRect.width > 0 &&
        inputRect.height > 2 &&
        inputRect.bottom <= macBody.bottom + 2 &&
        inputRect.top >= macBody.top - 2 &&
        inputRect.right <= macBody.right + 2 &&
        inputRect.left >= macBody.left - 2,
    );
    return {
      stack: rect("#mac-stack"),
      close: rect("#mac .mac-close"),
      pad: rect("#cam-pad"),
      join: rect("#join-gate-card"),
      menubar: rect("#mac .mac-menubar"),
      chatForm: rect("#mac-chat-form"),
      inputVisible,
      inputFont: input ? getComputedStyle(input).fontSize : "",
      icons: [...document.querySelectorAll(".mac-icons button")].map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.mac, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      }),
      privacy: [...document.querySelectorAll("#mac-privacy .mac-well label")].map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent.trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width };
      }),
      collapsed: document.querySelector("#mac").classList.contains("collapsed"),
      sheet: matchMedia("(max-width: 900px), ((max-height: 520px) and (max-width: 1100px))").matches,
      coarse: matchMedia("(pointer: coarse)").matches,
    };
  });
}

function expectsSheet(spec) {
  return spec.width <= 900 || (spec.height <= 520 && spec.width <= 1100);
}

async function runViewport(browser, spec) {
  const page = await browser.newPage();
  await page.setViewport({
    width: spec.width,
    height: spec.height,
    isMobile: spec.coarse,
    hasTouch: spec.coarse,
    deviceScaleFactor: spec.coarse ? 2 : 1,
  });
  await prepare(page, spec);
  const label = `${spec.name} ${spec.width}x${spec.height}`;
  const sheet = expectsSheet(spec);

  const collapsed = await measure(page);
  assert(collapsed.sheet === sheet, `${label} sheet query ${collapsed.sheet}, expected ${sheet}`);
  assert(inside(collapsed.stack, spec.width, spec.height), `${label} collapsed stack offscreen ${JSON.stringify(boxOf(collapsed.stack))}`);
  assert(inside(collapsed.close, spec.width, spec.height), `${label} close button offscreen`);
  assert(collapsed.menubar.display === "none", `${label} menubar visible while collapsed`);
  if (sheet) {
    assert(collapsed.stack.height < 120, `${label} collapsed sheet is ${collapsed.stack.height}px tall`);
    assert(collapsed.stack.width > spec.width - 48, `${label} sheet width ${collapsed.stack.width} on ${spec.width}`);
  } else {
    assert(Math.abs(collapsed.stack.width - 520) < 2, `${label} stack width ${collapsed.stack.width}, want 520`);
    assert(Math.abs(spec.width - collapsed.stack.right - 16) < 3, `${label} stack inset ${spec.width - collapsed.stack.right}`);
  }
  if (!spec.coarse) {
    assert(collapsed.close.width <= 14, `${label} close button grew to ${collapsed.close.width}px on desktop`);
    assert(Math.abs(collapsed.pad.left - 24) < 2, `${label} camera pad left ${collapsed.pad.left}`);
  } else {
    assert(collapsed.close.width >= 20, `${label} close button still ${collapsed.close.width}px on touch`);
  }

  await showPanel(page, "mac-chat");
  const chat = await measure(page);
  assert(inside(chat.stack, spec.width, spec.height), `${label} expanded stack offscreen ${JSON.stringify(boxOf(chat.stack))}`);
  assert(inside(chat.close, spec.width, spec.height), `${label} expanded close offscreen`);
  assert(chat.stack.height < spec.height * 0.78, `${label} sheet covers ${Math.round(chat.stack.height)} of ${spec.height}`);
  assert(chat.inputVisible, `${label} chat input is clipped or missing`);
  if (spec.coarse) {
    assert(parseFloat(chat.inputFont) >= 16, `${label} chat input font ${chat.inputFont} (iOS zoom trap)`);
  } else {
    assert(parseFloat(chat.inputFont) < 16, `${label} desktop chat font became ${chat.inputFont}`);
    assert(chat.menubar.display !== "none", `${label} desktop menubar hidden`);
  }
  if (!sheet) assert(Math.abs(chat.stack.width - 520) < 2, `${label} expanded stack width ${chat.stack.width}`);

  const padHidden = chat.pad.visibility === "hidden" || chat.pad.display === "none";
  if (!padHidden) {
    assert(inside(chat.pad, spec.width, spec.height), `${label} camera pad offscreen ${JSON.stringify(boxOf(chat.pad))}`);
    assert(!overlaps(chat.pad, chat.stack), `${label} camera pad overlaps the workstation`);
  }

  for (const iconId of ["profile", "privacy", "chat", "help"]) {
    const icon = await page.evaluate((id) => {
      const el = document.querySelector(`[data-mac="${id}"]`);
      el?.scrollIntoView({ inline: "nearest", block: "nearest" });
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    }, iconId);
    assert(inside(icon, spec.width, spec.height), `${label} ${iconId} icon not reachable ${JSON.stringify(icon)}`);
    if (spec.coarse && sheet) {
      const minIcon = spec.height <= 400 ? 34 : 44;
      assert(icon.height >= minIcon, `${label} ${iconId} icon height ${icon.height}`);
    }
  }

  await showPanel(page, "mac-privacy");
  const privacy = await page.evaluate(() => {
    return [...document.querySelectorAll("#mac-privacy .mac-well label")].map((el) => {
      el.scrollIntoView({ block: "nearest" });
      const r = el.getBoundingClientRect();
      return { text: el.textContent.trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width };
    });
  });
  assert(privacy.length === 3, `${label} expected 3 privacy choices, got ${privacy.length}`);
  for (const labelEl of privacy) {
    assert(inside(labelEl, spec.width, spec.height), `${label} privacy "${labelEl.text}" offscreen ${JSON.stringify(labelEl)}`);
    if (spec.coarse) assert(labelEl.height >= 40, `${label} privacy hit target ${labelEl.height}px for ${labelEl.text}`);
  }

  await showPanel(page, "mac-chat");
  const card = await page.evaluate(() => {
    const person = document.querySelector("#person-card");
    person.hidden = false;
    document.querySelector("#person-card-name").textContent = "Ada Lovelace";
    const read = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    return { person: read("#person-card"), close: read("#person-card .mac-close"), mac: read("#mac .mac-close") };
  });
  assert(inside(card.person, spec.width, spec.height), `${label} person card offscreen ${JSON.stringify(card.person)}`);
  assert(inside(card.close, spec.width, spec.height), `${label} person card close offscreen ${JSON.stringify(card.close)}`);
  assert(inside(card.mac, spec.width, spec.height), `${label} workstation close covered when a person card is open`);
  await page.evaluate(() => {
    document.querySelector("#person-card").hidden = true;
  });

  await page.evaluate(() => {
    document.querySelector("#join-gate").hidden = false;
    document.querySelector("#claim-shift").hidden = false;
  });
  const dialogs = await page.evaluate(() => {
    const read = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    return { join: read("#join-gate-card"), claim: read("#claim-shift-card") };
  });
  assert(inside(dialogs.join, spec.width, spec.height), `${label} join card offscreen ${JSON.stringify(dialogs.join)}`);
  assert(inside(dialogs.claim, spec.width, spec.height), `${label} claim card offscreen ${JSON.stringify(dialogs.claim)}`);
  await page.evaluate(() => {
    document.querySelector("#join-gate").hidden = true;
    document.querySelector("#claim-shift").hidden = true;
  });

  if (spec.shot) {
    await showPanel(page, "mac-chat");
    await mkdir(shots, { recursive: true });
    await page.screenshot({ path: `${shots}/${spec.shot}.png` });
  }

  await page.close();
  console.log(failures.length ? `checked ${label}` : `ok ${label}`);
}

const child = await startVite();
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

try {
  const viewports = [
    { name: "desktop", width: 1440, height: 900, coarse: false, shot: "desktop-workstation" },
    { name: "phone-portrait", width: 390, height: 844, coarse: true, shot: "phone-portrait" },
    { name: "phone-landscape", width: 844, height: 390, coarse: true, shot: "phone-landscape" },
    { name: "phone-se", width: 320, height: 568, coarse: true, shot: null },
    { name: "phone-se-land", width: 568, height: 320, coarse: true, shot: null },
    { name: "tablet-portrait", width: 768, height: 1024, coarse: true, shot: "tablet-portrait" },
    { name: "tablet-landscape", width: 1024, height: 768, coarse: true, shot: null },
  ];
  for (const spec of viewports) {
    const before = failures.length;
    await runViewport(browser, spec);
    if (failures.length > before) {
      console.error(failures.slice(before).map((line) => `  FAIL ${line}`).join("\n"));
    }
  }
} finally {
  await browser.close();
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

if (failures.length) {
  console.error(`\n${failures.length} mobile layout check(s) failed`);
  process.exit(1);
}
console.log("\nmobile layout checks passed");
process.exit(0);
