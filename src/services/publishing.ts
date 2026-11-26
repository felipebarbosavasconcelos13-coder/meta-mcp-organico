import { ScopedClient } from "./meta-client.js";
import {
  CONTAINER_BACKOFF_MS,
  CONTAINER_INTERVAL_MS,
  CONTAINER_MAX_WAIT_MS,
  waitForContainerStatus,
} from "./container-polling.js";
import { HandlerOutput } from "../tools/define.js";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function containerId(data: unknown): string {
  const id = (data as { id?: string } | undefined)?.id;
  if (!id) throw new Error("Meta did not return a container ID.");
  return id;
}

// ─── Instagram ──────────────────────────────────────────────────

export async function igContainerStatus(c: ScopedClient, id: string): Promise<string | undefined> {
  const { data } = await c.ig("GET", `/${id}`, { fields: "status_code" });
  return (data as { status_code?: string }).status_code;
}

export async function waitForIgContainer(c: ScopedClient, id: string, maxWaitMs = CONTAINER_MAX_WAIT_MS): Promise<void> {
  await waitForContainerStatus(() => igContainerStatus(c, id), {
    intervalMs: CONTAINER_INTERVAL_MS,
    delaysMs: CONTAINER_BACKOFF_MS,
    maxWaitMs,
    label: "Instagram container",
  });
}

/** Create an IG media container and return its ID. */
export async function createIgContainer(c: ScopedClient, params: Record<string, unknown>): Promise<string> {
  const { data } = await c.ig("POST", `/${c.igUserId}/media`, params);
  return containerId(data);
}

/**
 * Publish a ready container. If the publish call fails (e.g. timeout), check the container:
 * PUBLISHED means the post went out, so report success instead of inviting a duplicate retry.
 */
export async function publishIgContainer(c: ScopedClient, id: string): Promise<HandlerOutput> {
  try {
    const { data, rateLimit } = await c.ig("POST", `/${c.igUserId}/media_publish`, { creation_id: id });
    return { data: { ...(data as object), container_id: id }, rateLimit };
  } catch (error) {
    let status: string | undefined;
    try {
      status = await igContainerStatus(c, id);
    } catch {
      /* report the original error below */
    }
    if (status === "PUBLISHED") {
      let latest: { id?: string; permalink?: string; timestamp?: string } | undefined;
      try {
        const { data } = await c.ig("GET", `/${c.igUserId}/media`, { fields: "id,permalink,timestamp", limit: 1 });
        latest = (data as { data?: typeof latest[] }).data?.[0];
      } catch {
        /* id stays unknown */
      }
      return {
        data: {
          id: latest?.id,
          permalink: latest?.permalink,
          container_id: id,
          status: "PUBLISHED",
          note: `The publish call reported an error (${message(error)}), but the container is PUBLISHED, so the post is live. id/permalink are the account's most recent media. Do not publish again.`,
        },
      };
    }
    throw new Error(
      `${message(error)} (container_id ${id}, container status ${status ?? "unknown"}; check ig_get_container_status before retrying so the post is not duplicated)`
    );
  }
}

/** Create → wait → publish in one step. */
export async function createAndPublishIg(c: ScopedClient, params: Record<string, unknown>): Promise<HandlerOutput> {
  const id = await createIgContainer(c, params);
  await waitForIgContainer(c, id);
  return publishIgContainer(c, id);
}

// ─── Threads ────────────────────────────────────────────────────

export async function threadsContainerStatus(c: ScopedClient, id: string): Promise<string | undefined> {
  const { data } = await c.threads("GET", `/${id}`, { fields: "status,error_message" });
  const body = data as { status?: string; error_message?: string };
  if (body.status === "ERROR" && body.error_message) {
    throw new Error(`Threads container processing failed: ${body.error_message}`);
  }
  return body.status;
}

export async function waitForThreadsContainer(c: ScopedClient, id: string, maxWaitMs = CONTAINER_MAX_WAIT_MS): Promise<void> {
  await waitForContainerStatus(() => threadsContainerStatus(c, id), {
    intervalMs: CONTAINER_INTERVAL_MS,
    delaysMs: CONTAINER_BACKOFF_MS,
    maxWaitMs,
    label: "Threads container",
  });
}

export async function createThreadsContainer(c: ScopedClient, params: Record<string, unknown>): Promise<string> {
  const { data } = await c.threads("POST", `/${await c.threadsUserId()}/threads`, params);
  return containerId(data);
}

export async function publishThreadsContainer(c: ScopedClient, id: string): Promise<HandlerOutput> {
  const userId = await c.threadsUserId();
  try {
    const { data, rateLimit } = await c.threads("POST", `/${userId}/threads_publish`, { creation_id: id });
    return { data: { ...(data as object), container_id: id }, rateLimit };
  } catch (error) {
    let status: string | undefined;
    try {
      const { data } = await c.threads("GET", `/${id}`, { fields: "status" });
      status = (data as { status?: string }).status;
    } catch {
      /* report the original error below */
    }
    if (status === "PUBLISHED") {
      let latest: { id?: string; permalink?: string } | undefined;
      try {
        const { data } = await c.threads("GET", `/${userId}/threads`, { fields: "id,permalink,timestamp", limit: 1 });
        latest = (data as { data?: typeof latest[] }).data?.[0];
      } catch {
        /* id stays unknown */
      }
      return {
        data: {
          id: latest?.id,
          permalink: latest?.permalink,
          container_id: id,
          status: "PUBLISHED",
          note: `The publish call reported an error (${message(error)}), but the container is PUBLISHED, so the post is live. id/permalink are the account's most recent thread. Do not publish again.`,
        },
      };
    }
    throw new Error(
      `${message(error)} (container_id ${id}, container status ${status ?? "unknown"}; check threads_get_container_status before retrying so the post is not duplicated)`
    );
  }
}

/** Create → wait until FINISHED (text included, per Meta's guidance) → publish. */
export async function createAndPublishThreads(c: ScopedClient, params: Record<string, unknown>): Promise<HandlerOutput> {
  const id = await createThreadsContainer(c, params);
  await waitForThreadsContainer(c, id);
  return publishThreadsContainer(c, id);
}
