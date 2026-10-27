/* Push-only worker: never caches authenticated pages, API responses or HR data. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
function inboxPath(value) {
  return typeof value === "string" &&
    /^\/(sq|de|en|it)\/staff\/schedule\?/.test(value)
    ? value
    : "/sq/staff/schedule?workforceTab=inbox";
}
function seen(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("flow-workforce-notification-dedup", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("messages", { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result,
        transaction = db.transaction("messages", "readwrite"),
        store = transaction.objectStore("messages"),
        read = store.get(id);
      let duplicate = false;
      read.onsuccess = () => {
        duplicate = !!read.result;
        if (!duplicate) store.add({ id, at: Date.now() });
      };
      transaction.oncomplete = () => {
        db.close();
        resolve(duplicate);
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    };
  });
}
self.addEventListener("push", (event) =>
  event.waitUntil(
    (async () => {
      let payload;
      try {
        payload = event.data?.json();
      } catch {
        return;
      }
      if (
        !payload ||
        typeof payload.notificationId !== "string" ||
        payload.notificationId.length > 128
      )
        return;
      if (await seen(payload.notificationId)) return;
      await self.registration.showNotification("FlowGastronomie", {
        body:
          typeof payload.body === "string"
            ? payload.body.slice(0, 240)
            : "A workforce update is ready in your secure inbox.",
        tag: payload.notificationId,
        renotify: false,
        data: { path: inboxPath(payload.path) },
      });
    })(),
  ),
);
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    inboxPath(event.notification.data?.path),
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients)
        if (new URL(client.url).origin === self.location.origin) {
          await client.navigate(url);
          return client.focus();
        }
      return self.clients.openWindow(url);
    })(),
  );
});
