import type { Transport } from "./controller.ts";
import type { Place } from "./types.ts";

export type Request =
  | { type: "atw:start"; place: Place; refresh: boolean }
  | { type: "atw:poll"; jobId: string };
export type Reply = { ok: true; data: unknown } | { ok: false; error: string };
async function send<T>(message: Request): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      chrome.runtime.sendMessage<Request, Reply>(message),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                "The extension did not respond. Reload Maps and try again.",
              ),
            ),
          20_000,
        );
      }),
    ]);
    if (!reply || !reply.ok)
      throw new Error(
        reply?.error ?? "Reload Maps to reconnect the extension.",
      );
    return reply.data as T;
  } catch (err) {
    if (
      err instanceof Error &&
      /context invalidated|receiving end/i.test(err.message)
    )
      throw new Error("The extension was updated. Reload Maps to reconnect.");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
export const extensionTransport: Transport = {
  start: (place, refresh) => send({ type: "atw:start", place, refresh }),
  poll: (jobId) => send({ type: "atw:poll", jobId }),
};
