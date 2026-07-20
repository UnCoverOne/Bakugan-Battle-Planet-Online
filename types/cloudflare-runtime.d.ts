interface D1Result<T = unknown> {
  results?: T[];
  meta?: { changes?: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run<T = unknown>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface Fetcher { fetch(request: Request): Promise<Response>; }
interface DurableObjectStub { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>; }
interface DurableObjectNamespace {
  getByName(name: string): DurableObjectStub;
}

interface ScheduledController { scheduledTime: number; cron: string; noRetry(): void; }

interface WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

declare const WebSocketPair: {
  new(): { 0: WebSocket; 1: WebSocket };
};

declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
    MATCHES: DurableObjectNamespace;
  };
}
