/** Domain-neutral turn driver shared by robot and scene agents.
 * Domain adapters own messages, tools, draft transactions and completion checks.
 * Returning null from complete asks the model to continue with verification feedback.
 */
export interface ToolCallingLoopOptions<Message, Call, Result> {
  signal?: AbortSignal;
  maxSteps: number;
  maxToolCalls: number;
  request: (step: number) => Promise<Message>;
  calls: (message: Message) => readonly Call[];
  execute: (call: Call, step: number, index: number, total: number) => Promise<void>;
  complete: (message: Message, step: number) => Promise<Result | null>;
  limit: (step: number, budget: 'steps' | 'tools') => Promise<Result>;
  onToolBatch?: (step: number) => Promise<void>;
}

export async function runToolCallingLoop<Message, Call, Result>(
  options: ToolCallingLoopOptions<Message, Call, Result>,
): Promise<Result> {
  for (const value of [options.maxSteps, options.maxToolCalls]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Agent budgets must be positive integers.');
  }
  let toolCount = 0;
  for (let step = 1; step <= options.maxSteps; step += 1) {
    options.signal?.throwIfAborted();
    const message = await options.request(step);
    options.signal?.throwIfAborted();
    const calls = options.calls(message);
    if (!calls.length) {
      const result = await options.complete(message, step);
      options.signal?.throwIfAborted();
      if (result !== null) return result;
      continue;
    }
    await options.onToolBatch?.(step);
    for (let index = 0; index < calls.length; index += 1) {
      options.signal?.throwIfAborted();
      if (toolCount >= options.maxToolCalls) return options.limit(step, 'tools');
      toolCount += 1;
      await options.execute(calls[index]!, step, index, calls.length);
      options.signal?.throwIfAborted();
    }
  }
  return options.limit(options.maxSteps, 'steps');
}
