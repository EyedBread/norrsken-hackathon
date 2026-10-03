import type { Place, ResearchJob, StartResearchResponse } from "./types.ts";

export interface Transport {
  start(place: Place, refresh: boolean): Promise<StartResearchResponse>;
  poll(jobId: string): Promise<ResearchJob>;
}
export type State = {
  place: Place | null;
  job: ResearchJob | null;
  busy: boolean;
  error: string | null;
};

/** A generation guards A → B → A too, where checking the place key alone is insufficient. */
export class ResearchController {
  state: State = { place: null, job: null, busy: false, error: null };
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private currentJobId: string | undefined;
  constructor(
    private transport: Transport,
    private changed: (state: State) => void,
    private pollMs = 1500,
  ) {}
  select(place: Place | null): void {
    this.generation++;
    clearTimeout(this.timer);
    this.currentJobId = undefined;
    this.state = { place, job: null, busy: false, error: null };
    this.changed(this.state);
  }
  async start(refresh = false): Promise<void> {
    if (!this.state.place || this.state.busy) return;
    const place = this.state.place;
    const generation = ++this.generation;
    clearTimeout(this.timer);
    this.currentJobId = undefined;
    this.state = { place, job: null, busy: true, error: null };
    this.changed(this.state);
    const valid = () =>
      generation === this.generation && place.key === this.state.place?.key;
    const fail = (err: unknown) => {
      if (!valid()) return;
      this.state = {
        ...this.state,
        busy: false,
        error:
          err instanceof Error
            ? err.message
            : "Research could not be completed.",
      };
      this.changed(this.state);
    };
    try {
      const started = await this.transport.start(place, refresh);
      if (!valid()) return;
      if (started.placeKey !== place.key)
        throw new Error("The API returned a different place. Please retry.");
      this.currentJobId = started.jobId;
      const deadline = Date.now() + 120_000;
      const poll = async () => {
        if (!valid()) return;
        try {
          if (Date.now() >= deadline)
            throw new Error(
              "Research is taking too long. Try again in a moment.",
            );
          const job = await this.transport.poll(started.jobId);
          if (!valid()) return;
          if (job.placeKey !== place.key || job.jobId !== this.currentJobId)
            throw new Error(
              "The API returned mismatched results. Please retry.",
            );
          const busy =
            job.stage !== "done" &&
            !["complete", "partial", "failed"].includes(job.status);
          this.state = {
            place,
            job,
            busy,
            error:
              job.status === "failed"
                ? "Research failed. Please try again."
                : null,
          };
          this.changed(this.state);
          if (busy) this.timer = setTimeout(() => void poll(), this.pollMs);
        } catch (err) {
          fail(err);
        }
      };
      await poll();
    } catch (err) {
      fail(err);
    }
  }
  dispose(): void {
    this.generation++;
    clearTimeout(this.timer);
  }
}
