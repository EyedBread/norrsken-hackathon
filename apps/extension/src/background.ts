import type { Reply, Request } from "./transport.ts";

const API = "http://localhost:8787";
const mapsOrigins = new Set([
  "https://www.google.com",
  "https://www.google.se",
  "https://maps.google.com",
]);
chrome.runtime.onMessage.addListener(
  (message: Request, sender, respond: (reply: Reply) => void) => {
    if (sender.id !== chrome.runtime.id || !sender.url) return false;
    const senderUrl = new URL(sender.url);
    if (
      !mapsOrigins.has(senderUrl.origin) ||
      (senderUrl.hostname !== "maps.google.com" &&
        !senderUrl.pathname.startsWith("/maps"))
    )
      return false;
    if (!message || !["atw:start", "atw:poll"].includes(message.type))
      return false;
    void (async () => {
      try {
        if (
          message.type === "atw:poll" &&
          !/^[0-9a-f-]{36}$/.test(message.jobId)
        )
          throw new Error("Invalid research job.");
        const response = await fetch(
          message.type === "atw:start"
            ? `${API}/api/research`
            : `${API}/api/research/${message.jobId}`,
          {
            method: message.type === "atw:start" ? "POST" : "GET",
            headers: { "Content-Type": "application/json" },
            ...(message.type === "atw:start"
              ? {
                  body: JSON.stringify({
                    place: message.place,
                    refresh: message.refresh === true,
                  }),
                }
              : {}),
            signal: AbortSignal.timeout(15_000),
            credentials: "omit",
            redirect: "error",
          },
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            data?.error?.message ??
              `Research service returned ${response.status}.`,
          );
        respond({ ok: true, data });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Request failed";
        respond({
          ok: false,
          error: /fetch|network|timeout|aborted/i.test(message)
            ? "Cannot reach the research service. Start the API on localhost:8787, then retry."
            : message,
        });
      }
    })();
    return true;
  },
);
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  void chrome.tabs
    .sendMessage(tab.id, { type: "atw:toggle" })
    .catch(() => chrome.tabs.create({ url: "https://www.google.com/maps/" }));
});
