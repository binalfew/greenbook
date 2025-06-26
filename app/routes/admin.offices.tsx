import { data } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { requireUser } from "~/lib/auth.server";
import prisma from "~/lib/prisma";
import type { Route } from "./+types/admin.offices";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Offices - Greenbook" },
    {
      name: "description",
      content: "View office locations and their staff",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);

  try {
    const offices = await prisma.office.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { staff: true },
        },
      },
    });

    return data({
      offices,
      summary: {
        totalOffices: offices.length,
        totalStaff: offices.reduce(
          (sum, office) => sum + office._count.staff,
          0
        ),
      },
    });
  } catch (error) {
    console.error("Error loading offices data:", error);
    return data({
      offices: [],
      summary: {
        totalOffices: 0,
        totalStaff: 0,
      },
    });
  }
}

export default function AdminOffices({ loaderData }: Route.ComponentProps) {
  const { offices, summary } = loaderData;

  return (
    <div className="container mx-auto p-6 space-y-8">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Offices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalOffices}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Staff</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalStaff}</div>
          </CardContent>
        </Card>
      </div>

      {/* Offices List */}
      <Card>
        <CardHeader>
          <CardTitle>Office Locations</CardTitle>
          <CardDescription>
            Office locations and their staff counts
          </CardDescription>
        </CardHeader>
        <CardContent>
          {offices.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No offices found. Run a sync to populate office data.
            </p>
          ) : (
            <div className="space-y-4">
              {offices.map((office) => (
                <div key={office.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">{office.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        Created:{" "}
                        {new Date(office.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-blue-600">
                        {office._count.staff}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        staff members
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
