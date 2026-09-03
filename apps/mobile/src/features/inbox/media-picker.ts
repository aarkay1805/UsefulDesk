import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import {
  MEDIA_MIME_TYPES_BY_KIND,
  validateMediaAsset,
  type MediaKind,
} from '../../../../../src/lib/storage/media-contract';

export interface PickedMediaAsset {
  kind: MediaKind;
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

interface ImagePickerBoundary {
  launchImageLibraryAsync(options: {
    mediaTypes: readonly ('images' | 'videos')[];
    allowsEditing: false;
    allowsMultipleSelection: false;
    quality: 1;
  }): Promise<{
    canceled: boolean;
    assets?: {
      uri: string;
      fileName?: string | null;
      fileSize?: number;
      mimeType?: string;
      type?: 'image' | 'video' | 'livePhoto' | 'pairedVideo' | null;
    }[];
  }>;
}

interface DocumentPickerBoundary {
  getDocumentAsync(options: {
    type: readonly string[];
    copyToCacheDirectory: true;
    multiple: false;
  }): Promise<{
    canceled: boolean;
    assets?: {
      uri: string;
      name: string;
      size?: number;
      mimeType?: string;
    }[];
  }>;
}

export interface MediaPickerDependencies {
  imagePicker: ImagePickerBoundary;
  documentPicker: DocumentPickerBoundary;
}

const defaultDependencies: MediaPickerDependencies = {
  imagePicker: ImagePicker as unknown as ImagePickerBoundary,
  documentPicker: DocumentPicker as unknown as DocumentPickerBoundary,
};

function uriName(uri: string, kind: MediaKind): string {
  const finalSegment = uri.split('/').at(-1)?.split('?')[0];
  if (!finalSegment) return kind;
  try {
    return decodeURIComponent(finalSegment) || kind;
  } catch {
    return finalSegment;
  }
}

export async function pickConversationMedia(
  kind: MediaKind,
  dependencies: MediaPickerDependencies = defaultDependencies
): Promise<PickedMediaAsset | null> {
  if (kind === 'image' || kind === 'video') {
    const result = await dependencies.imagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'image' ? ['images'] : ['videos'],
      allowsEditing: false,
      allowsMultipleSelection: false,
      quality: 1,
    });
    if (result.canceled) return null;
    const asset = result.assets?.[0];
    if (!asset || asset.type !== kind) {
      throw new Error('Choose a supported file for this attachment type.');
    }
    const validated = validateMediaAsset({
      kind,
      mimeType: asset.mimeType,
      size: asset.fileSize,
    });
    return {
      kind,
      uri: asset.uri,
      name: asset.fileName?.trim() || uriName(asset.uri, kind),
      mimeType: validated.mimeType,
      size: validated.size,
    };
  }

  const result = await dependencies.documentPicker.getDocumentAsync({
    type: MEDIA_MIME_TYPES_BY_KIND[kind],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) {
    throw new Error('Choose a supported file for this attachment type.');
  }
  const validated = validateMediaAsset({
    kind,
    mimeType: asset.mimeType,
    size: asset.size,
  });
  return {
    kind,
    uri: asset.uri,
    name: asset.name.trim() || uriName(asset.uri, kind),
    mimeType: validated.mimeType,
    size: validated.size,
  };
}
