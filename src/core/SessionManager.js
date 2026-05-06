/**
 * @file SessionManager.js
 * @description Unified State Orchestrator for Session Persistence and Statistical Auditing.
 * 
 * ARCHITECTURAL CONSOLIDATION:
 * This module serves as the functional successor to the Chrome Extension's background 
 * service worker. It encapsulates the application's unified execution thread within 
 * a single-tab context, managing global state rehydration and persistence without 
 * cross-process messaging overhead.
 * 
 * It interfaces directly with the StorageManager's serialized queue to ensure 
 * telemetry integrity and reacts to categorized signals from the localized Messaging bus.
 */



const SESSION_KEY = 'fluxtype_active_session';
const STATS_KEY = 'stats';

class SessionManager {
    constructor() {
        this._isInitialized = false;
    }

    /**
     * Initializes the orchestrator and attaches the primary message dispatcher 
     * to the global Messaging bus.
     */
    async initialize() {
        if (this._isInitialized) return;

        // Register with Messaging Bus
        Messaging.onMessage(this._handleMessage.bind(this));
        
        // Initial rehydration (equivalent to lifecycle.hydrate)
        await this._hydrate();
        
        this._isInitialized = true;
        console.log("SessionManager: Unified thread initialized and synchronized.");
    }

    /**
     * Cold-boot hydration: Restores linguistic engine and user preferences 
     * from persistent storage.
     * @private
     */
    async _hydrate() {
        const data = await StorageManager.get('local', ['settings', STATS_KEY]);
        // Re-initialize linguistic engine if needed
        if (data.settings?.activeLanguage) {
            await wordManager.initialize(data.settings.activeLanguage);
        }
    }

    /**
     * Centralized Signal Dispatcher: Implements the "Categorized Message" 
     * processing logic previously handled by the extension background script.
     * @private
     */
    async _handleMessage(message) {
        const { type, action, payload } = message;

        switch (action) {
            case 'PING':
                return 'PONG';

            case 'GET_SESSION_STATE':
                return this._handleGetSessionState(type);

            case 'UPDATE_SESSION_STATE':
                return this._handleUpdateSessionState(type, payload);

            case 'CLEAR_SESSION':
                return this._handleClearSession(type);

            case 'GET_STATS':
                return this._handleGetStats(type);

            case 'UPDATE_STATS':
                return this._handleUpdateStats(type, payload);

            case 'KEEP_ALIVE':
                return 'OK';

            default:
                return undefined; // Let other listeners handle if applicable
        }
    }

    async _handleGetSessionState(type) {
        if (type !== MessageType.QUERY) throw new Error("Messaging: QUERY required for state retrieval");
        const data = await StorageManager.get('session', SESSION_KEY);
        return data[SESSION_KEY] || { state: 'IDLE' };
    }

    async _handleUpdateSessionState(type, payload) {
        if (type !== MessageType.ACTION) throw new Error("Messaging: ACTION required for state mutation");
        return StorageManager.update('session', SESSION_KEY, (current = { state: 'IDLE' }) => ({
            ...current,
            ...payload,
            lastUpdated: Date.now()
        }));
    }

    async _handleClearSession(type) {
        if (type !== MessageType.ACTION) throw new Error("Messaging: ACTION required for state removal");
        await StorageManager.remove('session', SESSION_KEY);
        return true;
    }

    async _handleGetStats(type) {
        const data = await StorageManager.get('local', STATS_KEY);
        return data[STATS_KEY]?.totalWords || 0;
    }

    async _handleUpdateStats(type, payload) {
        await StorageManager.update('local', STATS_KEY, (current = { totalWords: 0 }) => ({
            totalWords: current.totalWords + (payload.words || 0)
        }));
        return true;
    }
}

window.sessionManager = new SessionManager();
