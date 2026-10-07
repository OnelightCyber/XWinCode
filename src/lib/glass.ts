let installed = false;

export function installGlassPointer() {
  if (installed) return;
  installed = true;
  const root = document.documentElement;
  window.addEventListener("keydown", (e) => e.key === "Tab" && (root.dataset.kbd = "1"), true);
  window.addEventListener("mousedown", () => delete root.dataset.kbd, true);
  let frame = 0;
  let last: PointerEvent | null = null;
  window.addEventListener(
    "pointermove",
    (e) => {
      last = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const ev = last;
        const target = (ev?.target as Element | null)?.closest?.(".lg") as HTMLElement | null;
        if (!ev || !target) return;
        const r = target.getBoundingClientRect();
        target.style.setProperty("--mx", `${ev.clientX - r.left}px`);
        target.style.setProperty("--my", `${ev.clientY - r.top}px`);
      });
    },
    { passive: true },
  );
}
