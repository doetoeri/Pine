if ("serviceWorker" in navigator) {
  const scriptBase = document.currentScript?.src || new URL("/registerSW.js", location.origin).href;
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(new URL("./sw.js?v=20260905-resilience1", scriptBase).href, {
        scope: new URL("./", scriptBase).href, updateViaCache: "none",
      });
      // Apply on the next navigation. A background deployment must not reload an
      // active editor, lose an input, or interrupt a login.
      await registration.update().catch(() => {});
    } catch (error) { console.warn("[PinCon PWA] registration unavailable", error); }
  });
}
