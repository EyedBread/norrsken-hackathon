import { Panel } from "./panel.ts";
import { extensionTransport } from "./transport.ts";
import {
  isSameNameBranchChange,
  readSelection,
  routeIdentity,
} from "./place.ts";

if (!document.getElementById("atw-extension-root")) {
  const panel = new Panel(extensionTransport);
  let route = routeIdentity(location.href);
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let lastIdentity = "";
  let previousRouteIdentity: string | null = null;
  const checkRoute = () => {
    const next = routeIdentity(location.href);
    if (next === route) return false;
    previousRouteIdentity = isSameNameBranchChange(route, next)
      ? lastIdentity || null
      : null;
    route = next;
    panel.setSelection(null);
    return true;
  };
  const scan = () => {
    checkRoute();
    if (!panel.host.isConnected) document.body.append(panel.host);
    const selection = readSelection(document, location.href);
    const identity = selection ? `${selection.name}|${selection.address}` : "";
    // Same-named branches can keep the previous heading/address during an SPA transition.
    if (previousRouteIdentity !== null && identity === previousRouteIdentity)
      return;
    if (selection) previousRouteIdentity = null;
    lastIdentity = identity;
    panel.setSelection(selection);
  };
  const observer = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(scan, 250);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label", "aria-hidden"],
  });
  // Maps navigation uses pushState in a separate JS world; polling the URL avoids patching it.
  const navigationTimer = setInterval(() => {
    if (checkRoute()) {
      clearTimeout(debounce);
      debounce = setTimeout(scan, 350);
    }
  }, 300);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "atw:toggle") panel.toggle();
  });
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      observer.disconnect();
      clearInterval(navigationTimer);
      clearTimeout(debounce);
      panel.controller.dispose();
    }
  });
  scan();
}
