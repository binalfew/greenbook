import { clsx, type ClassValue } from "clsx";
import { useEffect, useMemo, useRef } from "react";
import { useFormAction, useNavigation } from "react-router";
import { useSpinDelay } from "spin-delay";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a period number (YYYYMM) into a readable date string (e.g., "Jan 2024")
 * @param period - The period number in YYYYMM format
 * @returns A formatted string like "Jan 2024" or the original input if invalid
 */
export function formatPeriod(period: number): string {
  // Convert to string and ensure it's 6 digits
  const periodStr = period.toString().padStart(6, "0");

  // Extract year and month
  const year = parseInt(periodStr.substring(0, 4));
  const month = parseInt(periodStr.substring(4, 6));

  // If month is not valid (1-12), return original input
  if (month < 1 || month > 12) {
    return period.toString();
  }

  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  return `${monthNames[month - 1]} ${year}`;
}

/**
 * Returns true if the current navigation is submitting the current route's
 * form. Defaults to the current route's form action and method POST.
 *
 * Defaults state to 'non-idle'
 *
 * NOTE: the default formAction will include query params, but the
 * navigation.formAction will not, so don't use the default formAction if you
 * want to know if a form is submitting without specific query params.
 */
export function useIsPending({
  formAction,
  formMethod = "POST",
  state = "non-idle",
}: {
  formAction?: string;
  formMethod?: "POST" | "GET" | "PUT" | "PATCH" | "DELETE";
  state?: "submitting" | "loading" | "non-idle";
} = {}) {
  const contextualFormAction = useFormAction();
  const navigation = useNavigation();
  const isPendingState =
    state === "non-idle"
      ? navigation.state !== "idle"
      : navigation.state === state;
  return (
    isPendingState &&
    navigation.formAction === (formAction ?? contextualFormAction) &&
    navigation.formMethod === formMethod
  );
}

/**
 * This combines useSpinDelay (from https://npm.im/spin-delay) and useIsPending
 * from our own utilities to give you a nice way to show a loading spinner for
 * a minimum amount of time, even if the request finishes right after the delay.
 *
 * This avoids a flash of loading state regardless of how fast or slow the
 * request is.
 */
export function useDelayedIsPending({
  formAction,
  formMethod,
  delay = 400,
  minDuration = 300,
}: Parameters<typeof useIsPending>[0] &
  Parameters<typeof useSpinDelay>[1] = {}) {
  const isPending = useIsPending({ formAction, formMethod });
  const delayedIsPending = useSpinDelay(isPending, {
    delay,
    minDuration,
  });
  return delayedIsPending;
}

/**
 * Simple debounce implementation
 */
function debounce<Callback extends (...args: Parameters<Callback>) => void>(
  fn: Callback,
  delay: number
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<Callback>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}

/**
 * Debounce a callback function
 */
export function useDebounce<
  Callback extends (...args: Parameters<Callback>) => ReturnType<Callback>
>(callback: Callback, delay: number) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });
  return useMemo(
    () =>
      debounce(
        (...args: Parameters<Callback>) => callbackRef.current(...args),
        delay
      ),
    [delay]
  );
}
