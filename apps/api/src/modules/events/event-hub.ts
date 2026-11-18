import pg from 'pg';

/** What changed on an order (sent to its student and its stall). Details come from the API. */
export interface OrderEvent {
  /** Event id for SSE Last-Event-ID resumption. */
  id: string;
  orderId: string;
  userId: string;
  stallId: string;
  status: string;
  paymentStatus: string;
  tokenNo: number | null;
  at: string;
}

type Listener = (event: OrderEvent) => void;

interface HubLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

const CHANNEL = 'mom_orders';
const BUFFER = 500;

/**
 * Live order updates (spec §7.1 Realtime): one LISTEN connection per API process receives
 * Postgres notifications (sent by a trigger on `orders`) and fans them out to the SSE
 * connections of the right student and stall. Several API containers each listen, so every
 * user gets updates whichever container they're connected to.
 *
 * Keeps the last 500 events so a browser that reconnects with Last-Event-ID gets what it
 * missed; if its id is too old, it's told to resync (refetch).
 */
export class EventHub {
  private client: pg.Client | null = null;
  private readonly byUser = new Map<string, Set<Listener>>();
  private readonly byStall = new Map<string, Set<Listener>>();
  private readonly buffer: OrderEvent[] = [];
  private seq = 0;
  private stopped = false;
  private readonly stopHandlers = new Set<() => void>();

  constructor(private readonly log: HubLogger = { info() {}, warn() {}, error() {} }) {}

  /** Starts listening; retries with backoff and never throws (the API keeps working without it). */
  async connect(databaseUrl: string): Promise<void> {
    let delay = 1000;
    while (!this.stopped) {
      try {
        const client = new pg.Client({ connectionString: databaseUrl, application_name: 'mom-events' });
        await client.connect();
        await client.query(`LISTEN ${CHANNEL}`);
        if (this.stopped) {
          await client.end();
          return;
        }
        client.on('notification', (msg) => {
          if (msg.channel === CHANNEL && msg.payload) this.handle(msg.payload);
        });
        client.on('error', (err) => this.log.error({ err }, 'event listener connection error'));
        client.on('end', () => {
          if (this.client === client) this.client = null;
          if (!this.stopped) {
            this.log.warn({}, 'event listener disconnected; reconnecting');
            void this.connect(databaseUrl);
          }
        });
        this.client = client;
        this.log.info({ channel: CHANNEL }, 'listening for order changes');
        return;
      } catch (err) {
        this.log.error({ err }, `event listener could not connect; retrying in ${delay / 1000}s`);
        await new Promise((r) => setTimeout(r, delay).unref());
        delay = Math.min(delay * 2, 30_000);
      }
    }
  }

  /** Runs `fn` when the hub stops (used to end open SSE streams on shutdown). */
  onStop(fn: () => void): () => void {
    this.stopHandlers.add(fn);
    return () => this.stopHandlers.delete(fn);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const fn of [...this.stopHandlers]) fn();
    this.stopHandlers.clear();
    await this.client?.end().catch(() => {});
    this.client = null;
  }

  get listening(): boolean {
    return this.client !== null;
  }

  private handle(payload: string) {
    try {
      const data = JSON.parse(payload) as Omit<OrderEvent, 'id' | 'at'>;
      this.publish(data);
    } catch (err) {
      this.log.warn({ err }, 'ignored a malformed order notification');
    }
  }

  /** Records and delivers an event (called for each notification; tests may call it directly). */
  publish(data: Omit<OrderEvent, 'id' | 'at'>): OrderEvent {
    const event: OrderEvent = {
      ...data,
      id: `${Date.now().toString(36)}-${(this.seq++).toString(36)}`,
      at: new Date().toISOString(),
    };
    this.buffer.push(event);
    if (this.buffer.length > BUFFER) this.buffer.shift();
    this.byUser.get(event.userId)?.forEach((l) => l(event));
    this.byStall.get(event.stallId)?.forEach((l) => l(event));
    return event;
  }

  subscribeUser(userId: string, listener: Listener, lastEventId?: string) {
    return this.subscribe(this.byUser, userId, listener, lastEventId, (e) => e.userId === userId);
  }

  subscribeStall(stallId: string, listener: Listener, lastEventId?: string) {
    return this.subscribe(this.byStall, stallId, listener, lastEventId, (e) => e.stallId === stallId);
  }

  /**
   * Subscribes and, when resuming, replays missed events.
   * Returns `resync: true` when the last seen id is no longer known (client should refetch).
   */
  private subscribe(
    map: Map<string, Set<Listener>>,
    key: string,
    listener: Listener,
    lastEventId: string | undefined,
    mine: (e: OrderEvent) => boolean,
  ): { unsubscribe: () => void; resync: boolean } {
    let resync = false;
    if (lastEventId) {
      const at = this.buffer.findIndex((e) => e.id === lastEventId);
      if (at === -1) resync = true;
      else
        this.buffer
          .slice(at + 1)
          .filter(mine)
          .forEach(listener);
    }
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(listener);
    return {
      resync,
      unsubscribe: () => {
        set!.delete(listener);
        if (set!.size === 0) map.delete(key);
      },
    };
  }

  /** Open SSE connections (for logs/metrics). */
  get connections(): number {
    let n = 0;
    for (const s of this.byUser.values()) n += s.size;
    for (const s of this.byStall.values()) n += s.size;
    return n;
  }
}
