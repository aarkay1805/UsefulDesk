import {
  buildMediaPath,
  validateMediaAsset,
} from '../../../../../src/lib/storage/media-contract';
import { mobileEnvironment } from '../../core/env';
import { mobileSupabase, selectedBranchRef } from '../../data/supabase';
import type { PickedMediaAsset } from './media-picker';

const CHAT_MEDIA_BUCKET = 'chat-media';

type MobileSession = { access_token: string };

interface MediaUploadAuth {
  getSession(): Promise<{
    data: { session: MobileSession | null };
    error: unknown;
  }>;
  refreshSession(): Promise<{
    data: { session: MobileSession | null };
    error: unknown;
  }>;
}

export interface MediaUploadRequest {
  status: number;
  upload: {
    onprogress: ((event: { loaded: number; total: number }) => void) | null;
  };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: unknown): void;
  abort(): void;
}

export interface MediaUploadDependencies {
  supabaseUrl?: string;
  anonKey?: string;
  auth?: MediaUploadAuth;
  selectedBranch?: { get(): string | null };
  recoverUnauthorizedSession?: () => Promise<void>;
  readBlob?: (uri: string, signal: AbortSignal) => Promise<Blob>;
  createRequest?: () => MediaUploadRequest;
  now?: () => number;
}

interface ResolvedDependencies {
  supabaseUrl: string;
  anonKey: string;
  auth: MediaUploadAuth;
  selectedBranch: { get(): string | null };
  recoverUnauthorizedSession?: () => Promise<void>;
  readBlob(uri: string, signal: AbortSignal): Promise<Blob>;
  createRequest(): MediaUploadRequest;
  now(): number;
}

export type MediaUploadErrorCategory =
  'aborted' | 'unauthorized' | 'forbidden' | 'network' | 'storage';

export class MediaUploadError extends Error {
  constructor(
    readonly category: MediaUploadErrorCategory,
    message: string
  ) {
    super(message);
    this.name = 'MediaUploadError';
  }
}

export interface UploadedMedia {
  publicUrl: string;
  path: string;
}

export interface UploadConversationMediaInput {
  accountId: string;
  asset: PickedMediaAsset;
  onProgress?: (progress: number) => void;
}

export interface DeleteConversationMediaInput {
  accountId: string;
  path: string;
}

const defaultReadBlob = async (uri: string, signal: AbortSignal) => {
  const response = await fetch(uri, { signal });
  return response.blob();
};

const defaultDependencies: ResolvedDependencies = {
  supabaseUrl: mobileEnvironment.supabaseUrl,
  anonKey: mobileEnvironment.supabaseAnonKey,
  auth: mobileSupabase.auth,
  selectedBranch: selectedBranchRef,
  readBlob: defaultReadBlob,
  createRequest: () => new XMLHttpRequest() as unknown as MediaUploadRequest,
  now: Date.now,
};

function resolveDependencies(
  dependencies: MediaUploadDependencies
): ResolvedDependencies {
  return { ...defaultDependencies, ...dependencies };
}

function encodedPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function ensureSelectedBranch(
  accountId: string,
  dependencies: ResolvedDependencies
) {
  if (dependencies.selectedBranch.get() !== accountId) {
    throw new MediaUploadError(
      'forbidden',
      'This branch is no longer selected.'
    );
  }
}

async function sessionToken(
  getter: () => ReturnType<MediaUploadAuth['getSession']>
): Promise<string> {
  try {
    const result = await getter();
    if (!result.error && result.data.session?.access_token) {
      return result.data.session.access_token;
    }
  } catch {
    // Normalize below without surfacing auth diagnostics.
  }
  throw new MediaUploadError('unauthorized', 'Your session has expired.');
}

function requestStatus(
  request: MediaUploadRequest,
  method: 'POST' | 'DELETE',
  url: string,
  headers: Record<string, string>,
  body: unknown,
  onProgress?: (progress: number) => void
): Promise<number> {
  return new Promise((resolve, reject) => {
    request.open(method, url);
    Object.entries(headers).forEach(([name, value]) =>
      request.setRequestHeader(name, value)
    );
    if (onProgress) {
      request.upload.onprogress = ({ loaded, total }) => {
        if (total <= 0) return;
        onProgress(Math.max(0, Math.min(1, loaded / total)));
      };
    }
    request.onload = () => resolve(request.status);
    request.onerror = () =>
      reject(
        new MediaUploadError('network', 'Could not upload this attachment.')
      );
    request.onabort = () =>
      reject(new MediaUploadError('aborted', 'Attachment upload cancelled.'));
    request.send(body);
  });
}

function uploadHeaders(
  token: string,
  accountId: string,
  mimeType: string,
  anonKey: string
): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    apikey: anonKey,
    'x-usefuldesk-account-id': accountId,
    'Content-Type': mimeType,
    'Cache-Control': '3600',
    'x-upsert': 'false',
  };
}

export function uploadConversationMedia(
  input: UploadConversationMediaInput,
  options: MediaUploadDependencies = {}
): { promise: Promise<UploadedMedia>; abort(): void } {
  const dependencies = resolveDependencies(options);
  const abortController = new AbortController();
  let activeRequest: MediaUploadRequest | null = null;
  let aborted = false;
  input.onProgress?.(0);

  const promise = (async () => {
    ensureSelectedBranch(input.accountId, dependencies);
    validateMediaAsset(input.asset);
    let blob: Blob;
    try {
      blob = await dependencies.readBlob(
        input.asset.uri,
        abortController.signal
      );
    } catch {
      if (aborted || abortController.signal.aborted) {
        throw new MediaUploadError('aborted', 'Attachment upload cancelled.');
      }
      throw new MediaUploadError('network', 'Could not read this attachment.');
    }
    if (aborted) {
      throw new MediaUploadError('aborted', 'Attachment upload cancelled.');
    }
    validateMediaAsset({ ...input.asset, size: blob.size });

    const path = buildMediaPath(
      input.accountId,
      input.asset.name,
      dependencies.now()
    );
    const objectUrl = `${dependencies.supabaseUrl}/storage/v1/object/${CHAT_MEDIA_BUCKET}/${encodedPath(path)}`;
    const publicUrl = `${dependencies.supabaseUrl}/storage/v1/object/public/${CHAT_MEDIA_BUCKET}/${encodedPath(path)}`;
    let token = await sessionToken(
      dependencies.auth.getSession.bind(dependencies.auth)
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
      ensureSelectedBranch(input.accountId, dependencies);
      if (aborted) {
        throw new MediaUploadError('aborted', 'Attachment upload cancelled.');
      }
      const request = dependencies.createRequest();
      activeRequest = request;
      const status = await requestStatus(
        request,
        'POST',
        objectUrl,
        uploadHeaders(
          token,
          input.accountId,
          input.asset.mimeType,
          dependencies.anonKey
        ),
        blob,
        input.onProgress
      );
      activeRequest = null;

      if (status >= 200 && status < 300) {
        input.onProgress?.(1);
        return { path, publicUrl };
      }
      if (status === 409 && attempt === 1) {
        input.onProgress?.(1);
        return { path, publicUrl };
      }
      if (status === 401 && attempt === 0) {
        token = await sessionToken(
          dependencies.auth.refreshSession.bind(dependencies.auth)
        );
        continue;
      }
      if (status === 401) {
        try {
          await dependencies.recoverUnauthorizedSession?.();
        } catch {
          // Recovery owner decides how the auth surface resolves.
        }
        throw new MediaUploadError('unauthorized', 'Your session has expired.');
      }
      if (status === 403) {
        throw new MediaUploadError(
          'forbidden',
          'You cannot upload from this branch.'
        );
      }
      throw new MediaUploadError(
        'storage',
        'Could not upload this attachment.'
      );
    }
    throw new MediaUploadError('storage', 'Could not upload this attachment.');
  })();

  return {
    promise,
    abort() {
      if (aborted) return;
      aborted = true;
      abortController.abort();
      activeRequest?.abort();
    },
  };
}

export async function deleteConversationMedia(
  input: DeleteConversationMediaInput,
  options: MediaUploadDependencies = {}
): Promise<void> {
  const dependencies = resolveDependencies(options);
  if (
    dependencies.selectedBranch.get() !== input.accountId ||
    !input.path.startsWith(`account-${input.accountId}/`)
  ) {
    return;
  }
  try {
    const token = await sessionToken(
      dependencies.auth.getSession.bind(dependencies.auth)
    );
    const request = dependencies.createRequest();
    await requestStatus(
      request,
      'DELETE',
      `${dependencies.supabaseUrl}/storage/v1/object/${CHAT_MEDIA_BUCKET}`,
      {
        Authorization: `Bearer ${token}`,
        apikey: dependencies.anonKey,
        'x-usefuldesk-account-id': input.accountId,
        'Content-Type': 'application/json',
      },
      JSON.stringify({ prefixes: [input.path] })
    );
  } catch {
    // Best-effort cleanup: never obscure the user's primary action.
  }
}
