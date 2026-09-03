import {
  pickConversationMedia,
  type MediaPickerDependencies,
} from './media-picker';

const IMAGE = {
  uri: 'file:///cache/member-photo.jpg',
  fileName: 'member-photo.jpg',
  fileSize: 1024,
  mimeType: 'image/jpeg',
  type: 'image' as const,
  width: 800,
  height: 600,
};

function dependencies() {
  const launchImageLibraryAsync = jest.fn();
  const getDocumentAsync = jest.fn();
  const result: MediaPickerDependencies = {
    imagePicker: { launchImageLibraryAsync },
    documentPicker: { getDocumentAsync },
  };
  return { result, launchImageLibraryAsync, getDocumentAsync };
}

describe('pickConversationMedia', () => {
  it.each([
    ['image', ['images'], { ...IMAGE }],
    [
      'video',
      ['videos'],
      {
        ...IMAGE,
        uri: 'file:///cache/tour.mp4',
        fileName: 'tour.mp4',
        mimeType: 'video/mp4',
        type: 'video',
      },
    ],
  ] as const)(
    'normalizes a selected %s with library-only options',
    async (kind, mediaTypes, asset) => {
      const setup = dependencies();
      setup.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [asset],
      });

      await expect(pickConversationMedia(kind, setup.result)).resolves.toEqual({
        kind,
        uri: asset.uri,
        name: asset.fileName,
        mimeType: asset.mimeType,
        size: asset.fileSize,
      });
      expect(setup.launchImageLibraryAsync).toHaveBeenCalledWith({
        mediaTypes,
        allowsEditing: false,
        allowsMultipleSelection: false,
        quality: 1,
      });
      expect(setup.getDocumentAsync).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      'document',
      [
        'application/pdf',
        'application/vnd.ms-powerpoint',
        'application/msword',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
      ],
      {
        uri: 'file:///cache/renewal.pdf',
        name: 'renewal.pdf',
        size: 2048,
        mimeType: 'application/pdf',
      },
    ],
    [
      'audio',
      ['audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/amr'],
      {
        uri: 'file:///cache/message.ogg',
        name: 'message.ogg',
        size: 4096,
        mimeType: 'audio/ogg',
      },
    ],
  ] as const)(
    'normalizes a selected %s with its MIME filters',
    async (kind, type, asset) => {
      const setup = dependencies();
      setup.getDocumentAsync.mockResolvedValue({
        canceled: false,
        assets: [asset],
      });

      await expect(pickConversationMedia(kind, setup.result)).resolves.toEqual({
        kind,
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
      });
      expect(setup.getDocumentAsync).toHaveBeenCalledWith({
        type,
        copyToCacheDirectory: true,
        multiple: false,
      });
      expect(setup.launchImageLibraryAsync).not.toHaveBeenCalled();
    }
  );

  it.each(['image', 'document'] as const)(
    'returns null silently when the %s picker is cancelled',
    async (kind) => {
      const setup = dependencies();
      setup.launchImageLibraryAsync.mockResolvedValue({ canceled: true });
      setup.getDocumentAsync.mockResolvedValue({ canceled: true });
      await expect(
        pickConversationMedia(kind, setup.result)
      ).resolves.toBeNull();
    }
  );

  it.each([
    ['missing MIME', { ...IMAGE, mimeType: undefined }],
    ['unsupported MIME', { ...IMAGE, mimeType: 'image/gif' }],
    ['wrong picker kind', { ...IMAGE, type: 'video' }],
    ['zero bytes', { ...IMAGE, fileSize: 0 }],
    ['missing size', { ...IMAGE, fileSize: undefined }],
    ['over limit', { ...IMAGE, fileSize: 5 * 1024 * 1024 + 1 }],
  ])('rejects an image with %s before upload', async (_label, asset) => {
    const setup = dependencies();
    setup.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [asset],
    });

    await expect(pickConversationMedia('image', setup.result)).rejects.toThrow(
      /supported file|non-empty|too large/
    );
  });

  it('uses the URI basename only for a missing display name, never to infer MIME', async () => {
    const setup = dependencies();
    setup.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ ...IMAGE, fileName: null }],
    });
    await expect(
      pickConversationMedia('image', setup.result)
    ).resolves.toMatchObject({ name: 'member-photo.jpg' });

    setup.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ ...IMAGE, fileName: null, mimeType: undefined }],
    });
    await expect(pickConversationMedia('image', setup.result)).rejects.toThrow(
      'Choose a supported file for this attachment type.'
    );
  });
});
