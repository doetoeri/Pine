if ("serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js?v=20260902-account-api2", {
        scope: "./",
        updateViaCache: "none",
      });
      await registration.update().catch(() => {});
    } catch (error) {
      console.warn("[PinCon PWA] service worker registration failed", error);
    }
  });
}
