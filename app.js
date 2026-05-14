const homeView = document.getElementById("homeView");
const testView = document.getElementById("testView");
const startTypingBtn = document.getElementById("startTypingBtn");
const startCompetitionBtn = document.getElementById("startCompetitionBtn");
const systemNotice = document.getElementById("systemNotice");
const homeMenuLinks = document.querySelectorAll(".home-menu-item");
const wordBox = document.getElementById("wordBox");
const wordStream = document.getElementById("wordStream");
const typingInput = document.getElementById("typingInput");
const timerEl = document.getElementById("timer");
const wpmEl = document.getElementById("wpm");
const keyStrokesEl = document.getElementById("keystrokes");
const wordsEl = document.getElementById("words");
const resetButton = document.getElementById("resetButton");
const statsBlock = document.getElementById("statsBlock");
const toggleStatsBtn = document.getElementById("toggleStatsBtn");
const langSelect = document.getElementById("langSelect");
const toggleAdvancedWordsBtn = document.getElementById("toggleAdvancedWordsBtn");
const sidebarModeStandard = document.getElementById("sidebarModeStandard");
const sidebarModeAdvanced = document.getElementById("sidebarModeAdvanced");
const resultsPanel = document.getElementById("resultsPanel");
const finalWpmEl = document.getElementById("finalWpm");
const finalKeystrokesCorrectEl = document.getElementById("finalKeystrokesCorrect");
const finalKeystrokesWrongEl = document.getElementById("finalKeystrokesWrong");
const finalKeystrokesTotalEl = document.getElementById("finalKeystrokesTotal");
const finalAccuracyEl = document.getElementById("finalAccuracy");
const finalWordsEl = document.getElementById("finalWords");
const finalWrongWordsEl = document.getElementById("finalWrongWords");
const copyResultBtn = document.getElementById("copyResultBtn");
const tryAgainBtn = document.getElementById("tryAgainBtn");
const STORAGE_KEY = "tdf.typing.state.v1";
const STATS_HIDDEN_KEY = "tdf.typing.statsHidden.v1";
const LANG_KEY = "tdf.typing.lang.v1";
const ADVANCED_WORDS_KEY = "tdf.typing.advancedWords.v1";
const INITIAL_BUFFER_WORDS = 120;
const REFILL_THRESHOLD = 30;
const REFILL_CHUNK = 80;

const TEST_DURATION_SECONDS = 60;

const SUPPORTED_LANGS = new Set(["en", "de", "fr", "es", "it", "pt", "nl", "pl", "tr", "sv"]);

/** Default mode: top-of-list, short, letters-only; English drops rough subtitle-corpus tokens. */
const COMMON_RANK_STRICT = 380;
const COMMON_RANK_RELAX = 580;
const COMMON_RANK_FALLBACK = 820;
const COMMON_LEN_STRICT = 6;
const COMMON_LEN_RELAX = 7;
const COMMON_LEN_FALLBACK = 8;

/** Minimum length for common-mode words. */
const COMMON_MIN_LEN = 2;

/** English-only: keep “common” kid/ classroom friendly (corpus still has movie dialog). */
const EN_COMMON_BLOCKLIST = new Set([
  "ass",
  "asshole",
  "bastard",
  "bitch",
  "bomb",
  "bullshit",
  "cock",
  "cocaine",
  "crap",
  "criminal",
  "damn",
  "damned",
  "dead",
  "death",
  "dick",
  "die",
  "died",
  "drugs",
  "enemy",
  "enemies",
  "fuck",
  "fucking",
  "fuckin",
  "gun",
  "guns",
  "hate",
  "hell",
  "heroin",
  "kill",
  "killed",
  "killer",
  "killing",
  "knife",
  "marijuana",
  "military",
  "motherfucker",
  "murder",
  "murdered",
  "murderer",
  "nazi",
  "piss",
  "pissed",
  "rape",
  "raped",
  "sex",
  "sexual",
  "shit",
  "shitty",
  "shoot",
  "shooting",
  "shot",
  "slut",
  "soldier",
  "soldiers",
  "stab",
  "stabbed",
  "suicide",
  "terrorist",
  "terrorists",
  "torture",
  "violence",
  "violent",
  "war",
  "weapon",
  "weapons",
  "whore"
]);

/** Tiny fallback if fetch fails (e.g. opened as file://). */
const FALLBACK_WORD_POOL = [
  "the", "be", "to", "of", "and", "a", "in", "that", "have", "it", "for", "not", "on", "with", "he",
  "as", "you", "do", "at", "this", "but", "his", "by", "from", "they", "we", "say", "her", "she"
];

const wordPoolByLang = {};
const wordPoolLoading = {};

/** Injected by word-banks.js — key is written by scripts/build-wordlists.mjs. */
function embeddedWordBanks() {
  return globalThis.__DUCK_WORD_BANKS;
}

let activeLanguage = "en";
let advancedWordsMode = false;

let samplingCacheFullRef = null;
let samplingCacheLang = null;
let samplingCacheEasy = null;

/** True if the token is easy to type: letters only (any language), no digits or punctuation. */
function isSimpleTypingWord(word, maxLen, minLen = COMMON_MIN_LEN) {
  if (!word || word.length < minLen || word.length > maxLen) {
    return false;
  }
  return /^[\p{L}]+$/u.test(word);
}

function isBlockedForCommonMode(word, lang) {
  if (lang !== "en") {
    return false;
  }
  return EN_COMMON_BLOCKLIST.has(word);
}

function collectCommonWords(full, maxRank, maxLen, lang) {
  const end = Math.min(maxRank, full.length);
  const out = [];
  for (let i = 0; i < end; i += 1) {
    const w = full[i];
    if (!isSimpleTypingWord(w, maxLen)) {
      continue;
    }
    if (isBlockedForCommonMode(w, lang)) {
      continue;
    }
    out.push(w);
  }
  return out;
}

function invalidateSamplingCache() {
  samplingCacheFullRef = null;
  samplingCacheLang = null;
  samplingCacheEasy = null;
}

function buildEasySamplingPool(full, lang) {
  if (!full || full.length === 0) {
    return full;
  }
  if (full === FALLBACK_WORD_POOL || full.length < 80) {
    return full.slice();
  }

  let out = collectCommonWords(full, COMMON_RANK_STRICT, COMMON_LEN_STRICT, lang);
  if (out.length < 180) {
    out = collectCommonWords(full, COMMON_RANK_RELAX, COMMON_LEN_RELAX, lang);
  }
  if (out.length < 120) {
    out = collectCommonWords(full, COMMON_RANK_FALLBACK, COMMON_LEN_FALLBACK, lang);
  }
  if (out.length < 80) {
    out = collectCommonWords(full, Math.min(1100, full.length), 9, lang);
  }
  if (out.length < 60) {
    out = collectCommonWords(full, Math.min(1600, full.length), 10, lang);
  }
  if (out.length < 40) {
    out = collectCommonWords(full, full.length, 11, lang);
  }
  if (out.length === 0) {
    return FALLBACK_WORD_POOL.slice();
  }
  return out;
}

function randomIndexInPool(pool) {
  const len = pool.length;
  if (len <= 1) {
    return 0;
  }
  if (advancedWordsMode && len >= 100) {
    if (Math.random() < 0.62) {
      const cut = Math.floor(len * 0.22);
      return cut + Math.floor(Math.random() * (len - cut));
    }
  }
  return Math.floor(Math.random() * len);
}

function getCachedEasyPool(full, lang) {
  if (samplingCacheFullRef === full && samplingCacheLang === lang && samplingCacheEasy) {
    return samplingCacheEasy;
  }
  samplingCacheFullRef = full;
  samplingCacheLang = lang;
  samplingCacheEasy = buildEasySamplingPool(full, lang);
  return samplingCacheEasy;
}

function getSamplingPool() {
  const full = getActivePool();
  if (advancedWordsMode) {
    return full;
  }
  return getCachedEasyPool(full, activeLanguage);
}

function getActivePool() {
  const embedded = embeddedWordBanks();
  if (embedded && Array.isArray(embedded[activeLanguage]) && embedded[activeLanguage].length > 0) {
    return embedded[activeLanguage];
  }
  const loaded = wordPoolByLang[activeLanguage];
  if (loaded && loaded.length > 0) {
    return loaded;
  }
  return FALLBACK_WORD_POOL;
}

async function loadWordPool(lang) {
  if (!SUPPORTED_LANGS.has(lang)) {
    throw new Error(`Unsupported language: ${lang}`);
  }
  const embedded = embeddedWordBanks();
  if (embedded && Array.isArray(embedded[lang]) && embedded[lang].length > 0) {
    wordPoolByLang[lang] = embedded[lang];
    return wordPoolByLang[lang];
  }
  if (wordPoolByLang[lang]) {
    return wordPoolByLang[lang];
  }
  if (wordPoolLoading[lang]) {
    return wordPoolLoading[lang];
  }

  wordPoolLoading[lang] = (async () => {
    const res = await fetch(`data/${lang}.json`, { cache: "no-cache" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data.words) || data.words.length === 0) {
      throw new Error("Empty word list");
    }
    wordPoolByLang[lang] = data.words;
    return wordPoolByLang[lang];
  })();

  try {
    return await wordPoolLoading[lang];
  } finally {
    delete wordPoolLoading[lang];
  }
}

function setTestInteractionLocked(locked) {
  if (typingInput) {
    typingInput.disabled = Boolean(locked);
  }
  if (resetButton) {
    resetButton.disabled = Boolean(locked);
  }
  if (langSelect) {
    langSelect.disabled = Boolean(locked);
  }
  if (toggleAdvancedWordsBtn) {
    toggleAdvancedWordsBtn.disabled = Boolean(locked);
  }
  if (sidebarModeStandard) {
    sidebarModeStandard.setAttribute("aria-disabled", locked ? "true" : "false");
    sidebarModeStandard.style.pointerEvents = locked ? "none" : "";
  }
  if (sidebarModeAdvanced) {
    sidebarModeAdvanced.setAttribute("aria-disabled", locked ? "true" : "false");
    sidebarModeAdvanced.style.pointerEvents = locked ? "none" : "";
  }
}

async function ensureWordsThenReset() {
  setTestInteractionLocked(true);
  notice("Loading word list…");
  try {
    await loadWordPool(activeLanguage);
    if (systemNotice) {
      systemNotice.classList.add("is-hidden");
    }
  } catch (error) {
    notice("Words not loaded. Include word-banks.js (run: node scripts/build-wordlists.mjs --embed-only) or serve over HTTP. Using tiny fallback.");
    console.warn(error);
  }
  invalidateSamplingCache();
  setTestInteractionLocked(false);
  resetTest();
}

let renderedWords = [];
let currentIndex = 0;
let correctWords = 0;
let wrongWords = 0;
let keyStrokes = 0;
let secondsLeft = TEST_DURATION_SECONDS;
let timerId = null;
let endTimeMs = 0;
let started = false;
let activeView = "home";
let persistedHighWpm = 0;
let wordResults = {};
let submittedChars = 0;
let correctChars = 0;

function createStorage() {
  return {
    read() {
      try {
        const value = window.localStorage.getItem(STORAGE_KEY);
        if (!value) {
          return null;
        }
        return JSON.parse(value);
      } catch (error) {
        return null;
      }
    },
    write(payload) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (error) {
        // Ignore storage failures (private mode / disabled storage).
      }
    }
  };
}

const storage = createStorage();

function hasCoreDomNodes() {
  return Boolean(wordBox && typingInput && timerEl && wpmEl && keyStrokesEl && wordsEl && resetButton);
}

function applyStatsHidden(isHidden) {
  if (statsBlock) {
    if (isHidden) {
      statsBlock.classList.add("is-hidden");
    } else {
      statsBlock.classList.remove("is-hidden");
    }
  }
  if (toggleStatsBtn) {
    toggleStatsBtn.textContent = isHidden ? "Show stats" : "Hide stats";
    toggleStatsBtn.setAttribute("aria-pressed", isHidden ? "true" : "false");
  }
}

function readStatsHidden() {
  try {
    return window.localStorage.getItem(STATS_HIDDEN_KEY) === "1";
  } catch (error) {
    return false;
  }
}

function writeStatsHidden(isHidden) {
  try {
    window.localStorage.setItem(STATS_HIDDEN_KEY, isHidden ? "1" : "0");
  } catch (error) {
    // Ignore storage failures.
  }
}

function readAdvancedWordsMode() {
  try {
    return window.localStorage.getItem(ADVANCED_WORDS_KEY) === "1";
  } catch (error) {
    return false;
  }
}

function writeAdvancedWordsMode(isAdvanced) {
  try {
    window.localStorage.setItem(ADVANCED_WORDS_KEY, isAdvanced ? "1" : "0");
  } catch (error) {
    // Ignore storage failures.
  }
}

function applyAdvancedWordsUI() {
  if (toggleAdvancedWordsBtn) {
    toggleAdvancedWordsBtn.setAttribute("aria-pressed", advancedWordsMode ? "true" : "false");
    toggleAdvancedWordsBtn.classList.toggle("is-active", advancedWordsMode);
    toggleAdvancedWordsBtn.textContent = advancedWordsMode ? "Advanced · on" : "Advanced · off";
  }
  if (sidebarModeStandard && sidebarModeAdvanced) {
    sidebarModeStandard.classList.toggle("menu-item-active", !advancedWordsMode);
    sidebarModeAdvanced.classList.toggle("menu-item-active", advancedWordsMode);
  }
}

function setAdvancedWordsMode(next, options) {
  const opts = options || {};
  advancedWordsMode = Boolean(next);
  invalidateSamplingCache();
  writeAdvancedWordsMode(advancedWordsMode);
  applyAdvancedWordsUI();
  if (!opts.skipReset && activeView === "test") {
    resetTest();
  }
}

/** Playfield blocks to toggle visibility on when results show/hide. */
function getPlayfieldEls() {
  return [
    document.querySelector(".stats-toolbar"),
    document.getElementById("statsBlock"),
    document.getElementById("wordBox"),
    document.querySelector(".input-row"),
  ];
}

function setResultsVisible(isVisible) {
  if (!resultsPanel) {
    return;
  }
  if (isVisible) {
    resultsPanel.classList.remove("is-hidden");
  } else {
    resultsPanel.classList.add("is-hidden");
  }
  /** Clear any inline display overrides from earlier defensive logic so playfield is restored. */
  for (const el of getPlayfieldEls()) {
    if (!el) continue;
    el.style.display = "";
  }
  /** Remove legacy class so old CSS rules don't keep stuff hidden after a reset. */
  const contentEl = document.querySelector(".content");
  if (contentEl) {
    contentEl.classList.remove("has-results");
  }
}

function notice(message) {
  if (!systemNotice || !message) {
    return;
  }
  systemNotice.textContent = message;
  systemNotice.classList.remove("is-hidden");
  window.clearTimeout(notice.dismissTimer);
  notice.dismissTimer = window.setTimeout(() => {
    if (systemNotice) {
      systemNotice.classList.add("is-hidden");
    }
  }, 1300);
}

function switchView(targetView, options) {
  const opts = options || {};
  activeView = targetView;
  if (targetView === "test") {
    if (homeView) {
      homeView.classList.add("is-hidden");
    }
    if (testView) {
      testView.classList.remove("is-hidden");
    }
    if (typingInput) {
      window.setTimeout(() => typingInput.focus(), 0);
    }
    window.requestAnimationFrame(() => scrollStreamToCurrent());
    if (!opts.skipHash && window.location.hash !== "#test") {
      window.history.pushState({ view: "test" }, "", "#test");
    }
    document.title = "10 Duck Fingers · Test";
  } else {
    if (homeView) {
      homeView.classList.remove("is-hidden");
    }
    if (testView) {
      testView.classList.add("is-hidden");
    }
    if (!opts.skipHash && window.location.hash) {
      window.history.pushState({ view: "home" }, "", "#");
    }
    document.title = "10 Duck Fingers";
  }
  storage.write({ view: activeView, highWpm: persistedHighWpm });
}

function viewFromHash() {
  return window.location.hash === "#test" ? "test" : "home";
}

function randomWords(count) {
  const pool = getSamplingPool();
  const output = [];
  let lastWord = null;
  for (let i = 0; i < count; i += 1) {
    let nextWord;
    let attempts = 0;
    do {
      nextWord = pool[randomIndexInPool(pool)];
      attempts += 1;
    } while (nextWord === lastWord && attempts < 5);
    output.push(nextWord);
    lastWord = nextWord;
  }
  return output;
}

function renderWords() {
  if (!wordStream) {
    return;
  }
  wordStream.innerHTML = "";
  for (let i = 0; i < renderedWords.length; i += 1) {
    const span = document.createElement("span");
    span.className = "word";
    span.textContent = renderedWords[i];
    wordStream.appendChild(span);
  }
  scrollStreamToCurrent();
  updateCurrentWordVisuals();
}

function scrollStreamToCurrent() {
  if (!wordStream || !wordBox) {
    return;
  }
  const currentEl = wordStream.children[currentIndex];
  if (!currentEl) {
    wordStream.style.transform = "translateY(0)";
    return;
  }
  const lineHeight = parseFloat(getComputedStyle(wordBox).lineHeight) || 33;
  const wordTop = currentEl.offsetTop;
  const lineIndex = Math.max(0, Math.floor((wordTop + 1) / lineHeight));
  /** Two-line band: active line flush to top; line below is preview; finished lines scroll up and clip away. */
  const offset = lineIndex * lineHeight;
  wordStream.style.transform = `translateY(${-offset}px)`;
}

function updateStats() {
  if (!wpmEl || !keyStrokesEl || !wordsEl) {
    return;
  }
  const elapsedSeconds = TEST_DURATION_SECONDS - secondsLeft;
  const minutes = Math.max(elapsedSeconds, 1) / 60;
  const wpm = Math.round(correctWords / minutes);
  persistedHighWpm = Math.max(persistedHighWpm, wpm);

  wpmEl.textContent = String(wpm);
  keyStrokesEl.textContent = String(keyStrokes);
  wordsEl.textContent = String(correctWords);
}

function updateTimer() {
  if (!timerEl) {
    return;
  }
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  timerEl.textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function startTimer() {
  if (started) {
    return;
  }
  started = true;
  endTimeMs = Date.now() + secondsLeft * 1000;
  timerId = setInterval(() => {
    const remainingMs = Math.max(0, endTimeMs - Date.now());
    secondsLeft = Math.ceil(remainingMs / 1000);
    updateTimer();
    updateStats();
    if (remainingMs <= 0 && started) {
      try {
        finishTest();
      } catch (err) {
        console.error("finishTest failed:", err);
        if (resultsPanel) {
          resultsPanel.classList.remove("is-hidden");
        }
        clearInterval(timerId);
        timerId = null;
        started = false;
      }
    }
  }, 200);
}

function advanceWord() {
  currentIndex += 1;

  if (currentIndex >= renderedWords.length - REFILL_THRESHOLD) {
    renderedWords = renderedWords.concat(randomWords(REFILL_CHUNK));
    renderWords();
    return;
  }

  updateCurrentWordVisuals();
  scrollStreamToCurrent();
}

function updateCurrentWordVisuals() {
  if (!wordStream) {
    return;
  }
  const children = wordStream.children;
  for (let i = 0; i < children.length; i += 1) {
    const el = children[i];
    el.classList.remove("word-current");
    el.classList.remove("word-correct");
    el.classList.remove("word-wrong");
    el.classList.remove("word-typing-ok");
    el.classList.remove("word-typing-bad");
    if (i === currentIndex) {
      el.classList.add("word-current");
    }
    const resultClass = wordResults[i];
    if (resultClass && i !== currentIndex) {
      el.classList.add(resultClass);
    }
  }
  const currentEl = wordStream.children[currentIndex];
  if (currentEl && typingInput) {
    const raw = typingInput.value;
    const spaceIdx = raw.indexOf(" ");
    const fragment = spaceIdx === -1 ? raw : raw.slice(0, spaceIdx);
    const typed = fragment.trim().toLowerCase();
    if (typed.length > 0) {
      const target = renderedWords[currentIndex];
      if (target) {
        let prefixOk = true;
        for (let j = 0; j < typed.length; j += 1) {
          if (j >= target.length || typed[j] !== target[j]) {
            prefixOk = false;
            break;
          }
        }
        currentEl.classList.add(prefixOk ? "word-typing-ok" : "word-typing-bad");
      }
    }
  }
}

function processTypedWord(typedWordRaw) {
  const typedWord = typedWordRaw.trim().toLowerCase();
  if (!typedWord) {
    return;
  }

  const currentWord = renderedWords[currentIndex];
  if (!currentWord) {
    return;
  }

  submittedChars += typedWord.length;
  const shortest = Math.min(typedWord.length, currentWord.length);
  for (let i = 0; i < shortest; i += 1) {
    if (typedWord[i] === currentWord[i]) {
      correctChars += 1;
    }
  }

  if (typedWord === currentWord) {
    correctWords += 1;
    wordResults[currentIndex] = "word-correct";
  } else {
    wrongWords += 1;
    wordResults[currentIndex] = "word-wrong";
  }

  advanceWord();
  updateStats();
}

function wpmTierRibbonLabel(wpm) {
  if (wpm >= 110) {
    return "Mallard speed";
  }
  if (wpm >= 85) {
    return "Quick quack";
  }
  if (wpm >= 60) {
    return "Steady paddler";
  }
  if (wpm >= 40) {
    return "Pond regular";
  }
  return "";
}

function finishTest() {
  clearInterval(timerId);
  timerId = null;
  started = false;
  secondsLeft = 0;
  updateTimer();
  updateStats();
  typingInput.disabled = true;
  typingInput.blur();
  const wordsAttempted = correctWords + wrongWords;
  const accuracyPct =
    wordsAttempted > 0
      ? (correctWords / wordsAttempted) * 100
      : submittedChars > 0
        ? (correctChars / submittedChars) * 100
        : 0;
  const accuracyDisplay =
    wordsAttempted > 0 || submittedChars > 0 ? `${accuracyPct.toFixed(2)}%` : "0%";

  const goodKs = correctChars;
  const badKs = Math.max(0, keyStrokes - correctChars);

  if (finalWpmEl) {
    finalWpmEl.textContent = wpmEl ? wpmEl.textContent : "0";
  }
  if (finalKeystrokesCorrectEl) {
    finalKeystrokesCorrectEl.textContent = String(goodKs);
  }
  if (finalKeystrokesWrongEl) {
    finalKeystrokesWrongEl.textContent = String(badKs);
  }
  if (finalKeystrokesTotalEl) {
    finalKeystrokesTotalEl.textContent = String(keyStrokes);
  }
  if (finalAccuracyEl) {
    finalAccuracyEl.textContent = accuracyDisplay;
  }
  if (finalWordsEl) {
    finalWordsEl.textContent = String(correctWords);
  }
  if (finalWrongWordsEl) {
    finalWrongWordsEl.textContent = String(wrongWords);
  }
  if (resultRibbonEl) {
    const wpmParsed = Number.parseInt(wpmEl ? wpmEl.textContent : "0", 10) || 0;
    const tier = wpmTierRibbonLabel(wpmParsed);
    if (tier) {
      resultRibbonEl.textContent = tier;
      resultRibbonEl.classList.remove("is-hidden");
      resultRibbonEl.setAttribute("aria-hidden", "false");
    } else {
      resultRibbonEl.classList.add("is-hidden");
      resultRibbonEl.setAttribute("aria-hidden", "true");
    }
  }
  setResultsVisible(true);
  storage.write({ view: activeView, highWpm: persistedHighWpm });
}

function resetTest() {
  clearInterval(timerId);
  timerId = null;
  started = false;
  currentIndex = 0;
  correctWords = 0;
  wrongWords = 0;
  keyStrokes = 0;
  submittedChars = 0;
  correctChars = 0;
  secondsLeft = TEST_DURATION_SECONDS;
  renderedWords = randomWords(INITIAL_BUFFER_WORDS);
  wordResults = {};
  typingInput.value = "";
  typingInput.disabled = false;
  renderWords();
  updateTimer();
  updateStats();
  setResultsVisible(false);
  if (activeView === "test" && typingInput) {
    typingInput.focus();
  }
}

async function startTypingTest() {
  switchView("test");
  await ensureWordsThenReset();
}

function bindEvents() {
  if (!typingInput || !resetButton) {
    return;
  }

  typingInput.addEventListener("keydown", (event) => {
    if (typingInput.disabled) {
      return;
    }

    if (event.key.length === 1 || event.key === "Backspace") {
      keyStrokes += 1;
      updateStats();
    }

    if (!started && event.key.length === 1) {
      startTimer();
    }
  });

  typingInput.addEventListener("input", () => {
    if (typingInput.disabled) {
      return;
    }

    if (!started && typingInput.value.length > 0) {
      startTimer();
    }

    let remainingValue = typingInput.value;
    if (!remainingValue.includes(" ")) {
      updateCurrentWordVisuals();
      return;
    }

    while (remainingValue.includes(" ")) {
      const nextSpaceIndex = remainingValue.indexOf(" ");
      const finishedWord = remainingValue.slice(0, nextSpaceIndex);
      remainingValue = remainingValue.slice(nextSpaceIndex + 1);
      processTypedWord(finishedWord);
    }
    typingInput.value = remainingValue;
    updateCurrentWordVisuals();
  });

  resetButton.addEventListener("click", resetTest);

  if (tryAgainBtn) {
    tryAgainBtn.addEventListener("click", () => {
      resetTest();
    });
  }

  if (copyResultBtn) {
    copyResultBtn.addEventListener("click", async () => {
      const lines = [
        "10 Duck Fingers — typing test result",
        `WPM: ${finalWpmEl ? finalWpmEl.textContent : "—"}`,
        `Accuracy: ${finalAccuracyEl ? finalAccuracyEl.textContent : "—"}`,
        `Correct words: ${finalWordsEl ? finalWordsEl.textContent : "—"}`,
        `Wrong words: ${finalWrongWordsEl ? finalWrongWordsEl.textContent : "—"}`,
        `Keystrokes (ok | miss) total: (${finalKeystrokesCorrectEl ? finalKeystrokesCorrectEl.textContent : "—"} | ${finalKeystrokesWrongEl ? finalKeystrokesWrongEl.textContent : "—"}) ${finalKeystrokesTotalEl ? finalKeystrokesTotalEl.textContent : "—"}`,
      ];
      try {
        await navigator.clipboard.writeText(lines.join("\n"));
        notice("Copied summary to clipboard.");
      } catch (error) {
        notice("Clipboard not available.");
      }
    });
  }

  if (toggleStatsBtn) {
    toggleStatsBtn.addEventListener("click", () => {
      const willHide = !(statsBlock && statsBlock.classList.contains("is-hidden"));
      applyStatsHidden(willHide);
      writeStatsHidden(willHide);
    });
  }

  if (langSelect) {
    langSelect.addEventListener("change", async () => {
      const next = langSelect.value;
      if (!SUPPORTED_LANGS.has(next)) {
        return;
      }
      activeLanguage = next;
      invalidateSamplingCache();
      try {
        window.localStorage.setItem(LANG_KEY, next);
      } catch (error) {
        // Ignore storage failures.
      }
      if (activeView === "test") {
        await ensureWordsThenReset();
      } else {
        void loadWordPool(activeLanguage).catch(() => {});
      }
    });
  }

  if (toggleAdvancedWordsBtn) {
    toggleAdvancedWordsBtn.addEventListener("click", () => {
      setAdvancedWordsMode(!advancedWordsMode);
    });
  }

  function activateSidebarMode(advanced) {
    if (advancedWordsMode === advanced) {
      return;
    }
    setAdvancedWordsMode(advanced);
  }

  if (sidebarModeStandard) {
    sidebarModeStandard.addEventListener("click", () => activateSidebarMode(false));
    sidebarModeStandard.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activateSidebarMode(false);
      }
    });
  }
  if (sidebarModeAdvanced) {
    sidebarModeAdvanced.addEventListener("click", () => activateSidebarMode(true));
    sidebarModeAdvanced.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activateSidebarMode(true);
      }
    });
  }

  if (startTypingBtn) {
    startTypingBtn.addEventListener("click", () => {
      void startTypingTest();
    });
  }

  if (startCompetitionBtn) {
    startCompetitionBtn.addEventListener("click", () => {
      startCompetitionBtn.disabled = true;
      startCompetitionBtn.textContent = "COMING LATER";
      notice("Competition mode is not implemented yet.");
      window.setTimeout(() => {
        if (startCompetitionBtn) {
          startCompetitionBtn.disabled = false;
          startCompetitionBtn.textContent = "START COMPETITION";
        }
      }, 1300);
    });
  }

  homeMenuLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const targetAction = link.getAttribute("data-action");
      if (targetAction === "start-test") {
        void startTypingTest();
        return;
      }
      notice("This mode is not available yet.");
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (activeView === "test") {
      resetTest();
    }
  });

  window.addEventListener("popstate", async () => {
    const desired = viewFromHash();
    if (desired !== activeView) {
      switchView(desired, { skipHash: true });
      if (desired === "test") {
        await ensureWordsThenReset();
      }
    }
  });
}

async function init() {
  if (!hasCoreDomNodes()) {
    notice("App failed to initialize. Reload the page.");
    return;
  }
  const persistedState = storage.read();
  if (persistedState && typeof persistedState.highWpm === "number") {
    persistedHighWpm = Math.max(0, persistedState.highWpm);
  }

  try {
    const savedLang = window.localStorage.getItem(LANG_KEY);
    if (savedLang && SUPPORTED_LANGS.has(savedLang)) {
      activeLanguage = savedLang;
    }
  } catch (error) {
    // Ignore storage failures.
  }
  if (langSelect) {
    langSelect.value = activeLanguage;
  }

  advancedWordsMode = readAdvancedWordsMode();
  applyAdvancedWordsUI();

  bindEvents();
  applyStatsHidden(readStatsHidden());

  const hashView = viewFromHash();
  if (hashView === "test") {
    switchView("test", { skipHash: true });
    await ensureWordsThenReset();
  } else {
    switchView("home", { skipHash: true });
    void loadWordPool(activeLanguage).catch(() => {});
  }
}

void init();
