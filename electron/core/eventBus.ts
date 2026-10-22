import { EventEmitter } from 'node:events';

export interface CoreEvent {
  type: string;
  at: string;
  payload?: unknown;
}

export class CoreEventBus {
  private readonly emitter = new EventEmitter();

  publish(type: string, payload?: unknown) {
    const event: CoreEvent = {
      type,
      at: new Date().toISOString(),
      payload,
    };

    this.emitter.emit('event', event);
  }

  subscribe(listener: (event: CoreEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}
