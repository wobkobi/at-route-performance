// src/lib/at-alerts.ts
/**
 * @description Types, fetchers and filters for AT's GTFS-RT service-alerts feed:
 * fetches and normalises alerts (with retry and backoff), then selects the ones
 * relevant to a given route, a given stop, or the whole network.
 */
import { unstable_cache } from "@/lib/mem-cache";
import { routeSlug } from "@/lib/route-slug";
import { isObj, sleep } from "@/lib/utils";

export interface AlertTranslation {
  text: string;
  language: string;
}

export interface AlertText {
  translation: AlertTranslation[];
}

/** Active period for an alert, expressed as Unix epoch seconds. */
export interface ActivePeriod {
  start?: number;
  end?: number;
}

export interface InformedEntity {
  agency_id?: string;
  route_id?: string;
  route_type?: number;
  stop_id?: string;
}

export interface ServiceAlert {
  id: string;
  active_period: ActivePeriod[];
  informed_entity: InformedEntity[];
  cause?: string;
  effect?: string;
  header_text?: AlertText;
  description_text?: AlertText;
  url?: AlertText;
}

export interface AtServiceAlerts {
  header?: { timestamp?: number };
  alerts: ServiceAlert[];
}

/**
 * Returns the English translation from an `AlertText`, falling back to the
 * first available translation. Returns null when the field is absent or empty.
 * @param field - The alert text field to extract from.
 * @returns The English text string, or null when absent or empty.
 */
export function extractText(field?: AlertText): string | null {
  if (!field?.translation?.length) return null;
  const en = field.translation.find((t) => t.language === "en");
  return (en ?? field.translation[0]).text ?? null;
}

/**
 * Strip AT's verbose schedule-time bracket from alert header or description text.
 * AT appends " [Schedule Start: DD-MM-YYYY HH:MM:SS - Schedule End: ...]" which
 * is redundant when the `active_period` Unix timestamps are shown separately.
 * @param text - Raw alert text from the AT feed.
 * @returns Text with the bracket suffix removed and whitespace trimmed.
 */
export function cleanAlertHeader(text: string): string {
  return text.replace(/\s*\[Schedule Start:.*?\]\s*$/i, "").trim();
}

/**
 * Normalises the raw AT GTFS-RT service alerts response (handles the legacy
 * `response` envelope and maps `entity` > `alert` to typed {@link ServiceAlert} objects).
 * @param raw - Arbitrary JSON from the alerts endpoint.
 * @returns Normalised {@link AtServiceAlerts}.
 */
export function toServiceAlerts(raw: unknown): AtServiceAlerts {
  const root = isObj(raw) && isObj(raw.response) ? raw.response : raw;
  const entities: unknown[] = isObj(root) && Array.isArray(root.entity) ? root.entity : [];

  const alerts: ServiceAlert[] = [];
  for (const e of entities) {
    if (!isObj(e)) continue;
    const a = isObj(e.alert) ? e.alert : null;
    if (!a) continue;

    // Ids are usually strings; numeric ids still convert, but anything else
    // (objects, null) falls back to "" rather than "[object Object]".
    const id = typeof e.id === "string" ? e.id : typeof e.id === "number" ? String(e.id) : "";

    const active_period = Array.isArray(a.active_period)
      ? (a.active_period as unknown[]).filter(isObj).map((p) => ({
          start: typeof p.start === "number" ? p.start : undefined,
          end: typeof p.end === "number" ? p.end : undefined,
        }))
      : [];

    const informed_entity = Array.isArray(a.informed_entity)
      ? (a.informed_entity as unknown[]).filter(isObj).map((ie) => ({
          agency_id: typeof ie.agency_id === "string" ? ie.agency_id : undefined,
          route_id: typeof ie.route_id === "string" ? ie.route_id : undefined,
          route_type: typeof ie.route_type === "number" ? ie.route_type : undefined,
          stop_id: typeof ie.stop_id === "string" ? ie.stop_id : undefined,
        }))
      : [];

    alerts.push({
      id,
      active_period,
      informed_entity,
      cause: typeof a.cause === "string" ? a.cause : undefined,
      effect: typeof a.effect === "string" ? a.effect : undefined,
      header_text: isObj(a.header_text) ? (a.header_text as unknown as AlertText) : undefined,
      description_text: isObj(a.description_text)
        ? (a.description_text as unknown as AlertText)
        : undefined,
      url: isObj(a.url) ? (a.url as unknown as AlertText) : undefined,
    });
  }

  const header =
    isObj(root) && isObj(root.header) ? (root.header as { timestamp?: number }) : undefined;

  return { header, alerts };
}

const DEFAULT_ALERTS_URL = "https://api.at.govt.nz/realtime/legacy/servicealerts";

/**
 * Fetch Auckland Transport GTFS-RT service alerts (JSON) with retry logic for
 * 429s and 5xx errors (exponential backoff: 1s, 2s, 4s; max 60s).
 * @param retries - Number of retry attempts (default: 3).
 * @returns Parsed and normalised alerts feed.
 * @throws {Error} If all retries are exhausted or a non-retryable error occurs.
 */
async function fetchAlerts(retries = 3): Promise<AtServiceAlerts> {
  const key = process.env.AT_API_KEY ?? "";
  const url = process.env.AT_ALERTS_URL ?? DEFAULT_ALERTS_URL;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });

      // Retry rate limiting (429) and transient server errors (5xx) with backoff
      if (res.status === 429 || res.status >= 500) {
        const backoffMs = Math.min(60_000, 1000 * Math.pow(2, attempt)); // 1s, 2s, 4s, max 60s
        console.warn(
          `[AT Alerts] ${res.status} ${res.statusText}. Retrying in ${backoffMs}ms... (attempt ${attempt + 1}/${retries + 1})`,
        );
        if (attempt < retries) {
          await sleep(backoffMs);
          continue;
        }
        throw new Error(`AT Alerts API ${res.status} after ${retries + 1} attempts`);
      }

      if (!res.ok) {
        throw new Error(`AT Alerts API ${res.status} ${res.statusText}`);
      }

      const raw: unknown = await res.json();
      return toServiceAlerts(raw);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Retry once on timeout or network errors from the first attempt
      if (
        attempt === 0 &&
        (lastError.name === "TimeoutError" || lastError.message.includes("fetch"))
      ) {
        console.warn(`[AT Alerts] ${lastError.message}. Retrying once...`);
        await sleep(2000);
        continue;
      }

      throw lastError;
    }
  }

  throw lastError || new Error("AT Alerts fetch failed");
}

/**
 * Returns true when `alert` is active at `now`.
 * An alert with an empty `active_period` array is indefinitely active per the GTFS-RT spec.
 * @param alert - The alert to check.
 * @param now - Point in time to test (defaults to the current time).
 * @returns True when the alert is active at `now`.
 */
export function isAlertActive(alert: ServiceAlert, now: Date = new Date()): boolean {
  if (alert.active_period.length === 0) return true;
  const ts = Math.floor(now.getTime() / 1000);
  return alert.active_period.some((p) => {
    const start = p.start ?? -Infinity;
    const end = p.end ?? Infinity;
    return ts >= start && ts <= end;
  });
}

/**
 * Cached snapshot of all currently-active service alerts (300s TTL). AT
 * operators enter alerts manually so sub-minute freshness adds no value.
 * The longer window keeps alert AT API calls at ~2,000/week - well within
 * the 35,000/week quota when combined with vehicle and ingest traffic.
 * @returns Active {@link ServiceAlert} array.
 */
export async function getServiceAlerts(): Promise<ServiceAlert[]> {
  return unstable_cache(
    async () => {
      const feed = await fetchAlerts();
      return feed.alerts.filter((a) => isAlertActive(a));
    },
    ["service-alerts"],
    { revalidate: 300 },
  )();
}

/**
 * Returns alerts that affect at least one of the given route ids. The feed's
 * `informed_entity.route_id` carries AT's GTFS feed-version suffix (e.g.
 * "NX1-202409") while callers pass version-stripped slugs, so both sides are
 * normalised through {@link routeSlug} before comparing.
 * @param alerts - Pool of alerts to filter.
 * @param routeIds - Route ids or slugs to match against informed entities.
 * @returns Alerts that affect at least one of the given routes.
 */
export function alertsForRoute(alerts: ServiceAlert[], routeIds: string[]): ServiceAlert[] {
  const set = new Set(routeIds.map(routeSlug));
  return alerts.filter((a) =>
    a.informed_entity.some((e) => e.route_id !== undefined && set.has(routeSlug(e.route_id))),
  );
}

/**
 * Returns alerts that affect the given stop.
 * @param alerts - Pool of alerts to filter.
 * @param stopId - Stop id to match against informed entities.
 * @returns Alerts that affect the given stop.
 */
export function alertsForStop(alerts: ServiceAlert[], stopId: string): ServiceAlert[] {
  return alerts.filter((a) => a.informed_entity.some((e) => e.stop_id === stopId));
}

/**
 * Returns network-wide alerts: alerts whose informed entities carry no
 * specific route, stop, or route-type constraint. Agency-level entities
 * (agency_id only) are permitted because an agency-level alert genuinely
 * affects the entire network. Alerts with `route_id`, `route_type`, or
 * `stop_id` on ANY entity are route/mode/stop-level and belong on those
 * pages, not the home-page banner.
 * @param alerts - Pool of alerts to filter.
 * @returns Alerts with no route, stop, or route-type constraints.
 */
export function networkWideAlerts(alerts: ServiceAlert[]): ServiceAlert[] {
  return alerts.filter((a) =>
    a.informed_entity.every((e) => !e.route_id && e.route_type == null && !e.stop_id),
  );
}
