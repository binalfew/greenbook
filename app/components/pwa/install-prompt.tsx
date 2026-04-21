import { Download, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { cn } from "~/utils/misc";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const AUTO_DISMISS_MS = 15_000;

export function InstallPrompt() {
  const { t } = useTranslation("pwa");
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      setExiting(false);
    }, 300);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [visible, dismiss]);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    dismiss();
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
      <p className="pr-6 text-sm font-medium">{t("installTitle")}</p>
      <p className="text-muted-foreground mt-1 text-xs">{t("installSubtitle")}</p>
      <div className="mt-3 flex gap-2">
        <Button variant="outline" size="sm" onClick={dismiss}>
          {t("notNow")}
        </Button>
        <Button size="sm" onClick={handleInstall}>
          <Download className="mr-1.5 size-3.5" />
          {t("install")}
        </Button>
      </div>
    </div>
  );
}
