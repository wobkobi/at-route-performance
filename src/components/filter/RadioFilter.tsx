"use client";
// src/components/filter/RadioFilter.tsx
// A filter box that takes one choice, in two forms: RadioFilter for a choice
// held in component state, UrlRadioFilter for one held in a query param.

import { FilterMenu, FilterOption } from "@/components/filter/FilterMenu";
import { buildHref } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useId, type JSX } from "react";

/** One choice in a {@link RadioFilter}. */
export interface RadioOption<K> {
  /** The choice's value. */
  key: K;
  /** Its label in the list, and on the box once chosen. */
  label: string;
  /** Border, fill and text for the box while this is chosen, for a coloured choice. */
  activeClass?: string;
}

/** Props for {@link RadioFilter}. */
export interface RadioFilterProps<K> {
  /** The filter's name on the box. */
  label: string;
  /** The choices, the default first. */
  options: readonly RadioOption<K>[];
  /** The chosen value. */
  value: K;
  /** The value the reset goes back to; the box shows no choice while it holds. */
  defaultKey: K;
  /** Choose a value. */
  onChange: (key: K) => void;
  /** The box's word for the choice, when not the option's label. */
  summary?: (key: K) => string | null;
}

/**
 * A filter box whose list is one radio group. While the default holds, the box
 * shows only its name; otherwise it names the choice and offers a reset.
 * @param props - Component props.
 * @param props.label - The filter's name.
 * @param props.options - The choices.
 * @param props.value - The chosen value.
 * @param props.defaultKey - The reset value.
 * @param props.onChange - Choose a value.
 * @param props.summary - The box's word for a choice (optional).
 * @returns The filter box.
 */
export function RadioFilter<K>({
  label,
  options,
  value,
  defaultKey,
  onChange,
  summary,
}: RadioFilterProps<K>): JSX.Element {
  const name = useId();
  const current = options.find((o) => o.key === value);
  const word = value === defaultKey ? null : summary ? summary(value) : (current?.label ?? null);
  return (
    <FilterMenu
      label={label}
      summary={word}
      onReset={() => onChange(defaultKey)}
      activeClass={current?.activeClass}
    >
      {options.map((o) => (
        <FilterOption
          key={o.label}
          type="radio"
          name={name}
          checked={value === o.key}
          onChange={() => onChange(o.key)}
        >
          {o.label}
        </FilterOption>
      ))}
    </FilterMenu>
  );
}

/** Props for {@link UrlRadioFilter}. */
export interface UrlRadioFilterProps<K> extends Omit<RadioFilterProps<K>, "onChange"> {
  /** The query param the choice is written to. */
  param: string;
  /** The param's value for a choice; the key itself by default, and none for null. */
  toParam?: (key: K) => string | undefined;
  /** Page path the choices navigate to. */
  basePath: string;
  /** Query params to keep on the way. */
  preservedParams: Record<string, string>;
}

/**
 * A {@link RadioFilter} whose choice lives in the URL: picking navigates to the
 * same page with `param` set and the other params kept. `scroll={false}`, since
 * the reader is narrowing what they are already looking at.
 * @param props - Component props.
 * @param props.param - The query param.
 * @param props.toParam - The param's value for a choice.
 * @param props.basePath - Page path the choices navigate to.
 * @param props.preservedParams - Query params to keep.
 * @returns The filter box.
 */
export function UrlRadioFilter<K>({
  param,
  toParam,
  basePath,
  preservedParams,
  ...rest
}: UrlRadioFilterProps<K>): JSX.Element {
  const router = useRouter();
  /**
   * Navigate to the page with the choice applied.
   * @param key - The chosen value.
   */
  const choose = (key: K): void => {
    const raw = toParam ? toParam(key) : key == null ? undefined : String(key);
    router.push(buildHref(basePath, { ...preservedParams, [param]: raw }), { scroll: false });
  };
  return <RadioFilter {...rest} onChange={choose} />;
}
