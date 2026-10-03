import test from "node:test";
import assert from "node:assert/strict";
import { ResearchController, type Transport } from "../src/controller.ts";
import {
  demoPlaces,
  isSameNameBranchChange,
  resolvePlace,
  routeIdentity,
} from "../src/place.ts";
import type { ResearchJob, StartResearchResponse } from "../src/types.ts";

const a = demoPlaces[1]!;
const b = demoPlaces[0]!;
const job = (jobId: string, placeKey: string): ResearchJob => ({
  jobId,
  placeKey,
  status: "complete",
  stage: "done",
  mode: "live",
  generatedAt: null,
  events: [],
  summary: { checked: 0, kept: 0, rejected: 0, uncertain: 0 },
  cards: [],
  decisions: [],
  sourceErrors: [],
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test("maps exact branch only and never maps a name-only match", () => {
  assert.equal(
    resolvePlace(
      "Café Pascal",
      "Norrtullsgatan 4, Stockholm",
      "Stockholm",
      a.mapsUrl,
    )?.key,
    a.key,
  );
  assert.equal(
    resolvePlace(
      "Café Pascal - Odenplan",
      "Norrtullsgatan 4, Stockholm",
      "Stockholm",
      a.mapsUrl,
    )?.key,
    a.key,
  );
  assert.notEqual(
    resolvePlace(
      "Café Pascal",
      "Norrtullsgatan 40, Stockholm",
      "Stockholm",
      a.mapsUrl,
    )?.key,
    a.key,
  );
  assert.notEqual(
    resolvePlace(
      "Café Pascal",
      "Skånegatan 76, Stockholm",
      "Stockholm",
      a.mapsUrl,
    )?.key,
    a.key,
  );
  assert.equal(resolvePlace("Café Pascal", "", "Stockholm", a.mapsUrl), null);
  assert.equal(
    resolvePlace("Café Pascal", "Norrtullsgatan 4", "", a.mapsUrl),
    null,
  );
});
test("generic place identity is stable across camera movements, sensitive to address", () => {
  const first = resolvePlace(
    "A Café",
    "Main 1",
    "Town",
    "https://www.google.com/maps/place/A/@1,2,3z",
  )!;
  const second = resolvePlace(
    "A Cafe",
    "Main 1",
    "Town",
    "https://www.google.com/maps/place/A/@2,3,4z",
  )!;
  assert.equal(first.key, second.key);
  assert.notEqual(
    first.key,
    resolvePlace("A Cafe", "Main 2", "Town", first.mapsUrl)?.key,
  );
  assert.equal(first.lat, undefined);
});
test("route identity ignores map camera, detects same-name branch ID", () => {
  const base = "https://www.google.com/maps/place/Cafe/";
  assert.equal(
    routeIdentity(base + "@1,2,3z/data=!4m2!1sbranch-a!8m2"),
    routeIdentity(base + "@4,5,6z/data=!4m2!1sbranch-a!8m2"),
  );
  assert.notEqual(
    routeIdentity(base + "@1,2,3z/data=!1sbranch-a"),
    routeIdentity(base + "@1,2,3z/data=!1sbranch-b"),
  );
  assert.equal(
    isSameNameBranchChange(
      routeIdentity(base + "@1,2,3z/data=!1sbranch-a"),
      routeIdentity(base + "@1,2,3z/data=!1sbranch-b"),
    ),
    true,
  );
  assert.equal(
    isSameNameBranchChange(
      routeIdentity("https://www.google.com/maps/search/?query=Cafe"),
      routeIdentity(base + "@1,2,3z/data=!1sbranch-a"),
    ),
    false,
  );
});
test("discard a late start response after A → B → A", async () => {
  const pending = deferred<StartResearchResponse>();
  let polls = 0;
  const controller = new ResearchController(
    {
      start: () => pending.promise,
      poll: async (id) => {
        polls++;
        return job(id, a.key);
      },
    },
    () => {},
  );
  controller.select(a);
  const started = controller.start();
  controller.select(b);
  controller.select(a);
  pending.resolve({ jobId: "old", placeKey: a.key });
  await started;
  assert.equal(polls, 0);
  assert.equal(controller.state.job, null);
  assert.equal(controller.state.busy, false);
});
test("discard late poll response after switching place", async () => {
  const pending = deferred<ResearchJob>();
  const polled = deferred<void>();
  const controller = new ResearchController(
    {
      start: async () => ({ jobId: "old", placeKey: a.key }),
      poll: () => {
        polled.resolve();
        return pending.promise;
      },
    },
    () => {},
  );
  controller.select(a);
  const started = controller.start();
  await polled.promise;
  controller.select(b);
  pending.resolve(job("old", a.key));
  await started;
  assert.equal(controller.state.place?.key, b.key);
  assert.equal(controller.state.job, null);
});
test("reject mismatched job IDs and place keys", async () => {
  for (const result of [job("wrong", a.key), job("right", b.key)]) {
    const controller = new ResearchController(
      {
        start: async () => ({ jobId: "right", placeKey: a.key }),
        poll: async () => result,
      },
      () => {},
    );
    controller.select(a);
    await controller.start();
    assert.equal(controller.state.job, null);
    assert.match(controller.state.error!, /mismatched/);
  }
});
test("refresh flag passes through, partial result ends polling without losing cards", async () => {
  let refreshValue = false;
  const partial = {
    ...job("one", a.key),
    status: "partial" as const,
    sourceErrors: [{ source: "web", code: "timeout", message: "Timed out" }],
  };
  const transport: Transport = {
    start: async (_, refresh) => {
      refreshValue = refresh;
      return { jobId: "one", placeKey: a.key };
    },
    poll: async () => partial,
  };
  const controller = new ResearchController(transport, () => {});
  controller.select(a);
  await controller.start(true);
  assert.equal(refreshValue, true);
  assert.equal(controller.state.busy, false);
  assert.equal(controller.state.job?.status, "partial");
});
test("connection failure is recoverable without changing venue", async () => {
  let attempts = 0;
  const controller = new ResearchController(
    {
      start: async () => {
        if (++attempts === 1) throw new Error("offline");
        return { jobId: "ok", placeKey: a.key };
      },
      poll: async () => job("ok", a.key),
    },
    () => {},
  );
  controller.select(a);
  await controller.start();
  assert.equal(controller.state.error, "offline");
  await controller.start(true);
  assert.equal(controller.state.error, null);
  assert.equal(controller.state.job?.jobId, "ok");
});
