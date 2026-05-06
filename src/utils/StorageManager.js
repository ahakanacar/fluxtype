/**
 * @file StorageManager.js
 * @description Unified Persistence Layer for Atomic Web Storage Operations.
 * 
 * ARCHITECTURAL CONSTRAINT:
 * Although migrated from the asynchronous chrome.storage API to the synchronous native 
 * localStorage/sessionStorage, this module retains the serialized AsyncQueue architecture. 
 * This is a strategic safeguard to enforce Read-Modify-Write (RMW) atomicity during 
 * high-frequency telemetry logging (e.g., real-time keystroke and WPM updates). 
 * 
 * By wrapping synchronous operations in a Promise-based FIFO queue, we prevent 
 * race conditions and ensure that sequential state mutations are processed 
 * deterministically within the single-tab unified context.
 */

class AsyncQueue {
    constructor() {
        this._tail = Promise.resolve();
    }

    /**
     * Serializes execution by chaining tasks onto a rolling Promise tail.
     * Prevents overlapping execution of critical sections in the event loop.
     */
    enqueue(task) {
        this._tail = this._tail.then(async () => {
            try {
                return await task();
            } catch (error) {
                console.error("StorageManager: AsyncQueue task failure", error);
                throw error;
            }
        }).catch(() => {
            // Chain continuity guard: Allow subsequent tasks to execute if a predecessor fails.
        });
        return this._tail;
    }
}

window.StorageManager = {
    _queues: {
        local: new AsyncQueue(),
        session: new AsyncQueue()
    },

    _getArea(area) {
        return area === 'local' ? localStorage : sessionStorage;
    },

    /**
     * Non-blocking retrieval. Bypasses the queue for performance as it does not mutate state.
     */
    async get(area, keys) {
        const storage = this._getArea(area);
        const results = {};
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'object' ? Object.keys(keys) : [keys]);
        
        keyList.forEach(key => {
            const val = storage.getItem(key);
            try {
                results[key] = val !== null ? JSON.parse(val) : (typeof keys === 'object' ? keys[key] : undefined);
            } catch {
                results[key] = val;
            }
        });
        
        return results;
    },

    /**
     * Enforces serialized persistence to avoid state fragmentation.
     */
    async set(area, items) {
        const storage = this._getArea(area);
        return this._queues[area].enqueue(async () => {
            Object.entries(items).forEach(([key, value]) => {
                storage.setItem(key, JSON.stringify(value));
            });
        });
    },

    /**
     * TRANSACTIONAL INTEGRITY: Read-Modify-Write safeguard.
     * Essential for aggregating telemetry data where current state must be 
     * accurately hydrated before the next increment.
     */
    async update(area, key, updater) {
        const storage = this._getArea(area);
        return this._queues[area].enqueue(async () => {
            const currentData = await this.get(area, [key]);
            const newValue = await updater(currentData[key]);
            storage.setItem(key, JSON.stringify(newValue));
            return newValue;
        });
    },

    /**
     * Serialized purge of specified keys.
     */
    async remove(area, keys) {
        const storage = this._getArea(area);
        const keyList = Array.isArray(keys) ? keys : [keys];
        return this._queues[area].enqueue(async () => {
            keyList.forEach(key => storage.removeItem(key));
        });
    }
};
