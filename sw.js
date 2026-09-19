/* APEX Signal Engine service worker — enables installable PWA + OS-level alerts. */
const CACHE = "apex-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/manifest.webmanifest"])));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/* Messages from the dashboard become real OS notifications (phone + desktop). */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "APEX_SIGNAL") return;
  event.waitUntil(
    self.registration.showNotification(data.title || "APEX signal", {
      body: data.body || "",
      icon: "/icon-512.png",
      badge: "/icon-512.png",
      tag: data.tag || "apex-signal",
      renotify: true,
      requireInteraction: Boolean(data.sticky),
      vibrate: [120, 60, 120],
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
