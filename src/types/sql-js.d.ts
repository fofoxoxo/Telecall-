declare module 'sql.js' {
  export interface Statement {
    bind(values?: any[] | Record<string, any>): boolean;
    step(): boolean;
    getAsObject(params?: any[] | Record<string, any>): Record<string, any>;
    free(): boolean;
  }

  export interface Database {
    run(sql: string, params?: any[] | Record<string, any>): Database;
    exec(sql: string, params?: any[] | Record<string, any>): Array<{
      columns: string[];
      values: any[][];
    }>;
    prepare(sql: string, params?: any[] | Record<string, any>): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
}
