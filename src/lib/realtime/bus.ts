/**
 * PropertyPro - Realtime event bus
 *
 * Fans events (new message, new notification) out to the SSE streams. Two
 * modes, same API:
 *
 *  - REDIS_URL set  → Redis pub/sub carries events across every server
 *    instance/worker, which is what makes SSE correct behind a load balancer
 *    and lets a future standalone backend publish into the same channel.
 *  - REDIS_URL unset → in-process EventEmitter (single-instance dev), exactly
 *    the pre-Redis behavior.
 *
 * Local delivery is always via the in-process emitter; Redis messages from
 * OTHER instances are folded into it (self-published messages are skipped by
 * instance id so nothing is delivered twice).
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import Redis from "ioredis";

export type RealtimeEvent =
  | {
      type: "message.created";
      conversationId: string;
      participantIds: string[];
      message: any;
    }
  | {
      type: "notification.created";
      userId: string;
      notification: any;
    };

const REDIS_CHANNEL = "propertypro:realtime";

const globalKey = Symbol.for("propertypro.realtime.bus");

interface BusState {
  emitter: EventEmitter;
  instanceId: string;
  publisher?: Redis;
  subscriber?: Redis;
}

type GlobalWithBus = typeof globalThis & {
  [globalKey]?: BusState;
};

function createRedisClient(url: string, label: string): Redis {
  const client = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => Math.min(times * 500, 10_000),
  });
  client.on("error", (error) => {
    console.error(`realtime bus redis (${label}) error:`, error.message);
  });
  return client;
}

function getBus(): BusState {
  const g = globalThis as GlobalWithBus;
  if (g[globalKey]) return g[globalKey]!;

  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const state: BusState = { emitter, instanceId: randomUUID() };

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    state.publisher = createRedisClient(redisUrl, "pub");
    state.subscriber = createRedisClient(redisUrl, "sub");

    state.subscriber.subscribe(REDIS_CHANNEL).catch((error) => {
      console.error("realtime bus subscribe failed:", error);
    });
    state.subscriber.on("message", (channel, raw) => {
      if (channel !== REDIS_CHANNEL) return;
      try {
        const envelope = JSON.parse(raw) as {
          instanceId: string;
          event: RealtimeEvent;
        };
        // Own messages were already delivered locally on publish.
        if (envelope.instanceId === state.instanceId) return;
        emitter.emit("event", envelope.event);
      } catch (error) {
        console.error("realtime bus: malformed message dropped:", error);
      }
    });
  }

  g[globalKey] = state;
  return state;
}

export function publish(event: RealtimeEvent) {
  const bus = getBus();
  // Immediate local delivery — same-instance SSE streams never wait on Redis.
  bus.emitter.emit("event", event);

  if (bus.publisher) {
    bus.publisher
      .publish(
        REDIS_CHANNEL,
        JSON.stringify({ instanceId: bus.instanceId, event }),
      )
      .catch((error) => {
        console.error("realtime bus publish failed:", error.message);
      });
  }
}

export function subscribe(handler: (event: RealtimeEvent) => void) {
  const bus = getBus();
  bus.emitter.on("event", handler);
  return () => {
    bus.emitter.off("event", handler);
  };
}
