import { Avatar } from 'heroui-native';

import { useTextScale } from './use-text-scale';

export interface UserAvatarProps {
  name: string;
  source: string | null;
  size?: 'sm' | 'md' | 'lg';
  fallbackTone?: 'default' | 'strong';
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
  const strongFallback = fallbackTone === 'strong';
  const textScale = useTextScale();

  return (
    <Avatar
      alt={name}
      accessibilityLabel={name}
      className={strongFallback ? 'bg-accent' : undefined}
      size={size}
    >
      {isSafeAvatarSource(source) ? (
        <Avatar.Image source={{ uri: source }} />
      ) : null}
      <Avatar.Fallback
        classNames={
          strongFallback ? { text: 'text-accent-foreground' } : undefined
        }
        key={textScale}
      >
        {firstInitial(name)}
      </Avatar.Fallback>
    </Avatar>
  );
}
