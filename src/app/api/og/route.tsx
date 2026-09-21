// src/app/api/og/route.tsx
// The shared-link card: a 1200x630 PNG describing exactly the view a link was
// shared from - its day or period, its filters, its route, run or stop -
// rather than a generic site card. Pages point at it from generateMetadata
// with the card's query built by lib/og.ts, which also parses it here.
//
// A card never fails: an unknown card, a bad query, a missing route or a
// database error still returns a branded 200 card, because a failed og:image
// shows nothing at all in a feed. Satori reads no CSS, so the brand fonts and
// logo are read from disk and handed in.
//
// No maxDuration or runtime here: any route-level config splits this route into
// its own function bundle, each carrying its own copy of the Prisma engine.

import {
  CARD_HEIGHT,
  CARD_WIDTH,
  cardCacheControl,
  cardFilterLabel,
  parseCardQuery,
} from "@/lib/og";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { JSX } from "react";
import {
  homeCardData,
  routeCardData,
  stopCardData,
  tripCardData,
  type HomeCardData,
  type SubjectCardData,
} from "./card-data";
import { CardFrame, SubjectBody, VerdictBody } from "./card-layout";

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
 * GET /api/og?card=home|route|trip|stop&... - the card for a shared page.
 * @param req - The request; its query names the card and the view.
 * @returns The PNG, always 200.
 */
export async function GET(req: NextRequest): Promise<ImageResponse> {
  const { logo } = await loadAssets();
  const card = parseCardQuery(req.nextUrl.searchParams);
  let home: HomeCardData | null = null;
  let subject: SubjectCardData | null = null;
  try {
    if (card.kind === "home") home = await homeCardData(card);
    else if (card.kind === "route") subject = await routeCardData(card);
    else if (card.kind === "trip") subject = await tripCardData(card);
    else subject = await stopCardData(card);
  } catch (err) {
    console.error("[og] card data failed, sending the plain card", err);
  }
  if (home && card.kind === "home") {
    const filter = cardFilterLabel(card.mode, card.includeSchool);
    const eyebrow = ["Network", home.when, filter].filter(Boolean).join(" - ");
    return render(
      <CardFrame eyebrow={eyebrow} logo={logo}>
        <VerdictBody summary={home.summary} />
      </CardFrame>,
      cardCacheControl(home.complete),
    );
  }
  if (subject) {
    return render(
      <CardFrame eyebrow={subject.eyebrow} logo={logo}>
        <SubjectBody {...subject.body} />
      </CardFrame>,
      cardCacheControl(subject.complete),
    );
  }
  return render(
    <CardFrame eyebrow="Auckland's buses, trains and ferries" logo={logo}>
      <div style={{ display: "flex", marginTop: 40, fontSize: 96, fontWeight: 900 }}>
        How bad was it?
      </div>
    </CardFrame>,
    cardCacheControl(false),
  );
}
