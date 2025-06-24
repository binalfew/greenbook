import { Link } from "react-router";
import type { MicrosoftProfile } from "~/lib/graph.server";

interface OrgChartProps {
  currentUser: MicrosoftProfile;
  manager: MicrosoftProfile | null;
  directReports: MicrosoftProfile[];
}

export default function OrgChart({
  currentUser,
  manager,
  directReports,
}: OrgChartProps) {
  return (
    <div className="org-chart">
      {/* Manager Level */}
      {manager && (
        <div className="mb-8">
          <div className="flex justify-center">
            <div className="text-center">
              <Link to={`/users/${manager.id}`} className="block">
                <div className="inline-block p-4 bg-blue-50 border-2 border-blue-200 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer">
                  <div className="w-12 h-12 rounded-full bg-blue-200 flex items-center justify-center mx-auto mb-2">
                    <span className="text-blue-700 font-semibold text-lg">
                      {manager.displayName?.charAt(0)?.toUpperCase() || "?"}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-gray-900 max-w-32 truncate">
                    {manager.displayName}
                  </div>
                  <div className="text-xs text-gray-600 max-w-32 truncate">
                    {manager.jobTitle}
                  </div>
                </div>
              </Link>
              <div className="text-xs text-gray-500 mt-2 font-medium">
                Manager
              </div>
            </div>
          </div>

          {/* Connection Line */}
          <div className="flex justify-center">
            <div className="w-px h-8 bg-gray-300"></div>
          </div>
        </div>
      )}

      {/* Current User Level */}
      <div className="mb-8">
        <div className="flex justify-center">
          <div className="text-center">
            <div className="inline-block p-4 bg-green-50 border-2 border-green-200 rounded-lg shadow-sm">
              <div className="w-12 h-12 rounded-full bg-green-200 flex items-center justify-center mx-auto mb-2">
                <span className="text-green-700 font-semibold text-lg">
                  {currentUser.displayName?.charAt(0)?.toUpperCase() || "?"}
                </span>
              </div>
              <div className="text-sm font-medium text-gray-900 max-w-32 truncate">
                {currentUser.displayName}
              </div>
              <div className="text-xs text-gray-600 max-w-32 truncate">
                {currentUser.jobTitle}
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-2 font-medium">
              Current User
            </div>
          </div>
        </div>
      </div>

      {/* Direct Reports Level */}
      {directReports.length > 0 && (
        <>
          {/* Connection Lines */}
          <div className="flex justify-center mb-4">
            <div className="w-px h-8 bg-gray-300"></div>
          </div>

          {/* Direct Reports Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {directReports.map((report) => (
              <div key={report.id} className="text-center">
                <Link to={`/users/${report.id}`} className="block">
                  <div className="inline-block p-3 bg-gray-50 border-2 border-gray-200 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
                    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center mx-auto mb-2">
                      <span className="text-gray-600 font-semibold">
                        {report.displayName?.charAt(0)?.toUpperCase() || "?"}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-gray-900 truncate max-w-28">
                      {report.displayName}
                    </div>
                    <div className="text-xs text-gray-600 truncate max-w-28">
                      {report.jobTitle}
                    </div>
                  </div>
                </Link>
                <div className="text-xs text-gray-500 mt-1">Direct Report</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* No Direct Reports Message */}
      {directReports.length === 0 && (
        <div className="text-center py-8">
          <div className="text-gray-400 text-sm">No direct reports</div>
        </div>
      )}

      {/* Summary */}
      <div className="mt-8 text-center">
        <div className="inline-flex items-center gap-4 text-sm text-gray-600 bg-gray-50 px-4 py-2 rounded-lg">
          <span>Total Direct Reports: {directReports.length}</span>
          {manager && <span>•</span>}
          {manager && <span>Reports to: {manager.displayName}</span>}
        </div>
      </div>
    </div>
  );
}
