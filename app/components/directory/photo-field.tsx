import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { PERSON_PHOTO_ACCEPT } from "~/utils/constants/person-photo";

// File picker for a person's photo, with a preview and a way to remove the
// photo the record already has. Posts three fields the editor action reads:
// `photo` (a newly chosen file), `photoId` (the photo shown when the form
// loaded) and `removePhoto` ("1" when the user asked to drop it).

export interface PhotoFieldProps {
  /** id of the file input, for the field's label. */
  id: string;
  /** The photo the form starts with, if any. */
  current?: { id: string; src: string };
  /** Start in the "will be removed" state (resuming a draft that removes it). */
  initiallyRemoved?: boolean;
  labels: { current: string; remove: string; undoRemove: string; willBeRemoved: string };
}

export function PhotoField({ id, current, initiallyRemoved = false, labels }: PhotoFieldProps) {
  const [removed, setRemoved] = useState(initiallyRemoved);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const shown = preview ?? (current && !removed ? current.src : null);

  return (
    <div className="flex items-center gap-4">
      {shown ? (
        <img
          src={shown}
          alt={labels.current}
          width={64}
          height={64}
          className="size-16 shrink-0 rounded-full border object-cover"
          // A reopened request can point at a photo that was since deleted.
          onError={(event) => (event.currentTarget.hidden = true)}
          onLoad={(event) => (event.currentTarget.hidden = false)}
        />
      ) : null}
      <div className="min-w-0 flex-1 space-y-2">
        {current ? <input type="hidden" name="photoId" value={current.id} /> : null}
        {removed && !preview ? <input type="hidden" name="removePhoto" value="1" /> : null}
        <Input
          id={id}
          name="photo"
          type="file"
          accept={PERSON_PHOTO_ACCEPT}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            setPreview(file ? URL.createObjectURL(file) : null);
          }}
        />
        {current && !preview ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setRemoved(!removed)}>
              {removed ? labels.undoRemove : labels.remove}
            </Button>
            {removed ? (
              <span className="text-muted-foreground text-xs">{labels.willBeRemoved}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
