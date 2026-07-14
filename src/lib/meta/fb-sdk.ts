// ============================================================
// Facebook JS SDK loader — shared by every Facebook Login for Business
// flow in the app (WhatsApp Embedded Signup, Lead Ads page connect).
//
// The promise is a module singleton on purpose: FB.init() must run
// exactly once per page. Two components each loading their own copy
// would double-init the SDK and race.
// ============================================================

// Must match META_API_VERSION in src/lib/whatsapp/meta-api.ts — the
// popup session and the server-side code exchange should speak the same
// Graph version.
export const FB_SDK_VERSION = 'v21.0';

export interface FbLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}

export interface FbSdk {
  init: (opts: {
    appId: string;
    autoLogAppEvents?: boolean;
    xfbml?: boolean;
    version: string;
  }) => void;
  login: (
    callback: (response: FbLoginResponse) => void,
    opts: {
      config_id: string;
      response_type: string;
      override_default_response_type: boolean;
      extras?: Record<string, unknown>;
    },
  ) => void;
}

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

let sdkPromise: Promise<FbSdk> | null = null;

export function loadFbSdk(appId: string): Promise<FbSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FbSdk>((resolve, reject) => {
    if (window.FB) {
      resolve(window.FB);
      return;
    }
    window.fbAsyncInit = () => {
      if (!window.FB) {
        reject(new Error('Facebook SDK loaded but window.FB is missing.'));
        return;
      }
      window.FB.init({
        appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: FB_SDK_VERSION,
      });
      resolve(window.FB);
    };
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      sdkPromise = null;
      reject(
        new Error('Could not load the Facebook SDK (blocked by an ad-blocker?).'),
      );
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}
