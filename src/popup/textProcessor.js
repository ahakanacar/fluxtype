/**
 * @file textProcessor.js
 * @description Linguistic Sanitization Module for Custom Text Injection.
 * 
 * RATIONALE:
 * When processing user-provided raw text, we must ensure the output is 
 * "native-pure" for the velocity engine. This involves aggressive 
 * normalization to prevent character-encoding glitches during typing.
 * 
 * STRATEGY:
 * 1. Normalization: Standardize to lowercase for consistency.
 * 2. Sanitization: Strip non-printable ASCII and control characters using 
 *    a range-based regex [^\x20-\x7E\s].
 * 3. Tokenization: Split by greedy whitespace regex /\s+/ to handle 
 *    multi-line paste buffers efficiently.
 */

const TextProcessor = {
    /**
     * Tokenizes a raw string into a clean, typed-safe array of words.
     * @param {string} text - The raw input string from the UI.
     * @returns {string[]} An array of sanitized word tokens.
     */
    process(text) {
        if (!text || typeof text !== 'string') return [];

        return text
            .toLowerCase()
            .replace(/[^\x20-\x7E\s]/g, '') // Strip non-printable range
            .trim()
            .split(/\s+/) // Greedy whitespace split
            .filter(word => word.length > 0);
    }
};
