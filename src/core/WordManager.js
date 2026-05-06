/**
 * @file WordManager.js
 * @description Decoupled linguistic delivery engine for high-performance text generation.
 * 
 * DESIGN PRINCIPLES:
 * 1. Single Responsibility (SRP): This module manages strictly the loading, 
 *    shuffling, and delivery of word buffers. It remains agnostic of UI state or scoring logic.
 * 2. Performance: Implements an in-place Fisher-Yates (Grand Shuffle) for O(n) efficiency, 
 *    ensuring that even large custom pools are randomized without blocking the main thread.
 * 3. Infinite Flow: Uses a circular buffer pattern to ensure the typing engine never 
 *    encounters an empty word stream.
 */



class WordManager {
    constructor() {
        this._activePool = [];
        this._currentIndex = 0;
        this._currentLang = 'en';
    }

    /**
     * Initializes the manager and performs the initial "Grand Shuffle".
     * @param {string} lang - ISO 639-1 language code.
     * @param {string[]} [customPool] - Optional user-provided word list.
     */
    async initialize(lang = 'en', customPool = null) {
        this._currentLang = lang;
        
        let source = (lang === 'custom' && customPool) 
            ? customPool 
            : (dictionaries[lang] || dictionaries.en);

        // Fail-safe: ensure source is valid
        if (!source || source.length === 0) {
            console.error(`WordManager: Source for ${lang} is empty or invalid. Falling back to EN.`);
            source = dictionaries.en;
        }

        // Deep clone to prevent mutation of the dictionary registry
        this._activePool = [...source];
        this._grandShuffle(this._activePool);
        this._currentIndex = 0;
    }

    /**
     * Fisher-Yates Shuffle (O(n)).
     * @private
     */
    _grandShuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    /**
     * Circular Buffer Delivery: Retrieves the next N words from the randomized pool.
     * Re-shuffles automatically upon exhaustion to maintain "Infinite Flow".
     * @param {number} count - Number of words to retrieve.
     */
    getWords(count) {
        if (this._activePool.length === 0) return Array(count).fill('error');

        const words = [];
        for (let i = 0; i < count; i++) {
            if (this._currentIndex >= this._activePool.length) {
                this._grandShuffle(this._activePool);
                this._currentIndex = 0;
            }
            words.push(this._activePool[this._currentIndex]);
            this._currentIndex++;
        }
        return words;
    }
}

window.wordManager = new WordManager();
