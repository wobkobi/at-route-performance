// src/app/api/og/card-layout.tsx
// The card's drawing: the shared frame and the two body layouts. Satori reads
// no CSS and no Tailwind, so every colour here is the hex its token stands for
// in globals.css, and every box is an inline-styled flex container.

import { brandColour, modeGlyph } from "@/components/ModeIcon";
import { formatDuration } from "@/lib/format";
import { dayVerdict, VERDICT_BANDS, verdictIndex, type VerdictBand } from "@/lib/verdict";
import type { FleetSummary } from "@/types/dashboard";
import type { JSX, ReactElement, ReactNode } from "react";

/** The brand palette, as hex. */
const INK = "#001930";
export const MUTED = "#667583";
const BORDER = "#d1d6da";
const SURFACE = "#ffffff";
const OCEAN = "#001930";
const SHORE = "#0073bd";

/**
 * Each text or fill class a card figure can carry, as the hex it stands for.
 * Early is darkened from the site's `#95c11f`, which is about 1.9:1 on white;
 * the figure always carries its word ("2m early"), so the colour only adds.
 */
const TONE_HEX: Record<string, string> = {
  "text-at-ontime": "#0073bd",
  "text-at-ink": INK,
  "text-at-late": "#de0a2b",
  "text-at-early": "#5b7a12",
  "text-at-muted": MUTED,
  "bg-at-ontime": "#0073bd",
  "bg-at-ink": INK,
  "bg-at-late": "#de0a2b",
};

/** Each {@link modeGlyph} fallback colour class as its hex. */
const GLYPH_HEX: Record<string, string> = {
  "text-at-disruption": "#ca0076",
  "text-at-cosmic": "#773581",
  "text-at-greeny-bluey": "#009985",
  "text-at-shore": SHORE,
  "text-at-shore-light": "#00a7e5",
  "text-link-city": "#ff0328",
  "text-link-inner": "#6cbe54",
  "text-link-outer": "#f9a22e",
  "text-link-airport": "#fdbb2a",
  "text-link-tamaki": "#0095cd",
  "text-link-waiheke": "#7fcfd6",
};

/**
 * A tone class as hex, falling back to ink for one the card does not know.
 * @param cls - A `text-at-*` or `bg-at-*` class.
 * @returns The hex colour.
 */
export function toneHex(cls: string): string {
  return TONE_HEX[cls] ?? INK;
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
export function CardFrame({
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
 * The muted line a card shows in place of a figure it has no data for.
 * @param props - Props.
 * @param props.size - Font size in px.
 * @returns The line.
 */
function NotEnoughData({ size }: { size: number }): JSX.Element {
  return (
    <div style={{ display: "flex", marginTop: 40, fontSize: size, fontWeight: 900, color: MUTED }}>
      Not enough data
    </div>
  );
}

/**
 * Layout A: the verdict word, its five-rung meter and the figures behind it.
 * @param props - Props.
 * @param props.summary - The window's figures.
 * @returns The card body.
 */
export function VerdictBody({ summary }: { summary: FleetSummary }): JSX.Element {
  const band: VerdictBand | null = dayVerdict(summary.on_time_pct);
  if (!band || summary.on_time_pct === null) return <NotEnoughData size={110} />;
  const rung = verdictIndex(band);
  const fill = toneHex(band.barClass);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          fontSize: 172,
          fontWeight: 900,
          lineHeight: 1,
          marginTop: 28,
          color: toneHex(band.toneClass),
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

/** The route a subject card's badge is drawn for. */
export interface GlyphRoute {
  mode: string;
  shortName: string | null;
  longName: string | null;
  colour?: string | null;
}

/**
 * A route's mode glyph as inline SVG, in the colour the site's icon uses. The
 * react-icons component reads a React context, which Satori cannot run, so it
 * is called once for its element and only the SVG paths inside are drawn.
 * @param props - Props.
 * @param props.route - The route.
 * @param props.size - Edge length in px.
 * @returns The glyph.
 */
function Glyph({ route, size }: { route: GlyphRoute; size: number }): JSX.Element {
  const { Icon, colourClass } = modeGlyph(route.mode, route.shortName, route.longName);
  const fill = brandColour(route.colour) ?? GLYPH_HEX[colourClass] ?? SHORE;
  const el = Icon({}) as ReactElement<{ attr?: { viewBox?: string }; children?: ReactNode }>;
  return (
    <svg viewBox={el.props.attr?.viewBox ?? "0 0 512 512"} width={size} height={size} fill={fill}>
      {el.props.children}
    </svg>
  );
}

/** What layout B shows under the eyebrow. */
export interface SubjectBodyProps {
  /** The route whose glyph leads the name, or null for a stop. */
  route: GlyphRoute | null;
  /**
   * The subject's name: the route number, or the stop's name. Null on a card
   * whose eyebrow already names its subject (a list page, an empty board), which
   * then leads with the hero.
   */
  name: string | null;
  /** A second name line: the line's name, or the run's destination. */
  subname: string | null;
  /** The hero figure and its colour class, or null when there is no data. */
  hero: { text: string; toneClass: string } | null;
  /** Supporting lines under the hero, the first in ink and the rest muted. */
  lines: string[];
}

/**
 * Layout B: a route badge and name, then one hero figure in its colour, then
 * the lines that say what the figure is.
 * @param props - See {@link SubjectBodyProps}.
 * @param props.route - The route whose glyph leads the name, or null.
 * @param props.name - The subject's name.
 * @param props.subname - A second name line, or null.
 * @param props.hero - The hero figure, or null for no data.
 * @param props.lines - The supporting lines.
 * @returns The card body.
 */
export function SubjectBody({ route, name, subname, hero, lines }: SubjectBodyProps): JSX.Element {
  // A long stop name or a long hero phrase steps down a size rather than clip.
  const nameSize = name && name.length > 28 ? 48 : 60;
  const heroSize = hero && hero.text.length > 12 ? 92 : 116;
  // Children as an array rather than fragments: Satori gives an empty fragment
  // the flex gap too, so a missing glyph or name row would still leave space.
  const head =
    name === null
      ? []
      : [
          <div key="name" style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 24 }}>
            {[
              ...(route ? [<Glyph key="glyph" route={route} size={nameSize} />] : []),
              <div key="name" style={{ fontSize: nameSize, fontWeight: 900, lineHeight: 1.1 }}>
                {name}
              </div>,
            ]}
          </div>,
          <div key="subname" style={{ fontSize: 30, marginTop: 6, color: MUTED }}>
            {subname ?? ""}
          </div>,
        ];
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {head}
      {hero ? (
        <div
          style={{
            fontSize: heroSize,
            fontWeight: 900,
            lineHeight: 1,
            marginTop: name === null ? 40 : 20,
            color: toneHex(hero.toneClass),
          }}
        >
          {hero.text}
        </div>
      ) : (
        <NotEnoughData size={92} />
      )}
      {lines.map((line, i) => (
        <div
          key={line}
          style={{
            fontSize: i === 0 ? 34 : 28,
            marginTop: i === 0 ? 20 : 6,
            color: i === 0 ? INK : MUTED,
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}
