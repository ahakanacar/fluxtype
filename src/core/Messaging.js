/**
 * @file Messaging.js
 * @description Native EventBus for Unified Application Context communication.
 * 
 * ARCHITECTURAL RATIONALE:
 * In this standalone web version, the complex asynchronous message-passing of the 
 * Chrome Extension API (chrome.runtime.sendMessage) is replaced by a localized 
 * synchronous-first EventBus. 
 * 
 * This bridge encapsulates the unified execution thread within a single browser 
 * tab context, eliminating the need for background service worker coordination. 
 * It preserves the "Categorized Messaging" pattern (Action/Query/Event) to maintain 
 * compatibility with the decoupled core engine while ensuring zero latency in 
 * local state synchronization.
 */

window.MessageType = {
    ACTION: 'ACTION',
    QUERY: 'QUERY',
    EVENT: 'EVENT'
};

class MessagingBridge {
    constructor() {
        this._listeners = new Set();
    }

    /**
     * Entry point for state-mutating requests requiring deterministic resolution.
     */
    async action(action, payload = {}, options = {}) {
        return this._dispatch(MessageType.ACTION, action, payload, options);
    }

    /**
     * Entry point for data retrieval from the unified session state.
     */
    async query(action, payload = {}, options = {}) {
        return this._dispatch(MessageType.QUERY, action, payload, options);
    }

    /**
     * Broadcast point for non-blocking telemetry and lifecycle events.
     */
    async event(action, payload = {}, options = {}) {
        return this._dispatch(MessageType.EVENT, action, payload, { ...options, isEvent: true });
    }

    /**
     * Local dispatch engine. Resolves against registered domain handlers.
     * @private
     */
    async _dispatch(type, action, payload, options) {
        const requestId = crypto.randomUUID();
        const message = { type, action, payload, requestId, timestamp: Date.now() };

        try {
            for (const listener of this._listeners) {
                const response = await listener(message);
                if (response !== undefined) {
                    return response;
                }
            }
            
            if (action !== 'PING') {
                console.warn(`Messaging: Unhandled action [${action}]`);
            }
            return undefined;
        } catch (error) {
            console.error(`Messaging: Execution error in action [${action}]`, error);
            throw error;
        }
    }

    /**
     * Subscribes a functional module to the global message bus.
     */
    onMessage(callback) {
        this._listeners.add(callback);
    }
}

window.Messaging = new MessagingBridge();
