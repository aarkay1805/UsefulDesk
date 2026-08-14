'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Upload, Trash2, CircleAlert } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { UserAvatar } from '@/components/ui/user-avatar';
import { SettingsPanelHead } from './settings-panel-head';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export function ProfileForm() {
  const { user, profile, profileLoading, refreshProfile } = useAuth();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState('');
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);

  // Seed form state once the profile loads.
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setFullName(profile.full_name ?? '');
    })();
    return () => {
      cancelled = true;
    };
  }, [profile]);

  // Cleanup object URLs to avoid leaks.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const currentAvatar =
    previewUrl ?? (!removeAvatar ? (profile?.avatar_url ?? null) : null);

  const initial = (fullName || profile?.full_name || profile?.email || 'U')
    .charAt(0)
    .toUpperCase();

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so the same file can be re-picked
    if (!file) return;

    if (!ALLOWED_MIME.has(file.type)) {
      toast.error('Unsupported image type', {
        description: 'Use PNG, JPG, WebP, or GIF.',
      });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error('Image is too large', {
        description: 'Maximum 2 MB.',
      });
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingAvatar(file);
    setPreviewUrl(URL.createObjectURL(file));
    setRemoveAvatar(false);
  };

  const onRemoveAvatar = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingAvatar(null);
    setPreviewUrl(null);
    setRemoveAvatar(true);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;

    const trimmedName = fullName.trim();
    if (!trimmedName) {
      toast.error('Display name is required');
      return;
    }
    setSaving(true);
    try {
      let nextAvatarUrl: string | null = profile.avatar_url ?? null;

      // Upload a newly-staged image, if any.
      if (pendingAvatar) {
        const ext = pendingAvatar.name.split('.').pop()?.toLowerCase() || 'png';
        const path = `${user.id}/avatar-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, pendingAvatar, {
            cacheControl: '3600',
            upsert: true,
            contentType: pendingAvatar.type,
          });
        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }
        const {
          data: { publicUrl },
        } = supabase.storage.from('avatars').getPublicUrl(path);
        nextAvatarUrl = publicUrl;
      } else if (removeAvatar) {
        nextAvatarUrl = null;
      }

      // Persist name + avatar to profiles.
      const { data: updatedProfiles, error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: trimmedName,
          avatar_url: nextAvatarUrl,
        })
        .eq('user_id', user.id)
        .select('id');
      if (updateError) {
        throw new Error(`Save failed: ${updateError.message}`);
      }
      if (!updatedProfiles?.length) {
        throw new Error('Your profile could not be updated. Try again.');
      }

      setPendingAvatar(null);
      setPreviewUrl(null);
      setRemoveAvatar(false);
      await refreshProfile();

      toast.success('Profile saved');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Your profile could not be saved'));
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    !!profile &&
    (fullName.trim() !== (profile.full_name ?? '') ||
      pendingAvatar !== null ||
      removeAvatar);

  return (
    <section className="animate-in fade-in-50 max-w-xl duration-200">
      <SettingsPanelHead
        title="Your profile"
        description="Update the photo and display name people see in UsefulDesk."
      />
      {!profile ? (
        <Alert variant={profileLoading ? 'default' : 'destructive'}>
          <CircleAlert />
          <AlertTitle>
            {profileLoading ? 'Loading your profile' : 'Profile unavailable'}
          </AlertTitle>
          <AlertDescription>
            {profileLoading
              ? 'Your details will appear in a moment.'
              : 'Refresh the page and try again.'}
          </AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={onSubmit}>
          <Card>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
                <UserAvatar
                  name={fullName || initial}
                  src={currentAvatar}
                  size="lg"
                  className="size-14"
                  fallbackClassName="text-base"
                />

                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      onChange={onPickFile}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={saving}
                    >
                      <Upload className="size-4" />
                      {currentAvatar ? 'Change photo' : 'Upload photo'}
                    </Button>
                    {currentAvatar && (
                      <Button
                        type="button"
                        variant="destructive-ghost"
                        onClick={onRemoveAvatar}
                        disabled={saving}
                      >
                        <Trash2 className="size-4" />
                        Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-2 text-xs">
                    JPG, PNG, WebP, or GIF. Maximum 2 MB.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile-full-name">Display name</Label>
                <Input
                  id="profile-full-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ada Lovelace"
                  maxLength={120}
                  disabled={saving}
                  required
                />
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button type="submit" disabled={saving || !dirty}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save changes'
                )}
              </Button>
            </CardFooter>
          </Card>
        </form>
      )}
    </section>
  );
}
