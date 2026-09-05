import { Avatar } from 'heroui-native';

import { useTextScale } from './use-text-scale';

export interface UserAvatarProps {
  name: string;
  source: string | null;
  size?: 'sm' | 'md' | 'lg';
  fallbackTone?: 'default' | 'tinted';
}

function isSafeAvatarSource(source: string | null): source is string {
  if (!source) {
    return false;
  }

  try {
    return new URL(source).protocol === 'https:';
  } catch {
    return false;
  }
}

function firstInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?';
}

export function UserAvatar({
  name,
  source,
  size = 'md',
  fallbackTone = 'default',
}: UserAvatarProps) {
  const tintedFallback = fallbackTone === 'tinted';
  const textScale = useTextScale();

  return (
    <Avatar
      alt={name}
      accessibilityLabel={name}
      className={tintedFallback ? 'bg-avatar' : undefined}
      size={size}
    >
      {isSafeAvatarSource(source) ? (
        <Avatar.Image source={{ uri: source }} />
      ) : null}
      <Avatar.Fallback
        classNames={
          tintedFallback ? { text: 'text-avatar-foreground' } : undefined
        }
        key={textScale}
      >
        {firstInitial(name)}
      </Avatar.Fallback>
    </Avatar>
  );
}
