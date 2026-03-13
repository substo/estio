self.addEventListener("push", (event) => {
  if (!event) return;

  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = {
      title: "Task reminder",
      body: event.data ? event.data.text() : "",
    };
  }

  const title = payload.title || "Task reminder";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/logo.jpg",
    badge: payload.badge || "/favicon.ico",
    tag: payload.tag || payload.notificationId || "task-reminder",
    renotify: true,
    requireInteraction: false,
    data: {
      url: payload.url || "/admin/conversations?view=tasks",
      notificationId: payload.notificationId || null,
      taskId: payload.taskId || null,
      deepLinkUrl: payload.deepLinkUrl || payload.url || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/admin/conversations?view=tasks";

  event.waitUntil((async () => {
    const clientList = await clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    for (const client of clientList) {
      const clientUrl = new URL(client.url);
      const destination = new URL(targetUrl, self.location.origin);
      if (clientUrl.origin === destination.origin) {
        await client.focus();
        if ("navigate" in client) {
          return client.navigate(destination.toString());
        }
        return client.focus();
      }
    }

    return clients.openWindow(targetUrl);
  })());
});
