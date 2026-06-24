import type { ModeStat } from "@/types/dashboard";
import type { JSX } from "react";

/** Props for {@link ModeBreakdown}. */
export interface ModeBreakdownProps {
  /** Per-mode rows. */
  modes: ModeStat[];
}

const MODE_LABEL: Record<ModeStat["mode"], string> = { BUS: "Bus", TRAIN: "Train", FERRY: "Ferry" };

/**
 * Render on-time bars per transport mode.
 * @param props - Component props.
 * @param props.modes - Per-mode aggregates.
 * @returns The mode-breakdown element.
 */
export function ModeBreakdown({ modes }: ModeBreakdownProps): JSX.Element {
  const order: ModeStat["mode"][] = ["BUS", "TRAIN", "FERRY"];
  const sorted = order
    .map((m) => modes.find((x) => x.mode === m))
    .filter((x): x is ModeStat => Boolean(x));
  return (
    <section className="border border-at-border bg-at-surface p-4">
      <h2 className="mb-3 text-base font-ultra tracking-zero text-at-ink">By mode</h2>
      <div className="space-y-2">
        {sorted.map((m) => {
          const pct = m.on_time_pct ?? 0;
          return (
            <div key={m.mode} className="flex items-center gap-3 text-sm">
              <span className="w-12 shrink-0 text-at-muted">{MODE_LABEL[m.mode]}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-at-bg">
                <div className="h-full rounded-full bg-at-ontime" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-12 shrink-0 text-right font-semibold tabular-nums">
                {m.on_time_pct === null ? "—" : `${pct.toFixed(0)}%`}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
