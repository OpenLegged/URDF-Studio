/**
 * Simple throttle function that limits function execution to once per specified interval.
 * Returns a throttled version of the function that can be cancelled.
 */
export function throttle<T extends (...args: unknown[]) => void>(
    fn: T,
    limit: number
): T & { cancel: () => void } {
    let lastCall = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let lastArgs: Parameters<T> | null = null;

    const throttled = ((...args: Parameters<T>) => {
        const now = Date.now();
        const remaining = limit - (now - lastCall);

        lastArgs = args;

        if (remaining <= 0) {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            lastCall = now;
            fn(...args);
        } else if (!timeoutId) {
            timeoutId = setTimeout(() => {
                lastCall = Date.now();
                timeoutId = null;
                if (lastArgs) {
                    fn(...lastArgs);
                }
            }, remaining);
        }
    }) as T & { cancel: () => void };

    throttled.cancel = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        lastArgs = null;
    };

    return throttled;
}
