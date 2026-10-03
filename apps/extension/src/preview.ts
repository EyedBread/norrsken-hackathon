import { Panel, escapeHtml } from "./panel.ts";
import { demoPlaces } from "./place.ts";
import type { Place, ResearchCard, ResearchJob } from "./types.ts";
import type { Transport } from "./controller.ts";
import captures from "../../../fixtures/sources/demo-candidates.json";
import css from "./preview.css";

const style = document.createElement("style");
style.textContent = css;
document.head.append(style);
const initial = demoPlaces[1]!;
let current = initial;
let scenario = "complete";
let counter = 0;
const jobs = new Map<string, ResearchJob>();
const e = escapeHtml;

function makeJob(place: Place, id: string): ResearchJob {
  const captured =
    captures.venues.find((v) => v.place.key === place.key) ??
    captures.venues[1]!;
  const article = captured.candidates.find((c) => c.type === "article")!;
  const social =
    captured.candidates.find((c) =>
      c.evidence.some((ev) =>
        ev.text
          .toLowerCase()
          .includes(place.address.split(",")[0]!.toLowerCase()),
      ),
    ) ?? captured.candidates[0]!;
  const selected = [social, article];
  const cards: ResearchCard[] = selected.map((candidate) => ({
    ...candidate,
    why: "UI fixture: this source contains branch-specific location evidence. This explanation is for interface testing, not a Gemini verdict.",
    evidenceIds: candidate.evidence.map((ev) => ev.id),
  })) as ResearchCard[];
  return {
    jobId: id,
    placeKey: place.key,
    status: "complete",
    stage: "done",
    mode: "demo",
    generatedAt: captured.socialCapturedAt,
    cards,
    summary: { checked: 4, kept: 2, rejected: 1, uncertain: 1 },
    decisions: [
      ...cards.map((c) => ({
        candidateId: c.id,
        verdict: "keep" as const,
        reason: c.why,
        evidenceIds: c.evidenceIds,
      })),
      {
        candidateId: "ui-fixture:other-branch",
        verdict: "reject",
        reason:
          "UI fixture: the location tag names a different street. A shared venue name does not establish a branch match.",
        evidenceIds: [],
      },
      {
        candidateId: "ui-fixture:ambiguous-caption",
        verdict: "uncertain",
        reason:
          "UI fixture: the caption names Stockholm but provides no address or branch evidence.",
        evidenceIds: [],
      },
    ],
    sourceErrors: [],
    events: [],
  };
}

const transport: Transport = {
  async start(place) {
    if (scenario === "error")
      throw new Error(
        "Preview scenario: the research service is unavailable. No request was sent.",
      );
    const jobId = `preview-${++counter}`;
    const job = makeJob(place, jobId);
    if (scenario === "partial") {
      job.status = "partial";
      job.sourceErrors = [
        {
          source: "articles",
          code: "preview_timeout",
          message:
            "UI fixture: one article could not be read before the deadline.",
        },
      ];
    }
    if (scenario === "empty") {
      job.cards = [];
      job.decisions = [];
      job.summary = { checked: 0, kept: 0, rejected: 0, uncertain: 0 };
    }
    if (
      scenario === "searching" ||
      scenario === "checking" ||
      scenario === "queued"
    ) {
      job.stage = scenario;
      job.status = scenario === "queued" ? "queued" : "running";
      job.cards = [];
      job.decisions = [];
      job.summary = { checked: 0, kept: 0, rejected: 0, uncertain: 0 };
    }
    if (scenario === "images")
      job.cards = job.cards.map((c) => ({
        ...c,
        thumbnailUrl: "http://127.0.0.1:5173/unavailable-image.jpg",
      }));
    jobs.set(jobId, job);
    return { jobId, placeKey: place.key };
  },
  async poll(id) {
    return structuredClone(jobs.get(id)!);
  },
};

document.querySelector("#preview")!.innerHTML =
  `<div class="studio-brand"><span class="studio-logo">a<span>↗</span></span><strong>around the web</strong><span class="studio-tag">INTERACTION STUDIO</span></div>
  <div class="map-art" aria-hidden="true"><svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice"><defs><pattern id="blocks" width="160" height="120" patternTransform="rotate(-24)" patternUnits="userSpaceOnUse"><rect x="8" y="8" width="139" height="100" rx="10" fill="#e8e9db"/><path d="M0 0H160M0 0V120" stroke="#faf9f1" stroke-width="13"/></pattern></defs><rect width="1000" height="1000" fill="#ebeede"/><rect width="1000" height="1000" fill="url(#blocks)"/><path d="M-60 880Q350 700 420 800T1100 820" fill="none" stroke="#c1d9d6" stroke-width="130"/><path d="M500 -50Q450 350 870 630T1100 860" fill="none" stroke="#faf9f1" stroke-width="34"/><path d="M-30 320Q260 330 680 440T1100 570" fill="none" stroke="#faf9f1" stroke-width="27"/><ellipse cx="500" cy="330" rx="115" ry="70" fill="#d2ddbd" transform="rotate(-24 500 330)"/><g fill="#8d9b85" font-family="Georgia" font-size="13" letter-spacing="3"><text x="140" y="170" transform="rotate(-24 140 170)">VASASTAN</text><text x="480" y="580" transform="rotate(-24 480 580)">NORRMALM</text><text x="720" y="250" transform="rotate(-24 720 250)">ÖSTERMALM</text></g></svg><span class="map-pin p1">01</span><span class="map-pin p2">02</span><span class="map-pin p3">03</span></div>
  <section class="studio-intro"><span class="kicker">STOCKHOLM, THROUGH A WIDER LENS</span><h1>A little<br>more <em>local.</em></h1><p>There’s more to a place than its pin.<br>Find the videos, stories, and details<br>that bring it into focus.</p><div class="studio-rule"></div><span class="small-label">PICK A PLACE TO EXPLORE</span><nav class="venues">${demoPlaces.map((p, i) => `<button data-place="${p.key}" aria-pressed="${p.key === initial.key}"><span>0${i + 1}</span><span><strong>${e(p.name)}</strong><small>${e(p.address.split(",")[0])}</small></span><span>↗</span></button>`).join("")}</nav></section>
  <section class="studio-controls"><label>Preview state<select id="scenario"><option value="complete">Completed discoveries</option><option value="queued">Queued</option><option value="searching">Searching</option><option value="checking">Checking evidence</option><option value="partial">Partial results</option><option value="empty">No matches</option><option value="error">Connection error</option><option value="images">Missing thumbnails</option><option value="identity">Unclear place identity</option><option value="none">No place selected</option></select></label><p>UI preview · recorded source data with illustrative decisions.<br>No live agent calls. The map is an illustration.</p></section>`;

const panel = new Panel(transport);
function show(start = true) {
  panel.setSelection(null);
  panel.setSelection({ ...current, place: current });
  if (scenario === "none") panel.setSelection(null);
  else if (scenario === "identity")
    panel.setSelection({ ...current, address: "", city: "", place: null });
  else if (start) void panel.controller.start();
  panel.setOpen(true);
}
show();
document.querySelectorAll<HTMLButtonElement>("[data-place]").forEach((button) =>
  button.addEventListener("click", () => {
    current = demoPlaces.find((p) => p.key === button.dataset.place)!;
    for (const el of document.querySelectorAll<HTMLButtonElement>(
      "[data-place]",
    ))
      el.setAttribute("aria-pressed", String(el === button));
    show();
  }),
);
document
  .querySelector<HTMLSelectElement>("#scenario")!
  .addEventListener("change", (event) => {
    scenario = (event.target as HTMLSelectElement).value;
    show();
  });
