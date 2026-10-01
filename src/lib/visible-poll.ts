// src/lib/visible-poll.ts
// A poll that runs only while the tab is visible, for the live maps and the
// footer's freshness line.

/**
 * Call `poll` every `everyMs` while the tab is visible. A hidden tab skips its
 * ticks, so returning to it polls straight away once the last poll is a full
 * interval old. Each poll gets the run's abort signal: the stop function aborts
 * it, so a fetch in flight is cancelled and a poll can check `signal.aborted`
 * before touching state that the cleanup has torn down.
 * @param poll - One poll; it handles its own errors.
 * @param everyMs - The interval between polls.
 * @param options - Poll options.
 * @param options.immediate - Poll once on start (default true); off when the
 *   page already holds fresh data.
 * @returns A stop function for the effect's cleanup.
 */
export function startVisiblePoll(
  poll: (signal: AbortSignal) => Promise<void>,
  everyMs: number,
  { immediate = true }: { immediate?: boolean } = {},
): () => void {
  const ctrl = new AbortController();
  let lastPoll = 0;
  /** Run one poll, noting when, so a return to the tab can tell it is stale. */
  const run = (): void => {
    lastPoll = Date.now();
    void poll(ctrl.signal);
  };
  /** Poll on returning to the tab, when the last poll is a full interval old. */
  const onVisible = (): void => {
    if (document.visibilityState === "visible" && Date.now() - lastPoll >= everyMs) run();
  };
  if (immediate) run();
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") run();
  }, everyMs);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    ctrl.abort();
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
