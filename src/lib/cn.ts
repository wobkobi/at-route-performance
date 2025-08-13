/**
 * @file cn.ts
 * @description
 * Utility to merge Tailwind CSS class names with intelligent deduplication.
 * Combines multiple class inputs, resolves conflicts, and returns a single string.
 */

import clsx from "clsx";
import { type ClassNameValue, twMerge } from "tailwind-merge";

/**
 * Conditionally combine class names and merge Tailwind utilities.
 * @param inputs - List of class name values (strings, arrays, objects).
 * @returns The merged className string with no conflicting Tailwind classes.
 */
function cn(...inputs: ClassNameValue[]): string {
  // clsx handles conditional joins, then twMerge deduplicates and resolves Tailwind conflicts
  return twMerge(clsx(inputs));
}

export default cn;
