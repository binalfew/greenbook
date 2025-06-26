import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { getAllSchedules } from "~/lib/scheduler.server";

interface SyncSchedule {
  id: string;
  name: string;
  description?: string;
  syncType: "incremental" | "full" | "selective";
  cronExpression: string;
  syncOptions: any;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  createdAt: string;
  updatedAt: string;
}

interface LoaderData {
  schedules: SyncSchedule[];
}

export async function loader() {
  const schedules = await getAllSchedules();
  return { schedules };
}

export default function AdminSchedules() {
  const data = useLoaderData<LoaderData>();
  const schedules = data?.schedules || [];
  const fetcher = useFetcher();
  const [isCreating, setIsCreating] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<SyncSchedule | null>(
    null
  );
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    syncType: "incremental" as "incremental" | "full" | "selective",
    cronExpression: "",
    enabled: true,
    users: true,
    referenceData: true,
    hierarchy: true,
    linkReferences: true,
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      syncType: "incremental",
      cronExpression: "",
      enabled: true,
      users: true,
      referenceData: true,
      hierarchy: true,
      linkReferences: true,
    });
    setIsCreating(false);
    setEditingSchedule(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const form = new FormData();
    form.append("action", editingSchedule ? "update" : "create");

    if (editingSchedule) {
      form.append("id", editingSchedule.id);
    }

    form.append("name", formData.name);
    form.append("description", formData.description);
    form.append("syncType", formData.syncType);
    form.append("cronExpression", formData.cronExpression);
    form.append("enabled", formData.enabled.toString());
    form.append("users", formData.users.toString());
    form.append("referenceData", formData.referenceData.toString());
    form.append("hierarchy", formData.hierarchy.toString());
    form.append("linkReferences", formData.linkReferences.toString());

    fetcher.submit(form, { method: "post", action: "/api/schedules" });
    resetForm();
  };

  const handleEdit = (schedule: SyncSchedule) => {
    setEditingSchedule(schedule);
    setFormData({
      name: schedule.name,
      description: schedule.description || "",
      syncType: schedule.syncType,
      cronExpression: schedule.cronExpression,
      enabled: schedule.enabled,
      users: schedule.syncOptions.users,
      referenceData: schedule.syncOptions.referenceData,
      hierarchy: schedule.syncOptions.hierarchy,
      linkReferences: schedule.syncOptions.linkReferences,
    });
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this schedule?")) {
      const form = new FormData();
      form.append("action", "delete");
      form.append("id", id);
      fetcher.submit(form, { method: "post", action: "/api/schedules" });
    }
  };

  const handleToggle = (id: string, enabled: boolean) => {
    const form = new FormData();
    form.append("action", "toggle");
    form.append("id", id);
    form.append("enabled", (!enabled).toString());
    fetcher.submit(form, { method: "post", action: "/api/schedules" });
  };

  const formatCronExpression = (cron: string) => {
    // Simple cron expression formatter
    const parts = cron.split(" ");
    if (parts.length === 5) {
      const [minute, hour, day, month, weekday] = parts;
      return `${minute} ${hour} ${day} ${month} ${weekday}`;
    }
    return cron;
  };

  const getNextRunDisplay = (nextRun?: string) => {
    if (!nextRun) return "Not scheduled";
    const date = new Date(nextRun);
    return date.toLocaleString();
  };

  const getLastRunDisplay = (lastRun?: string) => {
    if (!lastRun) return "Never";
    const date = new Date(lastRun);
    return date.toLocaleString();
  };

  const presetCronExpressions = [
    { label: "Every 5 minutes", value: "*/5 * * * *" },
    { label: "Every 15 minutes", value: "*/15 * * * *" },
    { label: "Every hour", value: "0 * * * *" },
    { label: "Every 6 hours", value: "0 */6 * * *" },
    { label: "Daily at 2 AM", value: "0 2 * * *" },
    { label: "Daily at 6 AM", value: "0 6 * * *" },
    { label: "Weekly on Sunday at 2 AM", value: "0 2 * * 0" },
    { label: "Monthly on 1st at 2 AM", value: "0 2 1 * *" },
  ];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Sync Schedules</h1>
          <p className="text-muted-foreground">
            Manage automated sync schedules for different data types
          </p>
        </div>
        <Button onClick={() => setIsCreating(true)}>Create Schedule</Button>
      </div>

      {/* Create/Edit Form */}
      {(isCreating || editingSchedule) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editingSchedule ? "Edit Schedule" : "Create New Schedule"}
            </CardTitle>
            <CardDescription>
              Configure automated sync schedules with cron expressions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="Daily incremental sync"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Description</label>
                  <Input
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    placeholder="Optional description"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Sync Type</label>
                  <Select
                    value={formData.syncType}
                    onValueChange={(value: any) =>
                      setFormData({ ...formData, syncType: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="incremental">
                        Incremental Sync
                      </SelectItem>
                      <SelectItem value="full">Full Sync</SelectItem>
                      <SelectItem value="selective">Selective Sync</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Enabled</label>
                  <div className="flex items-center space-x-2 mt-2">
                    <Checkbox
                      checked={formData.enabled}
                      onCheckedChange={(checked) =>
                        setFormData({
                          ...formData,
                          enabled: checked as boolean,
                        })
                      }
                    />
                    <span className="text-sm">Enable this schedule</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Cron Expression</label>
                <div className="flex gap-2">
                  <Input
                    value={formData.cronExpression}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        cronExpression: e.target.value,
                      })
                    }
                    placeholder="0 2 * * *"
                    required
                  />
                  <Select
                    onValueChange={(value) =>
                      setFormData({ ...formData, cronExpression: value })
                    }
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Presets" />
                    </SelectTrigger>
                    <SelectContent>
                      {presetCronExpressions.map((preset) => (
                        <SelectItem key={preset.value} value={preset.value}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Format: minute hour day month weekday (e.g., 0 2 * * * for
                  daily at 2 AM)
                </p>
              </div>

              <Separator />

              <div>
                <label className="text-sm font-medium">Sync Options</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      checked={formData.users}
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, users: checked as boolean })
                      }
                    />
                    <span className="text-sm">Users</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      checked={formData.referenceData}
                      onCheckedChange={(checked) =>
                        setFormData({
                          ...formData,
                          referenceData: checked as boolean,
                        })
                      }
                    />
                    <span className="text-sm">Reference Data</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      checked={formData.hierarchy}
                      onCheckedChange={(checked) =>
                        setFormData({
                          ...formData,
                          hierarchy: checked as boolean,
                        })
                      }
                    />
                    <span className="text-sm">Hierarchy</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      checked={formData.linkReferences}
                      onCheckedChange={(checked) =>
                        setFormData({
                          ...formData,
                          linkReferences: checked as boolean,
                        })
                      }
                    />
                    <span className="text-sm">Link References</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit">
                  {editingSchedule ? "Update Schedule" : "Create Schedule"}
                </Button>
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Schedules List */}
      <div className="space-y-4">
        {schedules.map((schedule) => (
          <Card key={schedule.id}>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {schedule.name}
                    <span
                      className={`px-2 py-1 text-xs rounded-full ${
                        schedule.enabled
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {schedule.enabled ? "Active" : "Inactive"}
                    </span>
                  </CardTitle>
                  {schedule.description && (
                    <CardDescription>{schedule.description}</CardDescription>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={schedule.enabled ? "outline" : "default"}
                    onClick={() => handleToggle(schedule.id, schedule.enabled)}
                  >
                    {schedule.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEdit(schedule)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDelete(schedule.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="font-medium">Type:</span> {schedule.syncType}
                </div>
                <div>
                  <span className="font-medium">Schedule:</span>{" "}
                  {formatCronExpression(schedule.cronExpression)}
                </div>
                <div>
                  <span className="font-medium">Next Run:</span>{" "}
                  {getNextRunDisplay(schedule.nextRun)}
                </div>
                <div>
                  <span className="font-medium">Last Run:</span>{" "}
                  {getLastRunDisplay(schedule.lastRun)}
                </div>
                <div>
                  <span className="font-medium">Created:</span>{" "}
                  {new Date(schedule.createdAt).toLocaleDateString()}
                </div>
                <div>
                  <span className="font-medium">Options:</span>{" "}
                  {Object.entries(schedule.syncOptions)
                    .filter(([_, enabled]) => enabled)
                    .map(([key]) => key)
                    .join(", ")}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {schedules.length === 0 && (
          <Card>
            <CardContent className="text-center py-8">
              <p className="text-muted-foreground">
                No schedules configured yet.
              </p>
              <Button onClick={() => setIsCreating(true)} className="mt-2">
                Create Your First Schedule
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
