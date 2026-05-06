/**
 * @file TypingEngine.js
 * @description State-orchestration engine for the Fluxtype Velocity Core.
 * 
 * DESIGN RATIONALE:
 * This engine adheres to the Single Responsibility Principle (SRP) by delegating 
 * analytical concerns to specialized helper classes. The main `TypingEngine` 
 * serves as the "State Coordinator," managing raw inputs and event timing, while 
 * specialized analyzers handle the "Performance Math" and "Heatmap Aggregation."
 * 
 * ARCHITECTURE:
 * 1. TypingEngine (Orchestrator): Manages event listeners and input state.
 * 2. PerformanceAnalyzer (SRP): Calculates WPM, Accuracy, and Rolling Averages.
 * 3. HeatmapTracker (SRP): Aggregates character-level latency and error metrics.
 */

/**
 * PerformanceAnalyzer: Handles the heavy lifting of statistical computation.
 */
class PerformanceAnalyzer {
    constructor() {
        this.totalKeystrokes = 0;
        this.correctKeystrokes = 0;
        this.peakWpm = 0;
        this.keystrokeTimes = [];
    }

    /**
     * Calculates rolling WPM and updates peak metrics.
     * Uses a 5-key rolling average clamped at 350 WPM to mitigate burst-speed artifacts.
     */
    calculateRollingWpm(now) {
        this.keystrokeTimes.push(now);
        if (this.keystrokeTimes.length > 5) this.keystrokeTimes.shift();

        if (this.keystrokeTimes.length === 5) {
            const durationMs = this.keystrokeTimes[4] - this.keystrokeTimes[0];
            if (durationMs > 0) {
                const rollingWpm = Math.round(60000 / durationMs); // (5 chars / 5) / (ms / 60000)
                this.peakWpm = Math.max(this.peakWpm, Math.min(rollingWpm, 350));
            }
        }
    }

    getMetrics(startTime) {
        const durationMin = (Date.now() - startTime) / 60000;
        const wpm = durationMin > 0 ? Math.round((this.correctKeystrokes / 5) / durationMin) : 0;
        const accuracy = this.totalKeystrokes > 0 
            ? Math.round((this.correctKeystrokes / this.totalKeystrokes) * 100) 
            : 100;
        
        return { wpm, accuracy, peakWpm: this.peakWpm };
    }
}



/**
 * HeatmapTracker: Manages the spatial latency and error distribution map.
 */
class HeatmapTracker {
    constructor() {
        this.data = {};
        this._lastKeyTime = null;
    }

    logKeystroke(key, status) {
        if (!this.data[key]) {
            this.data[key] = { count: 0, error: 0, backspace: 0, totalLatency: 0 };
        }
        
        const stats = this.data[key];
        stats.count++;
        if (status === 'error') stats.error++;
        if (status === 'backspace') stats.backspace++;

        const now = Date.now();
        if (this._lastKeyTime) {
            stats.totalLatency += (now - this._lastKeyTime);
        }
        this._lastKeyTime = now;
    }
}



class TypingEngine {
    constructor(callbacks, initialState = null) {
        this.callbacks = callbacks;
        this.analyzer = new PerformanceAnalyzer();
        this.heatmap = new HeatmapTracker();

        this._boundHandleKeydown = this.handleKeydown.bind(this);
        this._initInternalState(initialState);
        this._setupListeners();
    }

    _initInternalState(state = null) {
        this.words = state?.words || [];
        this.currentWordIndex = state?.currentWordIndex || 0;
        this.currentCharIndex = state?.currentCharIndex || 0;
        this.rawInput = state?.rawInput || "";
        this.startTime = state?.startTime || null;
        this.wordStartTime = state?.wordStartTime || null;
        this.isFinished = state?.isFinished || false;
        this.sessionAuditLog = state?.sessionAuditLog || [];
        
        // Rehydrate analyzer if provided
        if (state?.analyzer) {
            this.analyzer.totalKeystrokes = state.analyzer.totalKeystrokes || 0;
            this.analyzer.correctKeystrokes = state.analyzer.correctKeystrokes || 0;
            this.analyzer.peakWpm = state.analyzer.peakWpm || 0;
        }
    }

    _setupListeners() {
        window.addEventListener('keydown', this._boundHandleKeydown);
    }

    destroy() {
        window.removeEventListener('keydown', this._boundHandleKeydown);
    }

    setWords(words) {
        this.words = words;
    }

    /**
     * Main Input Handler: Coordinates between state mutation and analytical tracking.
     */
    handleKeydown(e) {
        // Firewall: Prevent engine interaction when user is in input/textarea context
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
        if (this.isFinished) return;

        const { key } = e;
        const now = Date.now();

        if ([' ', 'Backspace', 'Tab'].includes(key)) e.preventDefault();

        if (!this.startTime && key.length === 1) {
            this.startTime = now;
            this.callbacks.onTestStart?.();
        }

        this._routeKey(key, now);
        this._syncMetrics();
    }

    /**
     * Logic Router: Directs keystrokes to the appropriate state handlers.
     * @private
     */
    _routeKey(key, now) {
        if (key === ' ') {
            this._handleSpace();
        } else if (key === 'Backspace') {
            this._handleBackspace();
        } else if (key.length === 1) {
            if (!this.wordStartTime) this.wordStartTime = now;
            this._handleCharacter(key);
            this.analyzer.calculateRollingWpm(now);
        }
    }

    _handleCharacter(char) {
        const targetWord = this.words[this.currentWordIndex];
        if (!targetWord) return;

        const isCorrect = (this.currentCharIndex < targetWord.length) && (char === targetWord[this.currentCharIndex]);
        
        this.rawInput += char;
        this.analyzer.totalKeystrokes++;
        if (isCorrect) this.analyzer.correctKeystrokes++;

        this.heatmap.logKeystroke(char, isCorrect ? 'correct' : 'error');
        this.currentCharIndex++;
        
        this.callbacks.onCharUpdate({
            wordIndex: this.currentWordIndex,
            charIndex: this.currentCharIndex - 1,
            input: char,
            isCorrect,
            rawInput: this.rawInput
        });
    }

    _handleBackspace() {
        if (this.rawInput.length === 0) return;
        this.rawInput = this.rawInput.slice(0, -1);
        this.currentCharIndex--;

        this.callbacks.onCharUpdate({
            wordIndex: this.currentWordIndex,
            charIndex: this.currentCharIndex,
            isBackspace: true,
            rawInput: this.rawInput
        });
    }

    _handleSpace() {
        if (this.rawInput.length === 0) return;

        const targetWord = this.words[this.currentWordIndex];
        const isWordCorrect = this.rawInput === targetWord;
        const timeSpent = this.wordStartTime ? Date.now() - this.wordStartTime : 0;

        // Atomic audit logging
        this.sessionAuditLog.push({
            targetWord,
            typedWord: this.rawInput,
            isCorrect: isWordCorrect,
            timeSpent,
            charErrors: this._mapCharErrors(targetWord, this.rawInput)
        });

        this.rawInput = "";
        this.currentCharIndex = 0;
        this.currentWordIndex++;
        this.wordStartTime = null;

        this.callbacks.onWordComplete({
            wordIndex: this.currentWordIndex - 1,
            isCorrect: isWordCorrect
        });
    }

    /**
     * Diff-engine for character level error mapping.
     * @private
     */
    _mapCharErrors(target, input) {
        const errors = [];
        const maxLen = Math.max(target.length, input.length);
        for (let i = 0; i < maxLen; i++) {
            if (target[i] !== input[i]) {
                errors.push({ expected: target[i] || "[NONE]", got: input[i] || "[NONE]" });
            }
        }
        return errors;
    }

    _syncMetrics() {
        if (!this.startTime) return;
        const metrics = this.analyzer.getMetrics(this.startTime);
        this.callbacks.onMetricsUpdate?.(metrics);
        
        // Proxy public properties for external consumer (e.g., UI display)
        this.wpm = metrics.wpm;
        this.accuracy = metrics.accuracy;
        this.peakWpm = metrics.peakWpm;
        this.totalKeystrokes = this.analyzer.totalKeystrokes;
        this.correctKeystrokes = this.analyzer.correctKeystrokes;
        this.heatmapData = this.heatmap.data;

        // BROADCAST: Send current state for background rehydration
        this.callbacks.onSessionUpdate?.({
            state: 'TYPING',
            words: this.words, // Persist the active buffer to prevent stream mismatch on rehydration
            currentWordIndex: this.currentWordIndex,
            currentCharIndex: this.currentCharIndex,
            rawInput: this.rawInput,
            startTime: this.startTime,
            analyzer: {
                totalKeystrokes: this.analyzer.totalKeystrokes,
                correctKeystrokes: this.analyzer.correctKeystrokes,
                peakWpm: this.analyzer.peakWpm
            },
            metrics: { wpm: this.wpm, accuracy: this.accuracy }
        });
    }
}

window.TypingEngine = TypingEngine;
