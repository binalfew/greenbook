import { useTranslation } from "react-i18next";

export default function OfflinePage() {
  const { t } = useTranslation("pwa");

  return (
    <div className="bg-background flex min-h-screen items-center justify-center">
      <div className="space-y-4 p-8 text-center">
        <div className="text-6xl" aria-hidden="true">
          &#x1F4E1;
        </div>
        <h1 className="text-foreground text-2xl font-bold">{t("offlineTitle")}</h1>
        <p className="text-muted-foreground max-w-md">{t("offlineBody")}</p>
        <button
          onClick={() => window.location.reload()}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2"
        >
          {t("tryAgain")}
        </button>
      </div>
    </div>
  );
}
