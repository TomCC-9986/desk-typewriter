interface DeskBridge {
  invoke<T = unknown>(ch: string, ...args: unknown[]): Promise<T>;
  send(ch: string, ...args: unknown[]): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(ch: string, fn: (...args: any[]) => void): () => void;
}
declare global {
  interface Window { desk: DeskBridge }
}
export {};
