if ("serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  const scriptBase = document.currentScript?.src || new URL("./registerSW.js", location.origin).href;
  const serviceWorkerUrl = new URL("./sw.js?v=20260902-account-api2", scriptBase).href;
  const serviceWorkerScope = new URL("./", scriptBase).href;
  let reloading = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(serviceWorkerUrl, {
        scope: serviceWorkerScope,
        updateViaCache: "none",
      });
      await registration.update().catch(() => {});
    } catch (error) {
      console.warn("[PinCon PWA] service worker registration failed", error);
    }
  });
}