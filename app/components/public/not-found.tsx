import { useTranslation } from "react-i18next";
import { Link } from "react-router";

// Shared 404 body for public-tier detail pages (organization / person /
// position). Each detail route catches a thrown 404 Response and renders
// this via its own `ErrorBoundary` export so the shape is consistent.

export type PublicDetailKind = "org" | "person" | "position";

const BACK_ROUTES: Record<PublicDetailKind, string> = {
  org: "/public/directory/organizations",
  person: "/public/directory/people",
  position: "/public/directory/organizations",
};

const I18N_KEYS: Record<PublicDetailKind, { title: string; help: string; back: string }> = {
  org: {
    title: "orgDetail.notFound",
    help: "orgDetail.notFoundHelp",
    back: "orgDetail.backToOrgs",
  },
  person: {
    title: "personDetail.notFound",
    help: "personDetail.notFoundHelp",
    back: "personDetail.backToPeople",
  },
  position: {
    title: "positionDetail.notFound",
    help: "positionDetail.notFoundHelp",
    back: "positionDetail.backToOrgs",
  },
};

export function PublicDetailNotFound({ kind }: { kind: PublicDetailKind }) {
  const { t } = useTranslation("directory-public");
  const keys = I18N_KEYS[kind];
  return (
    <div className="space-y-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">{t(keys.title)}</h1>
      <p className="text-muted-foreground text-sm">{t(keys.help)}</p>
      <Link to={BACK_ROUTES[kind]} className="text-primary inline-block text-sm hover:underline">
        {t(keys.back)}
      </Link>
    </div>
  );
}
