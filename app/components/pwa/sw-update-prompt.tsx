import { RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { cn } from "~/utils/misc";

const AUTO_DISMISS_MS = 30_000;

export function SwUpdatePrompt() {
  const { t } = useTranslation("pwa");
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      setExiting(false);
    }, 300);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.ready.then((reg) => {
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            setRegistration(reg);
            setVisible(true);
          }
        });
      });
    });
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [visible, dismiss]);

  function handleUpdate() {
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    dismiss();
    window.location.reload();
  }

  if (!visible) return null;

  return (
    <div
      className={cn(
        "bg-background fixed right-4 bottom-4 z-50 w-80 rounded-lg border p-4 shadow-lg transition-all duration-300",
        exiting ? "translate-y-2 opacity-0" : "translate-y-0 opacity-100",
      )}
    >
      <button
        onClick={dismiss}
        className="text-muted-foreground hover:text-foreground absolute top-2 right-2 rounded-sm p-1"
      >
        <X className="size-3.5" />
      </button>
      <p className="pr-6 text-sm font-medium">{t("updateTitle")}</p>
      <p className="text-muted-foreground mt-1 text-xs">{t("updateSubtitle")}</p>
      <div className="mt-3 flex gap-2">
        <Button variant="outline" size="sm" onClick={dismiss}>
          {t("later")}
        </Button>
        <Button size="sm" onClick={handleUpdate}>
          <RefreshCw className="mr-1.5 size-3.5" />
          {t("updateNow")}
        </Button>
      </div>
    </div>
  );
}
