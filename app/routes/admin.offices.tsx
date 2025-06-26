import { data } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { requireAdminUser } from "~/lib/auth.server";
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
  await requireAdminUser(request);

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
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>All Offices</CardTitle>
          <CardDescription>
            Complete list of office locations with staff counts
          </CardDescription>
        </CardHeader>
        <CardContent>
          {offices.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No offices found. Run a sync to populate office data.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Office Name</TableHead>
                  <TableHead className="text-right">Staff Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offices.map((office) => (
                  <TableRow key={office.id}>
                    <TableCell className="font-medium">{office.name}</TableCell>
                    <TableCell className="text-right font-semibold text-blue-600">
                      {office._count.staff}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
