export interface ContainerPollingOptions {
  /** Fixed wait between polls; used after `delaysMs` runs out. */
  intervalMs: number;
  maxWaitMs: number;
  /** Optional backoff schedule for the first polls (e.g. [2000, 5000, 10000]). */
  delaysMs?: number[];
  sleep?: (milliseconds: number) => Promise<void>;
  label?: string;
}

/** Statuses Meta reports for IG and Threads media containers. */
export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED";

/**
 * Poll until the container is FINISHED (ready to publish). PUBLISHED also counts as done.
 * ERROR/EXPIRED and timeouts throw, so callers never publish an unready container.
 */
export async function waitForContainerStatus(
  fetchStatus: () => Promise<string | undefined>,
  options: ContainerPollingOptions
): Promise<void> {
  const {
    intervalMs,
    maxWaitMs,
    delaysMs = [],
    sleep = (milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
    label = "Container",
  } = options;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("Polling intervalMs must be greater than zero.");
  }
  if (!Number.isFinite(maxWaitMs) || maxWaitMs < 0) {
    throw new Error("Polling maxWaitMs must be zero or greater.");
  }

  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    const status = await fetchStatus();
    if (status === "FINISHED" || status === "PUBLISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(`${label} processing failed (${status} status)`);
    }
    const delay = attempt < delaysMs.length ? delaysMs[attempt] : intervalMs;
    if (waited + delay > maxWaitMs) break;
    await sleep(delay);
    waited += delay;
  }

  throw new Error(`${label} processing timed out after ${Math.ceil(maxWaitMs / 1000)}s`);
}

/** Backoff used for IG/Threads containers: quick for images, capped at 30s, 5 minutes total (Meta's guidance). */
export const CONTAINER_BACKOFF_MS = [2_000, 3_000, 5_000, 10_000, 20_000];
export const CONTAINER_INTERVAL_MS = 30_000;
export const CONTAINER_MAX_WAIT_MS = 300_000;
