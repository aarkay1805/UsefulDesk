import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';

import { safeMediaUrl } from '../../src/features/inbox/inbox-format';
import { Notice, ScreenSafeAreaView } from '../../src/ui';

export default function PhotoScreen() {
  const { url } = useLocalSearchParams<{ url: string }>();
  const uri = safeMediaUrl(typeof url === 'string' ? url : null);
  const [failed, setFailed] = useState(false);
  const { width, height } = useWindowDimensions();
  return (
    <ScreenSafeAreaView className="bg-inbox-panel flex-1" edges={['bottom']}>
      <Stack.Screen options={{ title: 'Photo', headerShown: true }} />
      {uri && !failed ? (
        <ScrollView
          centerContent
          maximumZoomScale={4}
          minimumZoomScale={1}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
        >
          <Image
            accessibilityLabel="Full photo"
            accessible
            contentFit="contain"
            onError={() => setFailed(true)}
            source={{ uri }}
            style={{ width, height: height * 0.75 }}
          />
        </ScrollView>
      ) : (
        <Notice tone="danger">Photo unavailable</Notice>
      )}
    </ScreenSafeAreaView>
  );
}
