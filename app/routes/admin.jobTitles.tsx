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
import type { Route } from "./+types/admin.jobTitles";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Job Titles - Greenbook" },
    {
      name: "description",
      content: "View job titles and roles in the organization",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);

  try {
    const jobTitles = await prisma.jobTitle.findMany({
      orderBy: { title: "asc" },
      include: {
        _count: {
          select: { staff: true },
        },
      },
    });

    // Get staff distribution by job title for additional insights
    const staffByJobTitle = await prisma.staff.groupBy({
      by: ["jobTitle"],
      _count: {
        id: true,
      },
      where: {
        accountEnabled: true,
        jobTitle: {
          not: null,
        },
      },
    });

    return data({
      jobTitles,
      staffByJobTitle,
      summary: {
        totalJobTitles: jobTitles.length,
        totalStaff: jobTitles.reduce((sum, job) => sum + job._count.staff, 0),
        averageStaffPerTitle:
          jobTitles.length > 0
            ? Math.round(
                jobTitles.reduce((sum, job) => sum + job._count.staff, 0) /
                  jobTitles.length
              )
            : 0,
        mostCommonTitle:
          jobTitles.length > 0
            ? jobTitles.reduce((max, job) =>
                job._count.staff > max._count.staff ? job : max
              ).title
            : null,
      },
    });
  } catch (error) {
    console.error("Error loading job titles data:", error);
    return data({
      jobTitles: [],
      staffByJobTitle: [],
      summary: {
        totalJobTitles: 0,
        totalStaff: 0,
        averageStaffPerTitle: 0,
        mostCommonTitle: null,
      },
    });
  }
}

export default function AdminJobTitles({ loaderData }: Route.ComponentProps) {
  const { jobTitles, summary } = loaderData;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>All Job Titles</CardTitle>
          <CardDescription>
            Complete list of roles and positions with staff counts
          </CardDescription>
        </CardHeader>
        <CardContent>
          {jobTitles.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No job titles found
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job Title</TableHead>
                  <TableHead className="text-right">Staff Count</TableHead>
                  <TableHead className="text-right">Percentage</TableHead>
                  <TableHead className="text-right">Rank</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobTitles
                  .sort((a, b) => b._count.staff - a._count.staff)
                  .map((jobTitle, index) => {
                    const percentage =
                      summary.totalStaff > 0
                        ? (
                            (jobTitle._count.staff / summary.totalStaff) *
                            100
                          ).toFixed(1)
                        : "0";

                    return (
                      <TableRow key={jobTitle.id}>
                        <TableCell className="font-medium">
                          {jobTitle.title}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-purple-600">
                          {jobTitle._count.staff}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {percentage}%
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              index === 0
                                ? "bg-yellow-100 text-yellow-800"
                                : index === 1
                                ? "bg-gray-100 text-gray-800"
                                : index === 2
                                ? "bg-orange-100 text-orange-800"
                                : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            #{index + 1}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Top Job Titles */}
      {jobTitles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top 10 Job Titles by Staff Count</CardTitle>
            <CardDescription>
              Most common roles in the organization
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead>
                  <TableHead>Job Title</TableHead>
                  <TableHead className="text-right">Staff Count</TableHead>
                  <TableHead className="text-right">Percentage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobTitles
                  .sort((a, b) => b._count.staff - a._count.staff)
                  .slice(0, 10)
                  .map((jobTitle, index) => {
                    const percentage =
                      summary.totalStaff > 0
                        ? (
                            (jobTitle._count.staff / summary.totalStaff) *
                            100
                          ).toFixed(1)
                        : "0";

                    return (
                      <TableRow key={jobTitle.id}>
                        <TableCell>
                          <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                              index === 0
                                ? "bg-yellow-100 text-yellow-800"
                                : index === 1
                                ? "bg-gray-100 text-gray-800"
                                : index === 2
                                ? "bg-orange-100 text-orange-800"
                                : "bg-purple-100 text-purple-800"
                            }`}
                          >
                            {index + 1}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">
                          {jobTitle.title}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-purple-600">
                          {jobTitle._count.staff}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {percentage}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Job Titles Distribution */}
      {jobTitles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Staff Distribution</CardTitle>
            <CardDescription>
              How staff are distributed across job titles
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job Title</TableHead>
                  <TableHead className="text-right">Staff Count</TableHead>
                  <TableHead className="text-right">Percentage</TableHead>
                  <TableHead>Distribution</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobTitles
                  .filter((job) => job._count.staff > 0)
                  .sort((a, b) => b._count.staff - a._count.staff)
                  .map((jobTitle) => {
                    const percentage =
                      summary.totalStaff > 0
                        ? (
                            (jobTitle._count.staff / summary.totalStaff) *
                            100
                          ).toFixed(1)
                        : "0";

                    return (
                      <TableRow key={jobTitle.id}>
                        <TableCell className="font-medium">
                          {jobTitle.title}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-purple-600">
                          {jobTitle._count.staff}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {percentage}%
                        </TableCell>
                        <TableCell>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${percentage}%` }}
                            ></div>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
