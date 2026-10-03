import type { Session } from "./store.js";

export type DeckEvent =
  | { type: "output"; sessionId: string; chunk: string }
  | { type: "session"; session: Session };

export type DeckListener = (event: DeckEvent) => void;

export class DeckEvents {
  private readonly listeners = new Set<DeckListener>();

  subscribe(listener: DeckListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: DeckEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        continue;
      }
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
