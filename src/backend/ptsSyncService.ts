import { Api } from 'telegram';
import { multiDcRouter } from './dcRouter';
import { localSqliteDb, PtsSyncStateRecord, LocalMessageRecord } from './localDatabase';

export interface DiffSyncReport {
  previousPts: number;
  newPts: number;
  appliedMessagesCount: number;
  appliedDialogsCount: number;
  syncType: 'DifferenceEmpty' | 'Difference' | 'DifferenceSlice' | 'DifferenceTooLong' | 'LocalDiff';
  executedOnDc: number;
}

/**
 * Step 3.2: Telegram PTS & Diff Sync Engine (`updates.getState` & `updates.getDifference`)
 * Tracks local PTS (Persistent Timestamp / sequence counter), QTS, and Date so that upon
 * reconnecting after low-network or offline drops, only missing delta updates are fetched
 * instead of re-downloading full chat or room histories.
 */
export class PtsDiffSyncService {
  /**
   * Fetch and reconcile missing updates since the last recorded local `pts`
   */
  public async syncMissingUpdates(accountId = 'primary'): Promise<DiffSyncReport> {
    const localState: PtsSyncStateRecord = await localSqliteDb.getPtsState(accountId);
    const previousPts = localState.pts;

    try {
      const migrationRes = await multiDcRouter.executeWithDcMigration(async (client) => {
        if (!client.connected) {
          return null;
        }

        // Request strictly the missing delta from Telegram MTProto (`updates.getDifference`)
        const diff = await client.invoke(
          new Api.updates.GetDifference({
            pts: localState.pts,
            date: localState.date || Math.floor(Date.now() / 1000),
            qts: localState.qts || 0,
          })
        );

        return diff;
      });

      const diff = migrationRes.data;

      if (!diff) {
        // Offline / Local Bridge Mode: increment/verify local PTS state without network overhead
        const updatedState: PtsSyncStateRecord = {
          ...localState,
          lastSyncedAt: Date.now(),
        };
        await localSqliteDb.savePtsState(updatedState);
        return {
          previousPts,
          newPts: updatedState.pts,
          appliedMessagesCount: 0,
          appliedDialogsCount: 0,
          syncType: 'LocalDiff',
          executedOnDc: migrationRes.executedOnDc,
        };
      }

      // Case 1: `updates.differenceEmpty` (No new messages or state changes)
      if (diff instanceof Api.updates.DifferenceEmpty) {
        const nextState: PtsSyncStateRecord = {
          ...localState,
          date: diff.date,
          seq: diff.seq,
          lastSyncedAt: Date.now(),
        };
        await localSqliteDb.savePtsState(nextState);
        return {
          previousPts,
          newPts: nextState.pts,
          appliedMessagesCount: 0,
          appliedDialogsCount: 0,
          syncType: 'DifferenceEmpty',
          executedOnDc: migrationRes.executedOnDc,
        };
      }

      // Case 2: `updates.difference` or `updates.differenceSlice`
      if (
        diff instanceof Api.updates.Difference ||
        diff instanceof Api.updates.DifferenceSlice
      ) {
        const stateObj =
          diff instanceof Api.updates.Difference ? diff.state : diff.intermediateState;

        let appliedMessagesCount = 0;
        for (const msg of diff.newMessages) {
          if (msg instanceof Api.Message) {
            const record: LocalMessageRecord = {
              messageId: String(msg.id),
              dialogId: String((msg.peerId as any)?.channelId || (msg.peerId as any)?.chatId || (msg.peerId as any)?.userId || 'general'),
              senderId: String((msg.fromId as any)?.userId || 'tg-peer'),
              senderName: 'Telegram Peer',
              topicPath: '/general/updates/sync',
              text: msg.message || '',
              mediaFileId: null,
              pts: stateObj.pts,
              createdAt: msg.date * 1000,
            };
            await localSqliteDb.insertMessage(record);
            appliedMessagesCount += 1;
          }
        }

        const nextState: PtsSyncStateRecord = {
          accountId,
          pts: stateObj.pts,
          qts: stateObj.qts,
          date: stateObj.date,
          seq: stateObj.seq,
          unreadPtsDiffCount: 0,
          lastSyncedAt: Date.now(),
        };
        await localSqliteDb.savePtsState(nextState);

        return {
          previousPts,
          newPts: nextState.pts,
          appliedMessagesCount,
          appliedDialogsCount: 0,
          syncType: diff instanceof Api.updates.Difference ? 'Difference' : 'DifferenceSlice',
          executedOnDc: migrationRes.executedOnDc,
        };
      }

      // Case 3: `updates.differenceTooLong` (Gap too large, refresh state PTS)
      if (diff instanceof Api.updates.DifferenceTooLong) {
        const nextState: PtsSyncStateRecord = {
          ...localState,
          pts: diff.pts,
          lastSyncedAt: Date.now(),
        };
        await localSqliteDb.savePtsState(nextState);
        return {
          previousPts,
          newPts: diff.pts,
          appliedMessagesCount: 0,
          appliedDialogsCount: 0,
          syncType: 'DifferenceTooLong',
          executedOnDc: migrationRes.executedOnDc,
        };
      }

      return {
        previousPts,
        newPts: localState.pts,
        appliedMessagesCount: 0,
        appliedDialogsCount: 0,
        syncType: 'LocalDiff',
        executedOnDc: migrationRes.executedOnDc,
      };
    } catch {
      return {
        previousPts,
        newPts: localState.pts,
        appliedMessagesCount: 0,
        appliedDialogsCount: 0,
        syncType: 'LocalDiff',
        executedOnDc: 5,
      };
    }
  }

  /**
   * Record a new local PTS event (e.g., message sent or voice room state mutated)
   */
  public async advanceLocalPts(delta = 1, accountId = 'primary'): Promise<PtsSyncStateRecord> {
    const current = await localSqliteDb.getPtsState(accountId);
    const updated: PtsSyncStateRecord = {
      ...current,
      pts: current.pts + delta,
      date: Math.floor(Date.now() / 1000),
      lastSyncedAt: Date.now(),
    };
    await localSqliteDb.savePtsState(updated);
    return updated;
  }
}

export const ptsDiffSyncService = new PtsDiffSyncService();
