import { data } from "react-router";
import { ChangeDetail } from "../+shared/change-detail";
import { loadChangeDetail } from "../+shared/change-detail.server";
import type { Route } from "./+types/$changeId._layout";

export const handle = { breadcrumb: "Submission" };

export async function loader({ request, params }: Route.LoaderArgs) {
  return data(await loadChangeDetail(request, params, "author"));
}

export default function SubmissionDetailLayout({ loaderData, params }: Route.ComponentProps) {
  return <ChangeDetail detail={loaderData} tenant={params.tenant} />;
}
