import { MessageEvent } from '@nestjs/common';
import { AccountMergeRequest, AccountMergeRequestDelta } from '@cacic/shared-types';
import { concat, concatMap, finalize, from, map, Observable, of, scan, takeWhile } from 'rxjs';

type MergeRequestWatch = { updates: Observable<unknown>; close: () => void };

export function isTerminalMergeRequest(request: AccountMergeRequest): boolean {
  return ['completed', 'cancelled', 'expired', 'failed'].includes(request.status);
}

export async function createMergeRequestStream(
  initialRequest: AccountMergeRequest,
  openWatch: () => Promise<MergeRequestWatch>,
  loadRequest: () => Promise<AccountMergeRequest>,
): Promise<Observable<MessageEvent>> {
  if (isTerminalMergeRequest(initialRequest)) {
    return of({ data: initialRequest });
  }

  const watch = await openWatch();
  return concat(from(loadRequest()), watch.updates.pipe(concatMap(() => from(loadRequest())))).pipe(
    takeWhile((request) => !isTerminalMergeRequest(request), true),
    scan((state, request) => ({ previous: request, delta: toMergeRequestDelta(state.previous, request) }), {
      previous: null as AccountMergeRequest | null,
      delta: null as AccountMergeRequestDelta | null,
    }),
    map(({ delta }) => ({ data: delta! })),
    finalize(() => watch.close()),
  );
}

function toMergeRequestDelta(
  previous: AccountMergeRequest | null,
  current: AccountMergeRequest,
): AccountMergeRequestDelta {
  if (!previous) return current;

  const delta: AccountMergeRequestDelta = { id: current.id };
  for (const key of Object.keys(current) as Array<keyof AccountMergeRequest>) {
    if (key !== 'id' && JSON.stringify(previous[key]) !== JSON.stringify(current[key])) {
      Object.assign(delta, { [key]: current[key] });
    }
  }
  return delta;
}
