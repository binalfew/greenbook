import { ImageIcon, Loader2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";

const MAX_SIZE_BYTES = 2 * 1024 * 1024;

/**
 * Controlled logo upload widget. Reads the selected file into a data URL and
 * exposes it via a hidden `logoUrl` input so the parent `<Form>` POSTs it.
 * Apps that want a remote store (S3, R2) should swap the FileReader branch
 * for a fetch-upload + swap the returned CDN URL into the hidden input.
 */
export function LogoUpload({ initialLogoUrl }: { initialLogoUrl?: string | null }) {
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl ?? "");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage("");

    if (file.size > MAX_SIZE_BYTES) {
      setErrorMessage("File exceeds 2 MB limit.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setLoading(true);
    const reader = new FileReader();
    reader.onload = () => {
      setLogoUrl(reader.result as string);
      setLoading(false);
    };
    reader.onerror = () => {
      setErrorMessage("Failed to read file.");
      setLoading(false);
    };
    reader.readAsDataURL(file);

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleRemove() {
    setLogoUrl("");
    setErrorMessage("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Logo</h3>
        <p className="text-muted-foreground text-xs">
          Upload an image to use as the tenant logo in the sidebar.
        </p>
      </div>

      <input type="hidden" name="logoUrl" value={logoUrl} />

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="border-border bg-muted/50 hover:border-primary/50 hover:bg-muted relative flex size-16 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition-colors"
        >
          {loading ? (
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          ) : logoUrl ? (
            <img src={logoUrl} alt="Tenant logo" className="size-full object-contain p-1" />
          ) : (
            <ImageIcon className="text-muted-foreground size-6" />
          )}
        </button>

        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            >
              <Upload className="mr-1.5 size-3.5" />
              {logoUrl ? "Change" : "Upload"}
            </Button>
            {logoUrl && (
              <Button type="button" variant="outline" size="sm" onClick={handleRemove}>
                <X className="mr-1.5 size-3.5" />
                Remove
              </Button>
            )}
          </div>
          {errorMessage && <p className="text-destructive text-xs">{errorMessage}</p>}
          <p className="text-muted-foreground text-xs">PNG, JPG, SVG, or WebP. Max 2 MB.</p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.svg"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
