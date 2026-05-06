/**
 * @file popup.js
 * @description Unified UI Orchestrator for the Fluxtype Velocity Engine.
 * 
 * ARCHITECTURAL CONTEXT:
 * This module operates as the primary "View-Model" layer, mediating between the DOM 
 * and the underlying TypingEngine. In this standalone web version, it leverages 
 * the local Messaging bus to synchronize state with the SessionManager, effectively 
 * mimicking the decoupled architecture of the original Chrome Extension while 
 * executing within a single-tab unified thread.
 * 
 * DESIGN CONSTRAINTS:
 * 1. Sequential Initialization: All dependencies must be resolved globally via 
 *    index.html before this script executes.
 * 2. Atomic Boot: The TypingEngine is instantiated before async hydration to 
 *    prevent 'undefined' reference errors during session rehydration.
 */

let engine;
let sourceWordElements = [];
let analyticsInterval;
let timerInterval;
let remainingTime;

const getEl = (id) => document.getElementById(id);

/**
 * APPLICATION ENTRY POINT
 * Coordinates the multi-phase boot sequence: Session Recovery -> Preference Sync -> UI Binding.
 */
document.addEventListener('DOMContentLoaded', async () => {
    await sessionManager.initialize();
    await loadPreferences();
    await initEnvironment();

    /* BINDING: CORE INTERACTIVE SURFACE */
    getEl('langSelect')?.addEventListener('change', handleModeChange);
    getEl('timeSelect')?.addEventListener('change', handleModeChange);
    
    getEl('customToggle')?.addEventListener('click', (e) => {
        e.currentTarget.classList.toggle('active'); 
        toggleCustomDrawer(e.currentTarget.classList.contains('active')); 
        handleModeChange();
    });
    
    getEl('scaleRange')?.addEventListener('change', handleScaleChange);
    getEl('restart-btn')?.addEventListener('click', handleRestart);
    getEl('modal-restart-btn')?.addEventListener('click', handleRestart);
    getEl('export-btn')?.addEventListener('click', handleExport);
    getEl('full-report-btn')?.addEventListener('click', handleFullReport);
    
    window.addEventListener('keydown', (e) => {
        if (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT') return;
        if (e.key === 'Tab') { e.preventDefault(); handleRestart(); }
    });

    /* BINDING: CUSTOM CORPORA DRAWER */
    getEl('btn-save')?.addEventListener('click', () => {
        StorageManager.set('local', { lastCustomText: getEl('customInput')?.value || '' }); 
        toggleCustomDrawer(false); 
        handleModeChange();
    });

    getEl('btn-delete')?.addEventListener('click', () => {
        getEl('customInput').value = ''; 
        StorageManager.set('local', { lastCustomText: '' });
        getEl('customToggle').classList.remove('active'); 
        toggleCustomDrawer(false); 
        handleModeChange();
    });

    await checkSessionRehydration();
});

/**
 * STATE PURGE: Forced re-initialization on mode/parameter shift.
 */
async function handleModeChange() {
    try {
        await Messaging.action('CLEAR_SESSION');
    } catch (err) {
        console.warn("Messaging: Session purge failed, proceeding with engine reset.", err);
    }
    await initEngine();
}

/**
 * ENVIRONMENT SYNC: Rehydrates user preferences and applies global scaling.
 */
async function initEnvironment() {
    const data = await StorageManager.get('local', ['activeLanguage', 'activeTime', 'activeScale']);
    if (data.activeLanguage) getEl('langSelect').value = data.activeLanguage;
    if (data.activeTime) getEl('timeSelect').value = data.activeTime;
    if (data.activeScale) {
        if (getEl('scaleRange')) getEl('scaleRange').value = data.activeScale;
        applyScale(data.activeScale);
    }
    
    const lang = getEl('langSelect')?.value || 'en';
    translateUI(lang);
}

/**
 * REHYDRATION STRATEGY: 
 * Queries the SessionManager to determine if an active typing state exists. 
 * Prevents data loss during accidental refreshes or popup closures.
 */
async function checkSessionRehydration() {
    try {
        const session = await Messaging.query('GET_SESSION_STATE');
        const currentDuration = parseInt(getEl('timeSelect')?.value || '60');
        
        if (session.state === 'TYPING') {
            const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
            if (elapsed >= currentDuration) {
                await Messaging.action('CLEAR_SESSION');
                await initEngine();
            } else {
                await rehydrateTypingSession(session);
            }
        } else if (session.state === 'COMPLETED') {
            rehydrateResultScreen(session.lastResult);
        } else {
            await initEngine();
        }
    } catch (error) {
        console.warn("Rehydration: Failed to fetch session state.", error);
        await initEngine();
    }
}

async function rehydrateTypingSession(session) {
    await initEngine(session);
    
    const { currentWordIndex, currentCharIndex, rawInput, startTime, metrics } = session;
    
    for (let i = 0; i < currentWordIndex; i++) {
        const el = sourceWordElements[i];
        if (el) { el.classList.remove('active'); el.classList.add('finished'); }
    }
    if (sourceWordElements[currentWordIndex]) {
        sourceWordElements[currentWordIndex].classList.add('active');
        checkSourceScroll(sourceWordElements[currentWordIndex]);
    }
    
    renderInputChars(rawInput);
    updateCaret();
}

function rehydrateResultScreen(result) {
    showResults(result);
}

/**
 * ATOMIC ENGINE INITIALIZATION
 * @param {Object} [rehydrateState] - Optional state for session recovery.
 */
async function initEngine(rehydrateState = null) {
    try {
        if (engine) engine.destroy();
        
        // INSTANTIATION GUARD: Assign to global scope before async awaits to avoid race conditions.
        engine = new TypingEngine({
            onTestStart: handleTestStart,
            onCharUpdate: handleCharUpdate,
            onWordComplete: handleWordComplete,
            onMetricsUpdate: handleMetricsUpdate,
            onSessionUpdate: handleSessionUpdate
        }, rehydrateState);

        const lang = getEl('langSelect')?.value || 'tr';
        const isCustom = getEl('customToggle')?.classList.contains('active');
        const mode = isCustom ? 'custom' : 'standard';

        translateUI(lang);
        await StorageManager.set('local', { activeLanguage: lang, activeMode: mode });

        _resetUIState();
        
        const duration = parseInt(getEl('timeSelect')?.value || '60');
        
        if (rehydrateState?.startTime) {
            const elapsed = Math.floor((Date.now() - rehydrateState.startTime) / 1000);
            remainingTime = Math.max(0, duration - elapsed);
            if (remainingTime > 0) startTimer();
        } else {
            remainingTime = duration;
        }
        
        getEl('timer-display').textContent = remainingTime;
        await StorageManager.set('local', { activeTime: duration });

        let words;
        if (rehydrateState?.words) {
            words = rehydrateState.words;
        } else {
            let customPool = [];
            if (mode === 'custom') {
                const rawText = getEl('customInput')?.value || '';
                customPool = TextProcessor.process(rawText);
            }

            await wordManager.initialize(isCustom ? 'custom' : lang, customPool);
            words = wordManager.getWords(100);
        }
        
        renderSource(words, true);
        engine.setWords(words);
        
        updateCaret();
        startAnalyticsSync();
    } catch (error) {
        console.error("CRITICAL: Engine initialization failure", error);
    }
}

function _resetUIState() {
    getEl('results-overlay').style.display = 'none';
    getEl('source-words').style.transform = 'translateY(0px)';
    getEl('typing-field').innerHTML = '';
    getEl('typing-input')?.focus();
    
    const keys = document.querySelectorAll('.key');
    keys.forEach(k => { 
        k.style.backgroundColor = ''; 
        k.style.boxShadow = ''; 
    });
    
    stopTimer();
}

/**
 * SOURCE DELIVERY: Renders normalized word stream into the UI.
 */
function renderSource(words, reset = false) {
    const container = getEl('source-words');
    if (!container) return;
    
    if (reset) { 
        container.innerHTML = ''; 
        sourceWordElements = []; 
        container.style.transform = 'translateY(0px)'; 
    }

    words.forEach((word) => {
        const wordDiv = document.createElement('div');
        wordDiv.className = `word-ref ${sourceWordElements.length === 0 ? 'active' : ''}`;
        
        word.split('').forEach(char => {
            const span = document.createElement('span'); 
            span.className = 'char-ref';
            span.textContent = char; 
            wordDiv.appendChild(span);
        });
        
        container.appendChild(wordDiv); 
        sourceWordElements.push(wordDiv);
    });
}

function handleCharUpdate(data) {
    const { wordIndex, charIndex, isCorrect, isBackspace, rawInput } = data;
    const sourceWord = sourceWordElements[wordIndex];
    if (!sourceWord) return;

    const sourceChars = sourceWord.querySelectorAll('.char-ref');
    if (isBackspace) { 
        if (sourceChars[charIndex]) sourceChars[charIndex].className = 'char-ref'; 
    } else { 
        if (sourceChars[charIndex]) sourceChars[charIndex].classList.add(isCorrect ? 'correct' : 'incorrect'); 
    }
    
    renderInputChars(rawInput); 
    updateCaret();
}

function renderInputChars(rawInput) {
    const typingField = getEl('typing-field'); 
    typingField.innerHTML = '';
    
    rawInput.split('').forEach(char => {
        const span = document.createElement('span'); 
        span.className = 'char-typed';
        span.textContent = char; 
        typingField.appendChild(span);
    });
}

function handleWordComplete(data) {
    const { wordIndex, isCorrect } = data;
    const sourceWord = sourceWordElements[wordIndex];
    
    if (sourceWord) {
        sourceWord.classList.remove('active'); 
        sourceWord.classList.add('finished');
        if (!isCorrect) sourceWord.classList.add('error');
    }

    const nextWord = sourceWordElements[wordIndex + 1];
    if (nextWord) { 
        nextWord.classList.add('active'); 
        checkSourceScroll(nextWord); 
    }

    if (wordIndex > sourceWordElements.length - 20) {
        const moreWords = wordManager.getWords(20); 
        renderSource(moreWords);
        engine.words.push(...moreWords);
    }
    
    getEl('typing-field').innerHTML = ''; 
    updateCaret();
}
function handleMetricsUpdate(data) {}

/**
 * CARET ORCHESTRATION: Tracks the relative position of the typing field 
 * within the Action Zone to provide high-fidelity visual feedback.
 */
function updateCaret() {
    const caret = getEl('caret'); 
    const field = getEl('typing-field');
    if (!caret || !field) return;
    
    const rect = field.getBoundingClientRect(); 
    const actionZoneRect = getEl('typing-input').getBoundingClientRect();
    const x = (rect.left - actionZoneRect.left) + rect.width;
    
    caret.style.transform = `translateX(${x}px)`;
}

function checkSourceScroll(activeWord) {
    const container = getEl('source-words'); 
    if (!container || !activeWord) return;
    
    const style = window.getComputedStyle(container);
    const lineHeight = parseFloat(style.lineHeight) || 32;
    
    if (activeWord.offsetTop > lineHeight) {
        container.style.transform = `translateY(-${activeWord.offsetTop}px)`;
    }
}

function handleSessionUpdate(sessionData) {
    Messaging.action('UPDATE_SESSION_STATE', sessionData);
}

function handleTestStart() {
    startTimer();
    Messaging.action('UPDATE_SESSION_STATE', { state: 'TYPING' });
}

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        remainingTime--; 
        getEl('timer-display').textContent = remainingTime;
        if (remainingTime <= 0) showResults();
    }, 1000);
}

function stopTimer() { 
    if (timerInterval) clearInterval(timerInterval); 
    timerInterval = null; 
}

/**
 * DATA AGGREGATION: Compiles final performance metrics for the Results Modal.
 */
function showResults(rehydratedResult = null) {
    stopTimer(); 
    if (engine) engine.isFinished = true;
    
    let resultData;
    
    if (rehydratedResult) {
        resultData = rehydratedResult;
    } else {
        const { totalKeystrokes, correctKeystrokes, wpm, accuracy, startTime, heatmapData } = engine;
        const durationMin = (Date.now() - startTime) / 60000;
        
        resultData = {
            netWpm: Math.round((correctKeystrokes / 5) / durationMin) || 0,
            rawWpm: Math.round((totalKeystrokes / 5) / durationMin) || 0,
            cpm: Math.round(totalKeystrokes / durationMin) || 0,
            accuracy: `${accuracy}%`,
            keystrokes: `${correctKeystrokes} / ${totalKeystrokes - correctKeystrokes} / 0`,
            lang: (getEl('langSelect')?.value || 'en').toUpperCase(),
            time: `${getEl('timeSelect')?.value || '30'}s`,
            heatmap: heatmapData
        };
    }

    Messaging.action('UPDATE_SESSION_STATE', { 
        state: 'COMPLETED', 
        lastResult: resultData 
    });

    getEl('res-net-wpm').textContent = resultData.netWpm;
    getEl('res-acc').textContent = resultData.accuracy;
    getEl('res-raw-wpm').textContent = resultData.rawWpm; 
    getEl('res-cpm').textContent = resultData.cpm;
    getEl('res-consistency').textContent = '95';
    getEl('res-key-stats').textContent = resultData.keystrokes;
    getEl('res-conf-lang').textContent = resultData.lang;
    getEl('res-conf-time').textContent = resultData.time;
    
    getEl('results-overlay').style.display = 'flex';
    
    getKeyCoordinateMap(); 
    updateHeatmapUI(resultData.heatmap);
}

function handleRestart() {
    try {
        Messaging.action('CLEAR_SESSION').catch(err => {
            console.warn("Messaging: Session restart failure.", err);
        });
    } catch (err) {}
    initEngine();
}

/**
 * HEATMAP RENDERING: Calculates and applies color gradients based on 
 * character-level error rates and latency vectors.
 */
function updateHeatmapUI(data) {
    const keys = document.querySelectorAll('.key[data-key]');
    if (!data || Object.keys(data).length === 0) return;

    let maxAvgLatency = 0;
    Object.values(data).forEach(stats => {
        const avg = stats.totalLatency / stats.count;
        if (avg > maxAvgLatency) maxAvgLatency = avg;
    });

    keys.forEach(keyEl => {
        const keyName = keyEl.getAttribute('data-key'); 
        const stats = data[keyName];
        if (!stats) return;

        const avgLatency = stats.totalLatency / stats.count;
        const errorRate = (stats.error + stats.backspace) / stats.count;
        const heatFactor = ((Math.min(errorRate, 1)) * 0.6) + ((maxAvgLatency > 0 ? (avgLatency / maxAvgLatency) : 0) * 0.4);
        
        const finalR = Math.floor(204 + (255 - 204) * heatFactor);
        const finalG = Math.floor(255 * (1 - heatFactor));
        const finalB = Math.floor(51 * heatFactor);
        const alpha = 0.15 + (heatFactor * 0.35);

        keyEl.style.backgroundColor = `rgba(${finalR}, ${finalG}, ${finalB}, ${alpha})`;
        keyEl.style.boxShadow = `inset 0 0 12px rgba(${finalR}, ${finalG}, ${finalB}, ${alpha * 0.8})`;
    });
}

function getKeyCoordinateMap() {
    const keys = document.querySelectorAll('.key[data-key]');
    const containerRect = document.body.getBoundingClientRect();
    const keyMap = {};

    keys.forEach(keyEl => {
        const keyName = keyEl.getAttribute('data-key'); 
        const rect = keyEl.getBoundingClientRect();
        keyMap[keyName] = { 
            x: parseFloat(((rect.left - containerRect.left) + (rect.width / 2)).toFixed(2)),
            y: parseFloat(((rect.top - containerRect.top) + (rect.height / 2)).toFixed(2)),
            w: parseFloat(rect.width.toFixed(2)), 
            h: parseFloat(rect.height.toFixed(2)),
            label: keyEl.textContent || keyName.toUpperCase()
        };
    });
    return keyMap;
}

function handleScaleChange(e) {
    const scale = parseInt(e.target.value); 
    applyScale(scale);
    StorageManager.set('local', { activeScale: scale }); 
    updateCaret(); 
    getKeyCoordinateMap();
}

/**
 * PERIODIC ANALYTICS SYNC:
 * Persists session metrics to background storage to prevent data loss 
 * in the event of an unexpected context termination.
 */
function startAnalyticsSync() {
    if (analyticsInterval) clearInterval(analyticsInterval);
    analyticsInterval = setInterval(async () => {
        if (!engine || typeof engine.wpm === 'undefined' || engine.wpm === 0) return;
        
        await Messaging.action('UPDATE_STATS', { 
            words: Math.floor(engine.totalKeystrokes / 5) 
        });
    }, 5000);
}

async function loadPreferences() {
    const data = await StorageManager.get('local', { 
        activeLanguage: 'tr', activeTime: 60, activeScale: 100, lastCustomText: '', activeMode: 'standard'
    });
    if (getEl('langSelect')) getEl('langSelect').value = data.activeLanguage;
    if (getEl('timeSelect')) getEl('timeSelect').value = data.activeTime;
    if (getEl('scaleRange')) getEl('scaleRange').value = data.activeScale;
    if (getEl('customInput')) getEl('customInput').value = data.lastCustomText;
    if (data.activeMode === 'custom') getEl('customToggle')?.classList.add('active');
    toggleCustomDrawer(data.activeMode === 'custom'); 
    applyScale(data.activeScale); 
    translateUI(data.activeLanguage);
}

function toggleCustomDrawer(isCustom) {
    const drawer = getEl('custom-text-box'); 
    const langModule = getEl('langModule');
    if (drawer) {
        if (isCustom) { drawer.classList.add('open'); langModule?.classList.add('dimmed'); }
        else { drawer.classList.remove('open'); langModule?.classList.remove('dimmed'); }
    }
}

function applyScale(scale) {
    const f = scale / 100; 
    document.documentElement.style.setProperty('--f', f);
    const newSize = (1.35 * f).toFixed(2); 
    document.documentElement.style.setProperty('--active-fs', `${newSize}rem`);
}

/**
 * i18n ENGINE: Translates UI nodes while maintaining opacity transitions 
 * to prevent flickering during language shifts.
 */
function translateUI(lang) {
    const i18n = translations[lang] || translations.en;
    const targets = {
        'ui-timer-label': i18n.timerLabel, 'ui-config-header': i18n.SETTINGS_HEADER,
        'ui-label-lang': i18n.langLabel, 'ui-label-source': i18n.LBL_SOURCE,
        'ui-label-scale': i18n.LBL_SCALE, 'ui-label-time': i18n.timeLabel,
        'ui-label-action': i18n.LBL_ACTION, 'ui-label-custom-title': i18n.LBL_CUSTOM_TITLE,
        'btn-save': i18n.BTN_SAVE, 'btn-delete': i18n.BTN_DELETE, 'restart-btn': i18n.restartBtn,
        'ui-res-wpm-abbr': i18n.wpmAbbr, 'ui-res-wpm-desc': i18n.wpmDesc,
        'ui-res-acc-abbr': i18n.accAbbr, 'ui-res-acc-desc': i18n.accDesc,
        'ui-res-raw-abbr': i18n.rawAbbr, 'ui-res-raw-desc': i18n.rawDesc,
        'ui-res-cpm-abbr': i18n.cpmAbbr, 'ui-res-cpm-desc': i18n.cpmDesc,
        'ui-res-stability-abbr': i18n.conAbbr, 'ui-res-stability-desc': i18n.conDesc,
        'ui-res-stats-abbr': i18n.statAbbr, 'ui-res-stats-desc': i18n.statDesc,
        'ui-conf-label-lang': i18n.resConfLang, 'ui-conf-label-time': i18n.resConfTime,
        'export-btn': i18n.exportBtn,
        'full-report-btn': i18n.fullReportBtn, 'modal-restart-btn': i18n.modalRestart,
        'ui-custom-btn-text': i18n.customLabel
    };
    Object.keys(targets).forEach(id => {
        const el = getEl(id);
        if (el) { 
            el.style.opacity = '0'; 
            setTimeout(() => { el.textContent = targets[id]; el.style.opacity = '1'; }, 200); 
        }
    });
}

/**
 * VISUAL AUDIT EXPORT: Utilizes html2canvas to generate a zero-dependency 
 * performance snapshot of the results modal.
 */
async function handleExport() {
    const modal = document.querySelector('.result-modal'); 
    if (!modal) return;
    const btn = getEl('export-btn'); 
    const originalText = btn.textContent;
    btn.textContent = "..."; btn.disabled = true;
    try {
        const canvas = await html2canvas(modal, {
            scale: 2, backgroundColor: null, logging: false, useCORS: true,
            onclone: (clonedDoc) => {
                const clonedModal = clonedDoc.querySelector('.result-modal');
                if (clonedModal) {
                    clonedModal.style.transform = 'none'; clonedModal.style.top = '0'; clonedModal.style.left = '0';
                    clonedModal.style.position = 'relative'; clonedModal.style.boxShadow = 'none';
                    const footer = clonedModal.querySelector('.modal-footer'); if (footer) footer.style.display = 'none';
                    const brand = clonedDoc.createElement('div'); brand.textContent = "FLUXTYPE VELOCITY ENGINE";
                    brand.style.textAlign = 'center'; brand.style.fontSize = '0.5rem'; brand.style.fontWeight = '900';
                    brand.style.color = 'var(--accent-color)'; brand.style.marginTop = '20px';
                    brand.style.letterSpacing = '0.2em'; brand.style.opacity = '0.6';
                    clonedModal.appendChild(brand); clonedModal.style.paddingBottom = '24px';
                }
            }
        });
        const link = document.createElement('a'); 
        link.download = `Fluxtype_Score_${getEl('res-net-wpm')?.textContent}.png`;
        link.href = canvas.toDataURL('image/png', 1.0); link.click();
    } finally { btn.textContent = originalText; btn.disabled = false; }
}

/**
 * TECHNICAL AUDIT LOG GENERATION: 
 * Produces a character-level forensic audit of the typing session, 
 * detailing press durations and error mapping for professional analysis.
 */
function handleFullReport() {
    if (!engine) return;

    const wpm = getEl('res-net-wpm')?.textContent || '0';
    const accuracy = getEl('res-acc')?.textContent || '0%';
    const duration = getEl('res-conf-time')?.textContent || "0s";
    const date = new Date().toLocaleString();
    const sessionId = Math.random().toString(36).substring(2, 10).toUpperCase();

    let report = `--- FLUXTYPE PROFESSIONAL PERFORMANCE AUDIT ---\n`;
    report += `DATE: ${date}\n`;
    report += `LANGUAGE: ${(getEl('langSelect')?.value || 'EN').toUpperCase()}\n`;
    report += `SESSION ID: ${sessionId}\n`;
    report += `====================================================\n\n`;

    report += `[EXECUTIVE SUMMARY]\n`;
    report += `> Brute WPM: ${getEl('res-raw-wpm')?.textContent || '0'}\n`;
    report += `> Net WPM: ${wpm}\n`;
    report += `> Peak WPM: ${engine.peakWpm || 0} (5-Key Rolling Average)\n`;
    report += `> Accuracy: ${accuracy}\n`;
    report += `> Total Duration: ${duration}\n\n`;

    report += `[GLOBAL AGGREGATES]\n`;
    report += `> Total Characters: ${engine.totalKeystrokes}\n`;
    report += `> Total Errors: ${engine.totalKeystrokes - engine.correctKeystrokes}\n\n`;

    report += `[WORD-LEVEL PERFORMANCE ANALYSIS]\n`;
    report += `----------------------------------------------------\n`;
    engine.sessionAuditLog.forEach((entry, idx) => {
        const statusTag = entry.isCorrect ? "[PASS]" : "[FAIL]";
        report += `${idx + 1} ${statusTag} "${entry.targetWord}"\n`;
        if (!entry.isCorrect) {
            report += `    Typed: "${entry.typedWord}"\n`;
            report += `    Errors: ${entry.charErrors.map(e => `'${e.expected}' -> '${e.got}'`).join(", ")}\n`;
        }
        report += `    Duration: ${entry.timeSpent}ms\n\n`;
    });

    report += `\n====================================================\n`;
    report += `END OF AUDIT LOG\n`;
    report += `--- GENERATED BY FLUXTYPE VELOCITY ENGINE ---\n`;

    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `Fluxtype_Audit_Report_${wpm}WPM.txt`;
    link.href = url; link.click(); URL.revokeObjectURL(url);
}
