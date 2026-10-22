import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/*
  cn() combines class names safely.
  clsx:    lets you write conditions, e.g. cn("px-4", isActive && "bg-primary")
  twMerge: resolves Tailwind conflicts, so cn("px-4", "px-6") gives "px-6"
           instead of both classes fighting each other.
  Every UI component uses this so callers can override its default styles.
*/
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
