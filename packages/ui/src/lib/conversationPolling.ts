/** What the incremental read needs of a message. */
export interface SequencedMessage {
  seq: number;
  status: string;
}

/**
 * `after_seq` for the next read of a conversation, or `undefined` for a full
 * read (nothing is cached yet).
 *
 * While an answer is pending the screen re-reads the conversation every few
 * seconds; reading it whole each time downloaded the entire thread (Mini App
 * audit 2026-11, П8). The catch: the worker turns the pending message into
 * the answer IN PLACE, under the same `seq` (`replace_message` in
 * `core.repositories.ai_conversations`). Reading «after the last seq» would
 * never see the answer arrive. So the read starts just before the earliest
 * pending message; with nothing pending — after the last one.
 */
export function nextAfterSeq(
  cached: readonly SequencedMessage[] | undefined,
): number | undefined {
  if (cached === undefined) return undefined;
  const pending = cached.filter((message) => message.status === "pending");
  if (pending.length > 0) {
    return Math.min(...pending.map((message) => message.seq)) - 1;
  }
  return cached.length === 0
    ? -1
    : Math.max(...cached.map((message) => message.seq));
}

/** The cached thread with the fresh messages put in by `seq`, in order. */
export function mergeBySeq<T extends SequencedMessage>(
  cached: readonly T[] | undefined,
  fresh: readonly T[],
): T[] {
  const bySeq = new Map<number, T>();
  for (const message of cached ?? []) bySeq.set(message.seq, message);
  for (const message of fresh) bySeq.set(message.seq, message);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}
