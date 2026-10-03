import venues from "../../../fixtures/venues.json";
import type { Place } from "./types.ts";

export type Selection = {
  name: string;
  address: string;
  city: string;
  mapsUrl: string;
  place: Place | null;
};
export const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export const demoPlaces: Place[] = venues.map(
  ({ key, name, address, city, mapsUrl }) => ({
    key,
    name,
    address,
    city,
    mapsUrl,
  }),
);

function hash(text: string): string {
  let value = 2166136261;
  for (const char of text) {
    value ^= char.codePointAt(0)!;
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}

/** Only map a demo branch when the street AND number agree; a name alone is ambiguous. */
export function resolvePlace(
  name: string,
  address: string,
  city: string,
  mapsUrl: string,
): Place | null {
  if (!name.trim() || !address.trim() || !city.trim()) return null;
  const normalizedName = normalize(name);
  const demo = demoPlaces.find((p) => {
    const baseName = normalize(p.name).replace(/ vasastan$| ostermalm$/g, "");
    const street = normalize(p.address.split(",")[0]!);
    return (
      (normalizedName === baseName ||
        normalizedName.startsWith(`${baseName} `)) &&
      ` ${normalize(address)} `.includes(` ${street} `) &&
      normalize(city) === normalize(p.city)
    );
  });
  if (demo) return { ...demo, mapsUrl };
  const identity = `${normalize(name)}|${normalize(address)}|${normalize(city)}`;
  return {
    key: `${normalize(name).replaceAll(" ", "-").slice(0, 70)}-${hash(identity)}`,
    name: name.trim(),
    address: address.trim(),
    city: city.trim(),
    mapsUrl,
  };
}

export function routeIdentity(href: string): string {
  const url = new URL(href);
  // Ignore map-camera panning, but retain place IDs encoded in Maps' data path.
  const data =
    url.pathname.match(/!1s([^!]+)/)?.[1] ??
    url.searchParams.get("query_place_id") ??
    "";
  return `${url.pathname.split("/@")[0]}|${data}|${url.searchParams.get("query") ?? ""}`;
}

export function isSameNameBranchChange(
  previous: string,
  next: string,
): boolean {
  const [oldPath, oldId] = previous.split("|");
  const [newPath, newId] = next.split("|");
  return oldPath === newPath && !!oldId && !!newId && oldId !== newId;
}

export function readSelection(doc: Document, href: string): Selection | null {
  const url = new URL(href);
  if (
    !url.pathname.startsWith("/maps/place/") &&
    !url.pathname.startsWith("/maps/search/")
  )
    return null;
  const visible = (el: Element) =>
    el.getClientRects().length > 0 && el.getAttribute("aria-hidden") !== "true";
  const heading = [...doc.querySelectorAll('[role="main"] h1, h1')].find(
    (el) => visible(el) && el.textContent?.trim(),
  );
  if (!heading) return null;
  const name = heading.textContent!.trim().slice(0, 200);
  const encodedName = url.pathname.match(/\/maps\/place\/([^/]+)/)?.[1];
  if (encodedName) {
    let pathName: string;
    try {
      pathName = normalize(
        decodeURIComponent(encodedName.replaceAll("+", " ")),
      );
    } catch {
      return null;
    }
    const title = normalize(name);
    if (!pathName.includes(title) && !title.includes(pathName)) return null; // old DOM during navigation
  }
  const panel = heading.closest('[role="main"]') ?? doc;
  const addressEl = [
    ...panel.querySelectorAll(
      '[data-item-id="address"], button[aria-label^="Address:"], button[aria-label^="Adress:"]',
    ),
  ].find(visible);
  // A /search result list can contain many place cards; never treat its first h1 as a selection.
  if (url.pathname.startsWith("/maps/search/") && !addressEl) return null;
  const label = addressEl?.getAttribute("aria-label") ?? "";
  const address = (
    label.replace(/^(Address|Adress):\s*/i, "") ||
    addressEl?.textContent ||
    ""
  )
    .trim()
    .slice(0, 300);
  const city = /stockholm/i.test(address) ? "Stockholm" : "";
  return {
    name,
    address,
    city,
    mapsUrl: href,
    place: resolvePlace(name, address, city, href),
  };
}
