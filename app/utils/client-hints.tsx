/**
 * This file contains utilities for using client hints for user preference which
 * are needed by the server, but are only known by the browser.
 */

import * as React from "react";
import { useRevalidator } from "react-router";
import { colorSchemeClientHint, subscribeToSchemeChange } from "./color-scheme";
import { getHintUtils } from "./hints";
import { useOptionalRequestInfo, useRequestInfo } from "./request-info";
import { timeZoneClientHint } from "./time-zone";

const hintsUtils = getHintUtils({
  theme: colorSchemeClientHint,
  timeZone: timeZoneClientHint,
  // add other hints here
});

type Hints = {
  theme: "dark" | "light";
  timeZone: string;
};

export const { getHints }: { getHints: (request?: Request) => Hints } = hintsUtils;

/**
 * @returns an object with the client hints and their values
 */
export function useHints() {
  const requestInfo = useRequestInfo();
  return requestInfo.hints;
}

export function useOptionalHints() {
  const requestInfo = useOptionalRequestInfo();
  return requestInfo?.hints;
}

/**
 * @returns inline script element that checks for client hints and sets cookies
 * if they are not set then reloads the page if any cookie was set to an
 * inaccurate value.
 */
export function ClientHintCheck({ nonce }: { nonce: string }) {
  const { revalidate } = useRevalidator();
  React.useEffect(() => subscribeToSchemeChange(() => revalidate()), [revalidate]);

  return (
    <script
      nonce={nonce}
      dangerouslySetInnerHTML={{
        __html: hintsUtils.getClientHintCheckScript(),
      }}
    />
  );
}
