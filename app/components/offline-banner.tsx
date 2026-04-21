import { WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOnlineStatus } from "~/hooks/use-online-status";

export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const { t } = useTranslation("pwa");

  if (isOnline) return null;

  return (
    <div className="fixed right-0 bottom-0 left-0 z-50 bg-yellow-500 px-4 py-2 text-center text-sm font-medium text-yellow-950">
      <WifiOff className="mr-2 inline h-4 w-4" />
      {t("offlineBanner")}
    </div>
  );
}
