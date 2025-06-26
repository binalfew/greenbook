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
import { requireUser } from "~/lib/auth.server";
import prisma from "~/lib/prisma";
import type { Route } from "./+types/admin.departments";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Departments - Greenbook" },
    {
      name: "description",
      content: "View departmental structure and staff distribution",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);

  try {
    const departments = await prisma.department.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { staff: true },
        },
      },
    });

    return data({
      departments,
      summary: {
        totalDepartments: departments.length,
        totalStaff: departments.reduce(
          (sum, dept) => sum + dept._count.staff,
          0
        ),
      },
    });
  } catch (error) {
    console.error("Error loading departments data:", error);
    return data({
      departments: [],
      summary: {
        totalDepartments: 0,
        totalStaff: 0,
      },
    });
  }
}

export default function AdminDepartments({ loaderData }: Route.ComponentProps) {
  const { departments, summary } = loaderData;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>All Departments</CardTitle>
          <CardDescription>
            Complete list of departments with staff counts
          </CardDescription>
        </CardHeader>
        <CardContent>
          {departments.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No departments found
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department Name</TableHead>
                  <TableHead className="text-right">Staff Count</TableHead>
                  <TableHead className="text-right">Percentage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.map((department) => {
                  const percentage =
                    summary.totalStaff > 0
                      ? (
                          (department._count.staff / summary.totalStaff) *
                          100
                        ).toFixed(1)
                      : "0";

                  return (
                    <TableRow key={department.id}>
                      <TableCell className="font-medium">
                        {department.name}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-green-600">
                        {department._count.staff}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {percentage}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
