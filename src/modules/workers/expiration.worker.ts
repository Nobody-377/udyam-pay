import type { Logger } from 'pino';
import { assertTransition } from '../applications/application-state-machine';
import type { AppStores } from '../persistence/stores';

export interface ExpirationWorkerOptions {
  batchSize?: number;
  logger?: Logger;
}

export class ExpirationWorker {
  private readonly batchSize: number;
  private readonly logger?: Logger;

  constructor(
    private readonly stores: AppStores,
    options: ExpirationWorkerOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 100;
    this.logger = options.logger;
  }

  async runSweep(asOf: Date = new Date()): Promise<{ expiredSessions: number; expiredApplications: number }> {
    let expiredSessions = 0;
    let expiredApplications = 0;

    // 1. Sweep expired checkout sessions using persistence interface with bounded batch
    try {
      const sessions = await this.stores.checkoutSessions.findExpired(asOf, this.batchSize);
      for (const session of sessions) {
        try {
          await this.stores.checkoutSessions.markExpired(session.id);
          expiredSessions += 1;
        } catch (err) {
          this.logger?.warn({ err, sessionId: session.id }, 'Failed to mark checkout session expired');
        }
      }
    } catch (err) {
      this.logger?.error({ err }, 'Error querying expired checkout sessions');
    }

    // 2. Sweep expired applications using persistence interface with bounded batch
    try {
      const apps = await this.stores.applications.findExpired(asOf, this.batchSize);
      for (const app of apps) {
        try {
          // Transition through state machine to guarantee validity
          assertTransition(app.status, 'EXPIRED', { actor: 'SYSTEM' });

          await this.stores.applications.updateStatus({
            id: app.id,
            expectedVersion: app.version,
            toStatus: 'EXPIRED',
            actorType: 'SYSTEM',
            reason: 'Application validity period expired',
            terminalAt: asOf,
          });
          expiredApplications += 1;
        } catch (err) {
          // Handle concurrent optimistic concurrency conflicts safely
          this.logger?.info(
            { err, applicationId: app.id },
            'Application state changed concurrently during expiration sweep; skipping',
          );
        }
      }
    } catch (err) {
      this.logger?.error({ err }, 'Error querying expired applications');
    }

    return { expiredSessions, expiredApplications };
  }
}
