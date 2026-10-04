declare module 'tdweb' {
  export interface TdOptions {
    useTestDC?: boolean;
    readOnly?: boolean;
    verbosity?: number;
    jsLogVerbosity?: number;
    fastUpdating?: boolean;
    useDatabase?: boolean;
    mode?: 'wasm' | 'asmjs';
    instanceName?: string;
    onUpdate?: (update: any) => void;
  }

  export default class TdClient {
    constructor(options: TdOptions);
    send(query: Record<string, any>): Promise<any>;
  }
}
