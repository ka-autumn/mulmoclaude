/**
 * Process-level mutex to serialize write operations on the same files.
 * Since all database operations run inside the single host node process,
 * a simple Promise-chain is sufficient to guarantee sequential execution
 * and prevent concurrent file write corruptions.
 */
export class WriteMutex {
  private chain: Promise<unknown> = Promise.resolve();

  /**
   * Executes a given async operation when all previously queued operations complete.
   * Resolves or rejects with the result of the operation.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.catch(() => undefined).then(fn);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
