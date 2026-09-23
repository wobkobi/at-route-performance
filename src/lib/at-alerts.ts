// src/lib/at-alerts.ts
// Types, fetchers and filters for AT's GTFS-RT service-alerts feed:
// fetches and normalises alerts (with retry and backoff), resolves the route a
// single-trip alert is about, then selects the ones relevant to a given route, a
// given stop, a given trip, or the whole network, and grades how loudly each
// should be presented.
import { prisma } from "@/lib/db";
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
  /**
   * The one trip a trip-level alert names. AT sends a single-trip cancellation
   * as a trip entity alone, with no route: {@link resolveAlertRoutes} fills the
   * route in from the trip.
   */
  trip_id?: string;
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
  const chosen = en ?? field.translation[0];
  return chosen?.text ?? null;
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

/** How loudly an alert should be presented. */
export type AlertSeverity = "severe" | "info";

/**
 * GTFS-RT `effect` values that stop or substantially reroute a service. These
 * are the ones worth interrupting a reader for; everything else is a notice.
 */
const SEVERE_EFFECTS = new Set([
  "NO_SERVICE",
  "REDUCED_SERVICE",
  "SIGNIFICANT_DELAYS",
  "DETOUR",
  "STOP_MOVED",
]);

/**
 * Alert effects that mean a route is running somewhere other than its usual
 * path, or passing stops it would serve. AT files a skipped stop under any of
 * the first three ("Stop Skipped" alerts come as STOP_MOVED, NO_SERVICE and
 * DETOUR alike), so none of them is read as more specific than the others.
 */
export const REROUTE_EFFECTS: ReadonlySet<string> = new Set([
  "DETOUR",
  "STOP_MOVED",
  "NO_SERVICE",
  "MODIFIED_SERVICE",
]);

/**
 * How loudly to present an alert. The feed mixes line closures with routine
 * notices, and rendering both in the same alarm styling is what teaches people
 * to ignore the bar - so only a service-stopping effect gets the loud treatment.
 * An alert with no `effect` at all is a notice: AT leaves it unset on its
 * general-information entries.
 * @param alert - The alert to classify.
 * @returns "severe" for service-stopping effects, else "info".
 */
export function alertSeverity(alert: ServiceAlert): AlertSeverity {
  return alert.effect && SEVERE_EFFECTS.has(alert.effect) ? "severe" : "info";
}

/**
 * Whether any alert in a set warrants the loud treatment.
 * @param alerts - Alerts to check.
 * @returns True when at least one is severe.
 */
export function hasSevereAlert(alerts: ServiceAlert[]): boolean {
  return alerts.some((a) => alertSeverity(a) === "severe");
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
          trip_id:
            isObj(ie.trip) && typeof ie.trip.trip_id === "string" ? ie.trip.trip_id : undefined,
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

/**
 * A versioned route id as AT writes it into alert text ("Route 195-203"). Only
 * the machine id form matches: a hyphen straight into digits. The prose form
 * ("Route 781 - Cenotaph Road") already carries the short name and is left be.
 */
const ROUTE_ID_IN_TEXT = /\bRoute ([A-Za-z0-9]+-\d+)\b/g;

/**
 * The versioned route ids an alert's header and description name.
 * @param alert - The alert.
 * @returns The ids, in order of first mention, without repeats.
 */
export function routeIdsInText(alert: ServiceAlert): string[] {
  const text = [extractText(alert.header_text), extractText(alert.description_text)].join(" ");
  return [...new Set([...text.matchAll(ROUTE_ID_IN_TEXT)].map((m) => m[1] as string))];
}

/**
 * Rewrite every translation of an alert text field so a versioned route id
 * reads as the route's short name.
 * @param field - The text field, or undefined.
 * @param shortNames - Short name by versioned route id.
 * @returns The rewritten field, or undefined.
 */
function withShortNames(
  field: AlertText | undefined,
  shortNames: ReadonlyMap<string, string>,
): AlertText | undefined {
  if (!field?.translation) return field;
  return {
    ...field,
    translation: field.translation.map((t) => ({
      ...t,
      text: t.text.replace(ROUTE_ID_IN_TEXT, (whole, id: string) => {
        const name = shortNames.get(id);
        return name ? `Route ${name}` : whole;
      }),
    })),
  };
}

/**
 * Resolve the routes an alert is about, and name them the way a rider does.
 *
 * AT sends a single-trip cancellation as a trip entity alone, headed with the
 * route's versioned id ("Service Cancellation for Route 195-203"). With no route
 * on the entity the alert matches no route page and reads as network-wide, and
 * its header shows a feed id no rider knows. Each trip entity takes its route
 * from the trip's metadata; a trip the metadata has not seen yet (a later
 * cancellation on a route already running) takes the route the header names,
 * when that is a real route. The header and description then name every known
 * versioned id by its short name ("Route 195").
 * @param alert - The alert as normalised from the feed.
 * @param tripRoutes - Versioned route id by trip id, from trip metadata.
 * @param shortNames - Short name by versioned route id, for every route the alerts mention.
 * @returns The alert with trip entities routed and its text renamed.
 */
export function resolveAlertRoutes(
  alert: ServiceAlert,
  tripRoutes: ReadonlyMap<string, string>,
  shortNames: ReadonlyMap<string, string>,
): ServiceAlert {
  const named = routeIdsInText(alert).find((id) => shortNames.has(id));
  return {
    ...alert,
    informed_entity: alert.informed_entity.map((e) => {
      if (e.route_id || !e.trip_id) return e;
      const route_id = tripRoutes.get(e.trip_id) ?? named;
      return route_id ? { ...e, route_id } : e;
    }),
    header_text: withShortNames(alert.header_text, shortNames),
    description_text: withShortNames(alert.description_text, shortNames),
  };
}

/**
 * {@link resolveAlertRoutes} over the whole feed, with the two lookups it needs:
 * the route of every unrouted trip entity, and the short name of every route a
 * trip resolves to or the text names. Best-effort: a failed lookup leaves the
 * alerts as the feed sent them, since a trip-level alert is kept off the
 * network-wide banner either way ({@link networkWideAlerts}).
 * @param alerts - The active alerts.
 * @returns The alerts, resolved where the lookups allow.
 */
async function resolveFeedRoutes(alerts: ServiceAlert[]): Promise<ServiceAlert[]> {
  const tripIds = [
    ...new Set(
      alerts.flatMap((a) =>
        a.informed_entity.flatMap((e) => (e.trip_id && !e.route_id ? [e.trip_id] : [])),
      ),
    ),
  ];
  try {
    const metas =
      tripIds.length > 0
        ? await prisma.tripMeta.findMany({
            where: { id: { in: tripIds } },
            select: { id: true, routeId: true },
          })
        : [];
    const tripRoutes = new Map(metas.flatMap((m) => (m.routeId ? [[m.id, m.routeId]] : [])));
    const mentioned = [...new Set([...tripRoutes.values(), ...alerts.flatMap(routeIdsInText)])];
    const routes =
      mentioned.length > 0
        ? await prisma.route.findMany({
            where: { id: { in: mentioned } },
            select: { id: true, shortName: true },
          })
        : [];
    const shortNames = new Map(routes.map((r) => [r.id, r.shortName ?? routeSlug(r.id)]));
    return alerts.map((a) => resolveAlertRoutes(a, tripRoutes, shortNames));
  } catch (err) {
    console.warn("[AT Alerts] Route lookup failed", err instanceof Error ? err.message : err);
    return alerts;
  }
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
 * Cached snapshot of all currently-active service alerts (300s TTL), with each
 * trip-level alert's route resolved ({@link resolveFeedRoutes}). AT operators
 * enter alerts manually so sub-minute freshness adds no value. The longer
 * window keeps alert AT API calls at ~2,000/week - well within the 35,000/week
 * quota when combined with vehicle and ingest traffic.
 * @returns Active {@link ServiceAlert} array.
 */
export async function getServiceAlerts(): Promise<ServiceAlert[]> {
  return unstable_cache(
    async () => {
      const feed = await fetchAlerts();
      return resolveFeedRoutes(feed.alerts.filter((a) => isAlertActive(a)));
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
 * Returns alerts that affect any of the given stops.
 *
 * Takes a list, not a single id, because a train station is one page backed by
 * several GTFS stops. The feed's `informed_entity.stop_id` only ever names a raw
 * platform, so matching a station's own canonical id against it never hits -
 * which left every station page showing no alerts at all, including during a
 * line closure.
 * @param alerts - Pool of alerts to filter.
 * @param stopIds - Raw GTFS stop ids to match against informed entities.
 * @returns Alerts that affect at least one of the given stops.
 */
export function alertsForStop(alerts: ServiceAlert[], stopIds: string[]): ServiceAlert[] {
  const set = new Set(stopIds);
  return alerts.filter((a) =>
    a.informed_entity.some((e) => e.stop_id !== undefined && set.has(e.stop_id)),
  );
}

/**
 * Returns the alerts that apply to one running trip: a route-level alert on its
 * route, or a trip-level alert naming the trip itself. Another trip's alert on
 * the same route is left out - one cancelled run says nothing about the next.
 * @param alerts - Pool of alerts to filter.
 * @param routeId - The versioned route id the trip runs on.
 * @param tripId - The trip.
 * @returns Alerts that apply to the trip.
 */
export function alertsForTrip(
  alerts: readonly ServiceAlert[],
  routeId: string,
  tripId: string,
): ServiceAlert[] {
  return alerts.filter((a) =>
    a.informed_entity.some(
      (e) => e.route_id === routeId && (e.trip_id === undefined || e.trip_id === tripId),
    ),
  );
}

/**
 * Returns network-wide alerts: alerts whose informed entities carry no
 * specific route, stop, trip, or route-type constraint. Agency-level entities
 * (agency_id only) are permitted because an agency-level alert genuinely
 * affects the entire network. Alerts with `route_id`, `route_type`, `stop_id`
 * or `trip_id` on ANY entity are route/mode/stop/trip-level and belong on those
 * pages, not the home-page banner - a trip-level one even when its route could
 * not be resolved.
 * @param alerts - Pool of alerts to filter.
 * @returns Alerts with no route, stop, trip, or route-type constraints.
 */
export function networkWideAlerts(alerts: ServiceAlert[]): ServiceAlert[] {
  return alerts.filter((a) =>
    a.informed_entity.every((e) => !e.route_id && e.route_type == null && !e.stop_id && !e.trip_id),
  );
}
