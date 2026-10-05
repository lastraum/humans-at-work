const sheetQuery = "(max-width: 900px), ((max-height: 520px) and (max-width: 1100px))";
const landscapeSheetQuery = "(max-height: 520px) and (max-width: 1100px)";

/** Keep the workstation sheet and dialogs above the soft keyboard, and
 *  tell the camera pad how tall the sheet is so it doesn't cover it. */
export function bindMobileChrome() {
  const root = document.documentElement;
  const stack = document.querySelector<HTMLElement>("#mac-stack");
  const sheet = window.matchMedia(sheetQuery);
  const landscapeSheet = window.matchMedia(landscapeSheetQuery);
  const coarse = window.matchMedia("(pointer: coarse)");

  const sync = () => {
    const vv = window.visualViewport;
    const layoutH = window.innerHeight;
    const vvHeight = vv?.height ?? layoutH;
    const offsetTop = vv?.offsetTop ?? 0;
    const keyboard = Math.max(0, Math.round(layoutH - vvHeight - offsetTop));
    root.style.setProperty("--vv-height", `${Math.round(vvHeight)}px`);
    root.style.setProperty("--vv-offset-top", `${Math.round(offsetTop)}px`);
    root.style.setProperty("--keyboard", `${keyboard}px`);
    root.classList.toggle("keyboard-open", keyboard > 80);
    if (stack) {
      const rect = stack.getBoundingClientRect();
      root.style.setProperty("--mac-stack-h", `${Math.round(rect.height)}px`);
      const tall = sheet.matches && !landscapeSheet.matches && rect.top < 148;
      root.classList.toggle("sheet-tall", tall);
    }
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  };

  sync();
  window.addEventListener("resize", sync);
  window.visualViewport?.addEventListener("resize", sync);
  window.visualViewport?.addEventListener("scroll", sync);
  sheet.addEventListener("change", sync);
  if (stack && typeof ResizeObserver !== "undefined") {
    new ResizeObserver(sync).observe(stack);
  }

  document.addEventListener("focusin", (event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    window.setTimeout(() => {
      sync();
      if (!sheet.matches && !coarse.matches) return;
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, 280);
  });
  document.addEventListener("focusout", () => {
    window.setTimeout(sync, 280);
  });
}
