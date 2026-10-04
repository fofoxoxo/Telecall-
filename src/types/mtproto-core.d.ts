declare module '@mtproto/core/envs/browser' {
  export default class MTProto {
    constructor(options: {
      api_id: number;
      api_hash: string;
      test?: boolean;
      storageOptions?: {
        instance?: {
          set(key: string, value: string): Promise<void>;
          get(key: string): Promise<string | null>;
        };
      };
    });
    call(method: string, params?: Record<string, any>, options?: { dcId?: number; syncAuth?: boolean }): Promise<any>;
    updateInitConnectionParams(params: Record<string, any>): void;
    crypto: {
      getSRPParams(options: {
        g: number;
        p: Uint8Array;
        salt1: Uint8Array;
        salt2: Uint8Array;
        gB: Uint8Array;
        password: string;
      }): Promise<{ A: Uint8Array; M1: Uint8Array }>;
    };
    updates: {
      on(event: string, callback: (update: any) => void): void;
    };
  }
}
