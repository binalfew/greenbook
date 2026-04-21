import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";

import { cn } from "~/utils/misc";
import { Button } from "~/components/ui/button";
import { Calendar } from "~/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";

interface DateTimePickerProps {
  name?: string;
  value?: Date;
  defaultValue?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  required?: boolean;
}

function DateTimePicker({
  name,
  value: controlledValue,
  defaultValue,
  onChange,
  placeholder = "Pick date & time",
  className,
  id,
  required,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [internalDate, setInternalDate] = React.useState<Date | undefined>(defaultValue);

  const date = controlledValue ?? internalDate;

  function handleDateSelect(selected: Date | undefined) {
    if (!selected) {
      updateDate(undefined);
      return;
    }
    const next = new Date(selected);
    if (date) {
      next.setHours(date.getHours(), date.getMinutes());
    }
    updateDate(next);
  }

  function handleTimeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const [hours, minutes] = e.target.value.split(":").map(Number);
    const next = date ? new Date(date) : new Date();
    next.setHours(hours, minutes, 0, 0);
    updateDate(next);
  }

  function updateDate(next: Date | undefined) {
    if (!controlledValue) {
      setInternalDate(next);
    }
    onChange?.(next);
  }

  const timeValue = date
    ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    : "";

  return (
    <>
      {name && (
        <input
          type="hidden"
          name={name}
          value={date ? date.toISOString() : ""}
          required={required}
        />
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              !date && "text-muted-foreground",
              className,
            )}
          >
            <CalendarIcon className="mr-2 size-4" />
            {date ? format(date, "PPP HH:mm") : <span>{placeholder}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={date} onSelect={handleDateSelect} defaultMonth={date} />
          <div className="border-t px-3 py-2">
            <label className="text-muted-foreground text-xs font-medium">Time</label>
            <input
              type="time"
              value={timeValue}
              onChange={handleTimeChange}
              className="bg-background mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
            />
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

export { DateTimePicker };
export type { DateTimePickerProps };
