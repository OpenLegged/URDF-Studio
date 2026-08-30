import assert from 'node:assert/strict'
import test from 'node:test'

import type { WorkerLike } from '@/core/workers/workerPoolClient.ts'
import { createScriptSandboxWorkerClient } from './scriptSandboxWorkerBridge.ts'

class HangingWorker implements WorkerLike {
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  terminated = false

  addEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener)
  }

  postMessage(): void {}

  emitError(message: string): void {
    for (const listener of this.listeners.get('error') ?? []) {
      if (typeof listener === 'function') {
        listener({ message } as ErrorEvent)
      } else {
        listener.handleEvent({ message } as unknown as Event)
      }
    }
  }

  terminate(): void {
    this.terminated = true
  }
}

test('aborting an agent script terminates its worker', async () => {
  const worker = new HangingWorker()
  const client = createScriptSandboxWorkerClient({
    canUseWorker: () => true,
    createWorker: () => worker,
    requestTimeoutMs: 0,
  })
  const controller = new AbortController()

  const outcomePromise = client.run({
    code: 'while (true) {}',
    draft: {},
    signal: controller.signal,
  })
  controller.abort()
  const outcome = await outcomePromise

  assert.deepEqual(outcome, { ok: false, error: 'Agent script aborted.' })
  assert.equal(worker.terminated, true)
  assert.equal(worker.listeners.get('message')?.size ?? 0, 0)
  assert.equal(worker.listeners.get('error')?.size ?? 0, 0)
  client.dispose()
})

test('a worker error settles pending agent scripts immediately', async () => {
  const worker = new HangingWorker()
  const client = createScriptSandboxWorkerClient({
    canUseWorker: () => true,
    createWorker: () => worker,
    requestTimeoutMs: 0,
  })

  const outcomePromise = client.run({ code: 'return draft;', draft: {} })
  worker.emitError('worker crashed')
  const outcome = await outcomePromise

  assert.deepEqual(outcome, {
    ok: false,
    error: 'Agent script worker failed: worker crashed',
  })
  assert.equal(worker.terminated, true)
})
