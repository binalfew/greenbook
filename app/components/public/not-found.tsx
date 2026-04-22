import { useTranslation } from "react-i18next";
import { Link } from "react-router";

// Shared 404 body for the public person detail route. Its ErrorBoundary
// renders this when `publicGetPerson` returns null (not published, wrong
// id, etc.).

export type PublicDetailKind = "person";

export function PublicDetailNotFound({ kind: _kind }: { kind: PublicDetailKind }) {
  const { t } = useTranslation("directory-public");
  return (
    <div className="space-y-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">{t("personDetail.notFound")}</h1>
      <p className="text-muted-foreground text-sm">{t("personDetail.notFoundHelp")}</p>
      <Link to="/" className="text-primary inline-block text-sm hover:underline">
        {t("personDetail.backToPeople")}
      </Link>
    </div>
  );
}
