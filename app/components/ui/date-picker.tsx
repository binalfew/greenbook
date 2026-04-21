import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";

import { cn } from "~/utils/misc";
import { Button } from "~/components/ui/button";
import { Calendar } from "~/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";

interface DatePickerProps {
  name?: string;
  value?: Date;
  defaultValue?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  required?: boolean;
}

function DatePicker({
  name,
  value: controlledValue,
  defaultValue,
  onChange,
  placeholder = "Pick a date",
  className,
  id,
  required,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [internalDate, setInternalDate] = React.useState<Date | undefined>(defaultValue);

  const date = controlledValue ?? internalDate;

  function handleSelect(selected: Date | undefined) {
    if (!controlledValue) {
      setInternalDate(selected);
    }
    onChange?.(selected);
    setOpen(false);
  }

  return (
    <>
      {name && (
        <input
          type="hidden"
          name={name}
          value={date ? format(date, "yyyy-MM-dd") : ""}
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
            {date ? format(date, "PPP") : <span>{placeholder}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={date} onSelect={handleSelect} defaultMonth={date} />
        </PopoverContent>
      </Popover>
    </>
  );
}

export { DatePicker };
export type { DatePickerProps };
