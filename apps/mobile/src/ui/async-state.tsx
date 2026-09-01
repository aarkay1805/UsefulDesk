import { View } from 'react-native';
import { Alert, Spinner } from 'heroui-native';

import { Button } from './button';

export interface LoadingStateProps {
  label?: string;
}

export interface EmptyStateProps {
  title: string;
  message?: string;
}

export interface ErrorStateProps {
  title: string;
  message: string;
  onRetry?: () => void;
}

export type AsyncStateProps =
  | ({ status: 'loading' } & LoadingStateProps)
  | ({ status: 'empty' } & EmptyStateProps)
  | ({ status: 'error' } & ErrorStateProps);

export function LoadingState({ label = 'Loading' }: LoadingStateProps) {
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="progressbar">
      <Spinner accessibilityLabel={label} size="lg" />
    </View>
  );
}

export function EmptyState({ title, message }: EmptyStateProps) {
  return (
    <Alert status="default">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        {message ? <Alert.Description>{message}</Alert.Description> : null}
      </Alert.Content>
    </Alert>
  );
}

export function ErrorState({ title, message, onRetry }: ErrorStateProps) {
  return (
    <Alert status="danger">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        <Alert.Description>{message}</Alert.Description>
        {onRetry ? (
          <Button className="min-h-12" onPress={onRetry}>
            Retry
          </Button>
        ) : null}
      </Alert.Content>
    </Alert>
  );
}

export function AsyncState(props: AsyncStateProps) {
  switch (props.status) {
    case 'loading':
      return <LoadingState label={props.label} />;
    case 'empty':
      return <EmptyState title={props.title} message={props.message} />;
    case 'error':
      return (
        <ErrorState
          title={props.title}
          message={props.message}
          onRetry={props.onRetry}
        />
      );
  }
}
