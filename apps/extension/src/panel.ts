import css from "./panel.css";
import {
  ResearchController,
  type State,
  type Transport,
} from "./controller.ts";
import { resolvePlace, type Selection } from "./place.ts";
import type { ResearchCard, ResearchJob } from "./types.ts";

export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
export function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
const e = escapeHtml;
const date = (value: string | null, withTime = false) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
  }).format(new Date(value));
};
const metric = (value: number | null) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
const icons: Record<string, string> = {
  globe:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/>',
  arrow: '<path d="M5 19 19 5M5 5h14v14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  video:
    '<rect x="4" y="3" width="16" height="18" rx="4"/><path d="m10 8 6 4-6 4Z"/>',
  article: '<path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.globe}</svg>`;

function cardHtml(
  card: ResearchCard,
  index: number,
  failedImages: Set<string>,
): string {
  const url = safeUrl(card.url);
  const thumb = safeUrl(card.thumbnailUrl);
  const source =
    card.source === "tiktok"
      ? "TikTok"
      : (() => {
          try {
            return new URL(card.url).hostname.replace(/^www\./, "");
          } catch {
            return "Article";
          }
        })();
  const content = `<div class="cover ${card.type}" ${thumb && !failedImages.has(card.id) ? "" : 'data-fallback="true"'}>
      ${thumb && !failedImages.has(card.id) ? `<img src="${e(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-image="${e(card.id)}">` : ""}
      <div class="cover-placeholder">${icon(card.type)}<span>${card.type === "video" ? "Watch at the source" : "Read the original story"}</span></div>
      <span class="source-badge">${icon(card.type)} ${e(source)}</span><span class="open-mark">${icon("arrow")}</span>
    </div><div class="card-copy"><div class="byline">${e(card.author ?? source)} <span>· ${e(date(card.publishedAt))}</span></div>
      <h3>${e(card.title)}</h3></div>`;
  return `<article class="card" style="--i:${index}">
    ${url ? `<a class="card-link" href="${e(url)}" target="_blank" rel="noopener noreferrer">${content}<span class="sr-only">Open original source in a new tab</span></a>` : content}
    ${card.type === "video" ? `<dl class="metrics">${(["views", "likes", "comments", "shares"] as const).map((key) => `<div><dt>${key}</dt><dd aria-label="${key}: ${card.metrics[key] === null ? "unavailable" : card.metrics[key]}">${metric(card.metrics[key])}</dd></div>`).join("")}</dl>` : ""}
    <details class="evidence" data-detail="${e(card.id)}"><summary>${icon("check")} Why this place <span>+</span></summary><p>${e(card.why)}</p>
      ${card.evidence
        .filter((ev) => card.evidenceIds.includes(ev.id))
        .map(
          (ev) =>
            `<blockquote><span>${e(ev.kind.replaceAll("_", " "))}</span>${e(ev.text)}${safeUrl(ev.sourceUrl) ? `<a href="${e(safeUrl(ev.sourceUrl))}" target="_blank" rel="noopener noreferrer">View evidence ${icon("arrow")}</a>` : ""}</blockquote>`,
        )
        .join("")}
      <small>Source fetched ${e(date(card.fetchedAt, true))}</small>
    </details>
  </article>`;
}

function activityHtml(job: ResearchJob): string {
  return `<details class="activity" data-detail="activity"><summary>Research activity <span>${job.events.length} updates</span></summary>
    <ol>${job.events.map((event) => `<li><time>${e(date(event.at, true))}</time><p>${e(event.message)}</p></li>`).join("") || "<li>No activity reported yet.</li>"}</ol></details>`;
}

export class Panel {
  readonly controller: ResearchController;
  readonly host: HTMLElement;
  private root: ShadowRoot;
  private content: HTMLElement;
  private selection: Selection | null = null;
  private selectionSignature = "";
  private open = false;
  private filter: "all" | "video" | "article" = "all";
  private visibleCount = 6;
  private failedImages = new Set<string>();
  private editing = false;
  private lastAnnouncement = "";

  constructor(transport: Transport, parent: HTMLElement = document.body) {
    this.host = document.createElement("div");
    this.host.id = "atw-extension-root";
    this.root = this.host.attachShadow({ mode: "open" });
    this.root.innerHTML = `<style>${css}</style><button class="launcher" aria-label="Open Around the Web" aria-expanded="false">${icon("globe")}<span>Around the Web</span><span class="launcher-dot"></span></button>
      <aside class="drawer" aria-label="Around the Web" hidden><header class="brand-bar"><div class="brand">${icon("globe")}<span>Around the Web<span class="brand-sub">A different view of this place</span></span></div><button class="icon-button close" aria-label="Close Around the Web">${icon("close")}</button></header><div class="scroll-area"></div><footer class="footer"><span class="footer-dot"></span> Follow the evidence. Find your place.</footer></aside><span class="sr-only" role="status" aria-live="polite"></span>`;
    parent.append(this.host);
    this.content = this.root.querySelector(".scroll-area")!;
    this.controller = new ResearchController(transport, (state) =>
      this.render(state),
    );
    this.root
      .querySelector(".launcher")!
      .addEventListener("click", () => this.setOpen(true));
    this.root
      .querySelector(".close")!
      .addEventListener("click", () => this.setOpen(false));
    this.root.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") this.setOpen(false);
    });
    this.content.addEventListener("click", (event) => this.handleClick(event));
    this.content.addEventListener("submit", (event) =>
      this.handleSubmit(event),
    );
    this.content.addEventListener(
      "error",
      (event) => {
        const img = event.target as HTMLImageElement;
        if (img.tagName !== "IMG" || !img.dataset.image) return;
        this.failedImages.add(img.dataset.image);
        img.parentElement!.dataset.fallback = "true";
        img.remove();
      },
      true,
    );
    this.render(this.controller.state);
  }

  setSelection(selection: Selection | null): void {
    const signature = selection
      ? `${selection.name}|${selection.address}|${selection.city}`
      : "";
    if (signature === this.selectionSignature) return;
    this.selectionSignature = signature;
    this.selection = selection;
    this.filter = "all";
    this.visibleCount = 6;
    this.editing = false;
    this.content.scrollTop = 0;
    this.controller.select(selection?.place ?? null);
  }

  setOpen(open: boolean): void {
    this.open = open;
    const drawer = this.root.querySelector<HTMLElement>(".drawer")!;
    const launcher = this.root.querySelector<HTMLButtonElement>(".launcher")!;
    drawer.hidden = !open;
    launcher.hidden = open;
    launcher.setAttribute("aria-expanded", String(open));
    if (open) this.root.querySelector<HTMLButtonElement>(".close")!.focus();
    else launcher.focus();
  }
  toggle(): void {
    this.setOpen(!this.open);
  }

  private handleClick(event: Event): void {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "button",
    );
    if (!button) return;
    if (button.dataset.action === "research")
      void this.controller.start(
        !!this.controller.state.job || !!this.controller.state.error,
      );
    if (button.dataset.action === "edit") {
      this.editing = !this.editing;
      if (this.controller.state.busy)
        this.controller.select(this.controller.state.place);
      this.render(this.controller.state);
      this.content.querySelector<HTMLInputElement>("input")?.focus();
    }
    if (button.dataset.action === "more") {
      this.visibleCount += 6;
      this.render(this.controller.state);
    }
    if (button.dataset.filter) {
      this.filter = button.dataset.filter as typeof this.filter;
      this.visibleCount = 6;
      this.render(this.controller.state);
    }
  }

  private handleSubmit(event: Event): void {
    event.preventDefault();
    if (!this.selection) return;
    const data = new FormData(event.target as HTMLFormElement);
    const name = String(data.get("name") ?? "").trim();
    const address = String(data.get("address") ?? "").trim();
    const city = String(data.get("city") ?? "").trim();
    const place = resolvePlace(name, address, city, this.selection.mapsUrl);
    if (!place) return;
    this.selection = { name, address, city, mapsUrl: place.mapsUrl, place };
    this.editing = false;
    this.controller.select(place);
  }

  private render(state: State): void {
    const expanded = new Set(
      [
        ...this.content.querySelectorAll<HTMLDetailsElement>("details[open]"),
      ].map((el) => el.dataset.detail),
    );
    const focused = this.root.activeElement as HTMLElement | null;
    const focusAction = focused?.dataset.action;
    const focusFilter = focused?.dataset.filter;
    const job = state.job;
    const selection = this.selection;
    const stage = state.error
      ? "Research interrupted"
      : !state.busy
        ? job
          ? job.status === "partial"
            ? "Some sources need another look"
            : "Research complete"
          : "Go beyond the pin."
        : job?.stage === "checking"
          ? "Checking the connection…"
          : job?.stage === "searching"
            ? "Looking around the web…"
            : "Starting your research…";
    const mode =
      job?.mode === "cache"
        ? "Cached result"
        : job?.mode === "demo"
          ? "Demo · sample results"
          : job
            ? "Live research"
            : "On your request";
    this.content.innerHTML = `
      <section class="place-section"><div class="eyebrow">${icon("pin")} ${selection ? "THE PLACE YOU’RE EXPLORING" : "YOUR NEXT DISCOVERY"}</div>
        <h1>${e(state.place?.name ?? selection?.name ?? "Every place has more to it.")}</h1>
        <div class="address-row"><p>${e(state.place?.address ?? selection?.address ?? (selection ? "Confirm the address to find the right branch." : "Select a place in Google Maps to discover its stories."))}</p>${selection ? '<button class="text-button" data-action="edit" aria-label="Correct place details">Edit</button>' : ""}</div>
        ${selection && (!state.place || this.editing) ? `<form class="identity-form"><p>Make sure we’re looking at the right place.</p><label>Place name<input name="name" required maxlength="200" value="${e(selection.name)}"></label><label>Street address<input name="address" required maxlength="300" value="${e(selection.address)}"></label><label>City<input name="city" required maxlength="100" value="${e(selection.city)}"></label><button class="primary" type="submit">Use this place ${icon("check")}</button></form>` : ""}
      </section>
      ${
        selection
          ? `<section class="research-section"><div class="section-line"><span class="eyebrow">THE WEB, WITH CONTEXT</span><span class="mode ${job?.mode ?? ""}">${e(mode)}</span></div>
        ${!job && !state.busy && !state.error ? `<h2>${e(stage)}</h2><p class="intro">Videos worth watching. Stories worth reading. Checked against this exact place.</p>` : ""}
        <button class="primary research-button" data-action="research" ${!state.place || state.busy ? "disabled" : ""}>${state.busy ? '<span class="spinner"></span>' : icon(job || state.error ? "globe" : "search")}<span>${state.busy ? "Research in progress" : job || state.error ? "Research again" : "Explore around the web"}</span>${state.busy ? "" : icon("arrow")}</button>
        ${state.busy ? `<div class="progress"><div class="progress-track"><span class="active"></span><span class="${job?.stage === "checking" ? "active" : ""}"></span><span></span></div><h2>${e(stage)}</h2><p>${e(job?.events.at(-1)?.message ?? "Waiting for the research service.")}</p></div>` : ""}
        ${state.error ? `<div class="notice error" role="alert"><strong>We couldn’t finish this search.</strong><p>${e(state.error)}</p></div>` : ""}
        ${job?.mode === "demo" ? '<p class="demo-note">Demo results. These are not a live assessment of this venue.</p>' : ""}
        ${job?.mode === "cache" ? `<p class="timestamp">Saved research · ${e(date(job.generatedAt, true))}</p>` : ""}
        ${job?.status === "partial" ? '<div class="notice"><strong>Part of the picture.</strong><p>Some sources or checks could not finish. Only kept matches appear below; unresolved items remain uncertain.</p></div>' : ""}
        ${job?.sourceErrors.length ? `<details class="source-errors" data-detail="errors"><summary>${job.sourceErrors.length} source or research issue${job.sourceErrors.length > 1 ? "s" : ""}</summary>${job.sourceErrors.map((err) => `<p><strong>${e(err.source)}</strong> · ${e(err.message)}</p>`).join("")}</details>` : ""}
      </section>`
          : '<div class="empty no-place">' +
            icon("globe") +
            '<h2>A wider lens on the places you love.</h2><p>TikToks, local stories, and a little help connecting the dots.</p><span class="empty-note">Open a café, bakery, or anywhere that catches your eye.</span></div>'
      }
      ${job ? this.resultsHtml(job, state.busy) : ""}`;
    for (const detail of this.content.querySelectorAll<HTMLDetailsElement>(
      "details",
    ))
      detail.open = expanded.has(detail.dataset.detail);
    if (focusFilter)
      this.content
        .querySelector<HTMLButtonElement>(`[data-filter="${focusFilter}"]`)
        ?.focus({ preventScroll: true });
    else if (focusAction)
      this.content
        .querySelector<HTMLButtonElement>(`[data-action="${focusAction}"]`)
        ?.focus({ preventScroll: true });
    if (stage !== this.lastAnnouncement) {
      this.root.querySelector('[role="status"]')!.textContent = stage;
      this.lastAnnouncement = stage;
    }
  }

  private resultsHtml(job: ResearchJob, busy: boolean): string {
    const cards = job.cards.filter(
      (card) => this.filter === "all" || card.type === this.filter,
    );
    const excluded = job.decisions.filter((d) => d.verdict !== "keep");
    return `<section class="results-section"><div class="results-heading"><h2>${busy ? "Results so far" : "The discoveries"}</h2><span>${job.cards.length.toString().padStart(2, "0")}</span></div>
      <div class="summary"><span><strong>${job.summary.checked}</strong> checked</span><span><strong>${job.summary.kept}</strong> kept</span><span><strong>${job.summary.rejected}</strong> excluded</span><span><strong>${job.summary.uncertain}</strong> uncertain</span></div>
      <div class="filters" role="group" aria-label="Filter discoveries">${(["all", "video", "article"] as const).map((filter) => `<button data-filter="${filter}" aria-pressed="${this.filter === filter}">${filter === "all" ? "All discoveries" : filter === "video" ? "Videos" : "Articles"} <span>${filter === "all" ? job.cards.length : job.cards.filter((c) => c.type === filter).length}</span></button>`).join("")}</div>
      <div class="cards">${cards
        .slice(0, this.visibleCount)
        .map((card, i) => cardHtml(card, i, this.failedImages))
        .join("")}</div>
      ${cards.length > this.visibleCount ? '<button class="secondary" data-action="more">Show more discoveries</button>' : ""}
      ${!cards.length && !busy ? `<div class="empty">${icon("search")}<h3>${job.cards.length ? "No matches in this filter." : "No confirmed matches yet."}</h3><p>${job.cards.length ? "Try another category to see the other discoveries." : "A name alone isn’t enough. Try again, or check the place details above."}</p></div>` : ""}
      ${excluded.length ? `<details class="decisions" data-detail="decisions"><summary>What didn’t make the cut <span>${excluded.length} ${icon("arrow")}</span></summary><p class="muted">Uncertain and excluded items are kept separate from confirmed discoveries.</p>${excluded.map((d) => `<div class="decision"><span class="verdict ${d.verdict}">${d.verdict === "reject" ? "Excluded" : "Uncertain"}</span><p>${e(d.reason)}</p><small>${e(d.candidateId)}</small></div>`).join("")}</details>` : ""}
      ${activityHtml(job)}${job.generatedAt && job.mode !== "cache" ? `<p class="timestamp">Research recorded ${e(date(job.generatedAt, true))}</p>` : ""}
    </section>`;
  }
}
