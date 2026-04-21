import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { initI18n } from "~/utils/i18n";

// Initialise i18next before hydration. The language is picked up from the
// `i18n_lang` cookie or the browser's Accept-Language header.
initI18n();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
