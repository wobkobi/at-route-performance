// src/app/api/og/route.tsx
// The shared-link card: a 1200x630 PNG describing exactly the view a link was
// shared from - its day or period, its mode and school filters - rather than a
// generic site card. Pages point at it from generateMetadata with the card's
// query built by lib/og.ts, which also parses it here.
//
// A card never fails: an unknown card, a bad query or a database error still
// returns a branded 200 card, because a failed og:image shows nothing at all in
// a feed. Satori reads no CSS, so the brand fonts and logo are read from disk
// and handed in.
//
// No maxDuration or runtime here: any route-level config splits this route into
// its own function bundle, each carrying its own copy of the Prisma engine.

import { getEarliestDataDay, getLatestEventDate, getRankings, TODAY_REVALIDATE } from "@/lib/data";
import { formatDuration } from "@/lib/format";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  cardCacheControl,
  cardFilterLabel,
  monthLabel,
  parseHomeCardQuery,
  type HomeCard,
} from "@/lib/og";
import { ON_TIME_LATE_SEC } from "@/lib/on-time";
import { maybeFallbackDay } from "@/lib/page-nav";
import { periodRangeNav } from "@/lib/range-page";
import { MIN_BOARD_EVENTS, summariseRows, visibleRows } from "@/lib/rankings";
import {
  nzMonthKey,
  nzServiceDayRange,
  nzServiceDayString,
  serviceDatesInRange,
  serviceDayLabel,
} from "@/lib/time";
import { dayVerdict, VERDICT_BANDS, verdictIndex, type VerdictBand } from "@/lib/verdict";
import type { FleetSummary } from "@/types/dashboard";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { JSX } from "react";

/** The brand palette, as hex: Satori takes no Tailwind classes. */
const INK = "#001930";
const MUTED = "#667583";
const BORDER = "#d1d6da";
const SURFACE = "#ffffff";
const OCEAN = "#001930";

/** Each verdict colour class as the hex it stands for. */
const TONE_HEX: Record<string, string> = {
  "text-at-ontime": "#0073bd",
  "text-at-ink": INK,
  "text-at-late": "#de0a2b",
  "bg-at-ontime": "#0073bd",
  "bg-at-ink": INK,
  "bg-at-late": "#de0a2b",
};

/** Brand assets, read once per instance and shared by every card it renders. */
let assets: Promise<{ book: Buffer; ultra: Buffer; logo: string }> | null = null;

/**
 * Load the Gotham Narrow faces and the white AT logo. The paths are literal
 * joins on the project root so output tracing copies the files into the bundle.
 * @returns The two font files and the logo as a data URL.
 */
function loadAssets(): Promise<{ book: Buffer; ultra: Buffer; logo: string }> {
  assets ??= Promise.all([
    readFile(join(process.cwd(), "public/source/fonts/gotham-narrow/gotham-narrow-book.otf")),
    readFile(join(process.cwd(), "public/source/fonts/gotham-narrow/gotham-narrow-ultra.otf")),
    readFile(join(process.cwd(), "public/source/logos/at-logo-white.png")),
  ]).then(([book, ultra, logo]) => ({
    book,
    ultra,
    logo: `data:image/png;base64,${logo.toString("base64")}`,
  }));
  return assets;
}

/** What the home card shows once its view is resolved. */
interface HomeCardData {
  /** The period named in the eyebrow: a day, a span of days, or a month. */
  when: string;
  summary: FleetSummary;
  /** Whether the whole period is in the past, so the card can be cached long. */
  complete: boolean;
}

/**
 * Resolve a home card's view the way the home page does: the requested day, or
 * today falling back to the latest full day while today is still too sparse;
 * a week or month anchored on the latest day with data.
 * @param card - The card state.
 * @returns The period label, the figures and whether the period is over.
 */
async function homeCardData(card: HomeCard): Promise<HomeCardData> {
  const today = nzServiceDayString();
  const filter = { mode: card.mode, includeSchool: card.includeSchool };
  if (card.window === "day") {
    let range = nzServiceDayRange(card.day ?? new Date());
    let rows = await getRankings(range, ON_TIME_LATE_SEC, TODAY_REVALIDATE);
    const fallback = await maybeFallbackDay(
      card.day,
      !rows.some((r) => r.events >= MIN_BOARD_EVENTS),
      MIN_BOARD_EVENTS,
    );
    if (fallback) {
      range = nzServiceDayRange(fallback);
      rows = await getRankings(range, ON_TIME_LATE_SEC, TODAY_REVALIDATE);
    }
    const date = nzServiceDayString(range.start);
    return {
      when: serviceDayLabel(date),
      summary: summariseRows(visibleRows(rows, filter)),
      complete: date < today,
    };
  }
  const [latest, earliest] = await Promise.all([getLatestEventDate(), getEarliestDataDay(1)]);
  const anchor = latest ?? new Date();
  const { range } = periodRangeNav("/", card.window, card.period ?? undefined, anchor, earliest);
  const rows = await getRankings(range, ON_TIME_LATE_SEC, TODAY_REVALIDATE);
  // Name the days the figures cover: a week's dates up to today, not beyond.
  const dates = serviceDatesInRange(range);
  const shown = dates.filter((d) => d <= today);
  const first = shown[0] ?? dates[0] ?? today;
  const last = shown.at(-1) ?? today;
  return {
    when:
      card.window === "month"
        ? monthLabel(card.period ?? nzMonthKey(anchor))
        : `${serviceDayLabel(first)} to ${serviceDayLabel(last)}`,
    summary: summariseRows(visibleRows(rows, filter)),
    complete: (dates.at(-1) ?? today) < today,
  };
}

/**
 * The card frame every card shares: the eyebrow over the body on the site's
 * white ground, and the Ocean footer bar with the logo lockup, as on the site.
 * @param props - Frame props.
 * @param props.eyebrow - The uppercase line naming what the card is about.
 * @param props.logo - The logo as a data URL.
 * @param props.children - The card body.
 * @returns The frame.
 */
function CardFrame({
  eyebrow,
  logo,
  children,
}: {
  eyebrow: string;
  logo: string;
  children: JSX.Element | JSX.Element[];
}): JSX.Element {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: SURFACE,
        color: INK,
        fontFamily: "Gotham Narrow",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "56px 64px 0",
        }}
      >
        <div
          style={{
            fontSize: 28,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: MUTED,
          }}
        >
          {eyebrow}
        </div>
        {children}
      </div>
      <div
        style={{
          height: 104,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 64px",
          background: OCEAN,
          color: SURFACE,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain img only */}
          <img src={logo} width={60} height={60} alt="" />
          <div style={{ fontSize: 34, fontWeight: 900 }}>AT Route Performance</div>
        </div>
        <div style={{ fontSize: 20, color: BORDER }}>Independent, not affiliated with AT</div>
      </div>
    </div>
  );
}

/**
 * Layout A: the verdict word, its five-rung meter and the figures behind it.
 * @param props - Props.
 * @param props.summary - The window's figures.
 * @returns The card body.
 */
function VerdictBody({ summary }: { summary: FleetSummary }): JSX.Element {
  const band: VerdictBand | null = dayVerdict(summary.on_time_pct);
  if (!band || summary.on_time_pct === null) {
    return (
      <div style={{ display: "flex", marginTop: 40, fontSize: 110, fontWeight: 900, color: MUTED }}>
        Not enough data
      </div>
    );
  }
  const rung = verdictIndex(band);
  const fill = TONE_HEX[band.barClass] ?? INK;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          fontSize: 172,
          fontWeight: 900,
          lineHeight: 1,
          marginTop: 28,
          color: TONE_HEX[band.toneClass] ?? INK,
        }}
      >
        {band.label}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 28 }}>
        {VERDICT_BANDS.map((b, i) => (
          <div
            key={b.label}
            style={{
              width: 112,
              height: 16,
              borderRadius: 8,
              background: i <= rung ? fill : BORDER,
            }}
          />
        ))}
      </div>
      <div style={{ fontSize: 36, marginTop: 32 }}>
        {`${summary.on_time_pct.toFixed(1)}% of ${summary.events.toLocaleString("en-NZ")} arrivals on time`}
      </div>
      <div style={{ fontSize: 30, marginTop: 8, color: MUTED }}>
        {summary.avg_abs_delay_sec === null
          ? ""
          : `${formatDuration(summary.avg_abs_delay_sec)} off schedule on average`}
      </div>
    </div>
  );
}

/**
 * Render a card element to the PNG response.
 * @param element - The card.
 * @param cacheControl - The Cache-Control header.
 * @returns The image response.
 */
async function render(element: JSX.Element, cacheControl: string): Promise<ImageResponse> {
  const { book, ultra } = await loadAssets();
  return new ImageResponse(element, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: [
      { name: "Gotham Narrow", data: book, weight: 400, style: "normal" },
      { name: "Gotham Narrow", data: ultra, weight: 900, style: "normal" },
    ],
    headers: { "Cache-Control": cacheControl },
  });
}

/**
 * GET /api/og?card=home&... - the card for a shared page.
 * @param req - The request; its query names the card and the view.
 * @returns The PNG, always 200.
 */
export async function GET(req: NextRequest): Promise<ImageResponse> {
  const { logo } = await loadAssets();
  const card = parseHomeCardQuery(req.nextUrl.searchParams);
  let data: HomeCardData | null = null;
  try {
    data = await homeCardData(card);
  } catch (err) {
    console.error("[og] card data failed, sending the plain card", err);
  }
  if (!data) {
    return render(
      <CardFrame eyebrow="Auckland's buses, trains and ferries" logo={logo}>
        <div style={{ display: "flex", marginTop: 40, fontSize: 96, fontWeight: 900 }}>
          How bad was it?
        </div>
      </CardFrame>,
      cardCacheControl(false),
    );
  }
  const filter = cardFilterLabel(card.mode, card.includeSchool);
  const eyebrow = ["Network", data.when, filter].filter(Boolean).join(" - ");
  return render(
    <CardFrame eyebrow={eyebrow} logo={logo}>
      <VerdictBody summary={data.summary} />
    </CardFrame>,
    cardCacheControl(data.complete),
  );
}
