"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
// v6 ships its structural CSS as a separate file (not auto-injected) —
// without it the crop container has no positioning and collapses.
import "react-easy-crop/react-easy-crop.css";
import { toast } from "sonner";
import { Loader2, Trash2, Upload } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cropToWebp } from "@/lib/images/optimize";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Bucket allows these (migration 008). We always re-encode to WebP, so
// the accept list is just to filter the OS picker.
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
// Guard the raw pick before we even decode it — the canvas step brings
// it down to a ~30 KB WebP regardless, but reject absurd originals early.
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

interface AvatarEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  name: string;
  currentUrl?: string | null;
  /** Fired after `contacts.avatar_url` is persisted (set or cleared) so
   *  the parent re-reads and every render of this person updates. */
  onSaved: () => void;
}

// Pull the storage object path out of a public avatars URL so the old
// file can be best-effort GC'd. Returns null for anything that isn't an
// avatars public URL (e.g. an external/WhatsApp avatar).
function avatarPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = "/object/public/avatars/";
  const i = url.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length));
}

export function AvatarEditorDialog({
  open,
  onOpenChange,
  contactId,
  name,
  currentUrl,
  onSaved,
}: AvatarEditorDialogProps) {
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement>(null);

  // A picked image (data URL) switches the dialog into cropping mode.
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPx, setAreaPx] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  const onCropComplete = useCallback(
    (_area: Area, pixels: Area) => setAreaPx(pixels),
    []
  );

  function resetCrop() {
    setSrc(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setAreaPx(null);
  }
  function close() {
    resetCrop();
    onOpenChange(false);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file.");
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      toast.error("That image is too large (max 15 MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setSrc(reader.result as string);
    reader.onerror = () => toast.error("Could not read that file.");
    reader.readAsDataURL(file);
  }

  async function persist(avatarUrl: string | null) {
    // Chain .select('id') so an RLS-blocked write (zero rows, no error)
    // surfaces as a failure instead of a false success toast.
    const { data, error } = await supabase
      .from("contacts")
      .update({ avatar_url: avatarUrl })
      .eq("id", contactId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new Error("You don't have permission to update this member.");
    }
    // Best-effort GC of the previous object (RLS lets us delete only our
    // own uploads; a miss is a harmless storage nit).
    const old = avatarPathFromUrl(currentUrl);
    if (old && old !== avatarPathFromUrl(avatarUrl)) {
      void supabase.storage.from("avatars").remove([old]).then(
        () => {},
        () => {}
      );
    }
  }

  async function save() {
    if (!src || !areaPx) return;
    setBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const blob = await cropToWebp(src, areaPx);
      // Path first segment = auth.uid() → matches the avatars bucket RLS
      // (migration 008). Public read, so the URL renders in <img> directly.
      const path = `${user.id}/member-${contactId}-${Date.now()}.webp`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, blob, {
          cacheControl: "3600",
          upsert: true,
          contentType: "image/webp",
        });
      if (upErr) throw new Error(upErr.message);

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(path);
      await persist(publicUrl);

      toast.success("Photo updated");
      onSaved();
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update photo");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await persist(null);
      toast.success("Photo removed");
      onSaved();
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove photo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{src ? "Crop photo" : "Member photo"}</DialogTitle>
          <DialogDescription>
            {src
              ? "Drag to reposition, scroll or use the slider to zoom. The crop is square."
              : "Upload or change this member's photo. It's optimized to WebP before saving."}
          </DialogDescription>
        </DialogHeader>

        {src ? (
          <div className="space-y-3">
            <div className="relative h-64 w-full overflow-hidden rounded-lg bg-muted">
              <Cropper
                image={src}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="Zoom"
              className="accent-primary w-full"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-2">
            {currentUrl ? (
              // Full stored image (not the round crop) so it's viewable at
              // its real resolution. object-contain avoids re-cropping a
              // non-square source (e.g. a WhatsApp avatar).
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentUrl}
                alt={name}
                className="max-h-80 w-full max-w-xs rounded-lg border border-border object-contain"
              />
            ) : (
              <UserAvatar
                name={name}
                src={null}
                className="size-28"
                fallbackClassName="text-3xl"
              />
            )}
            <p className="text-xs text-muted-foreground">
              PNG, JPG, WebP or GIF — capped at 512px, compressed to WebP.
            </p>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          onChange={onFile}
          className="hidden"
        />

        <DialogFooter className="gap-2 sm:justify-between">
          {src ? (
            <>
              <Button variant="outline" onClick={resetCrop} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={save}
                disabled={busy || !areaPx}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                Save photo
              </Button>
            </>
          ) : (
            <>
              {currentUrl ? (
                <Button
                  variant="destructive"
                  onClick={remove}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  Remove
                </Button>
              ) : (
                <span />
              )}
              <Button onClick={() => fileRef.current?.click()} disabled={busy}>
                <Upload className="size-4" />
                {currentUrl ? "Change photo" : "Upload photo"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
