function L1MiniCtrl($scope, $interval, $timeout, spUtil, $window, $location) {
  var c = this;

  // ============================================
  // 1. Basis-Konfiguration (Alarm-Logik)
  // ============================================
  var cfg = {
    minThresholdMinutes: 1,
    warningMinutes: 10,
    criticalMinutes: 20,
    defaultExcludeStates: '6,7,8',
    clockTickMs: 1000,
    ageTickMs: 1000,
    refreshDelayMs: 250,
    initialAlarmDelaySeconds: 0,
    soundEnabledDefault: false,
    soundVolumeDefault: 1.0,
    repeatSecondsDefault: 10
  };

  var opts = c.options || {};

  // ---------- Alarm-Optionen aus Widget-Optionen ----------
  var optThreshold = parseInt(opts.threshold_minutes, 10);
  if (isNaN(optThreshold) || optThreshold < cfg.minThresholdMinutes) optThreshold = 25;
  c.thresholdMinutes = optThreshold;

  var rawStates = (opts.exclude_states || cfg.defaultExcludeStates) + '';
  rawStates = rawStates.replace(/\s+/g, '').replace(/[^0-9,]/g, '');
  if (!rawStates) rawStates = cfg.defaultExcludeStates;
  c.excludeStates = rawStates;

  var optVolume = parseFloat(opts.volume);
  if (isNaN(optVolume)) optVolume = cfg.soundVolumeDefault;
  if (optVolume < 0) optVolume = 0;
  if (optVolume > 1) optVolume = 1;

  var optRepeat = parseInt(opts.repeat_seconds, 10);
  if (isNaN(optRepeat) || optRepeat < 1) optRepeat = cfg.repeatSecondsDefault;

  var optWarning = parseInt(opts.warning_minutes, 10);
  if (isNaN(optWarning) || optWarning < 1) optWarning = cfg.warningMinutes;

  var optCritical = parseInt(opts.critical_minutes, 10);
  if (isNaN(optCritical) || optCritical <= optWarning) optCritical = cfg.criticalMinutes;

  c.warningMinutes  = optWarning;
  c.criticalMinutes = optCritical;

  var alarmDataUri = (opts.sound_url || '') + '';
  var defaultAlarmUrl = 'https://dev353320.service-now.com/sys_attachment.do?sys_id=4ec036b4930d721000f8f9f7dd03d6f4';

  // ---------- View-Modus (Multi vs. Single Card) ----------
  var standaloneCardKey = null;
  try {
    if ($location && $location.search) {
      var q = $location.search() || {};
      if (q.card) standaloneCardKey = q.card;
    }
  } catch (e) {}
  c.standaloneCardKey = standaloneCardKey; // 'datetime' | 'unassigned' | 'oldest' | null

  // ============================================
  // 2. UI-Zustand / Theme / Sichtbarkeit
  // ============================================
  c.dateStr = '';
  c.timeStr = '';

  c.oldestMs        = null;
  c.ageFormatted    = '00:00:00';
  c.isOverThreshold = false;
  c.cardBgClass     = 'card-bg-green';

  c.showSettings = false; // Alarm- & Card-Settings Panel
  c.showDesign   = false; // Look & Feel Designer

  // Sichtbarkeit Standard-Cards
  c.cardVisibility = {
    datetime: true,
    unassigned: true,
    oldest: true,
    filters: true,
    custom: true
  };

  // Basis-Theme (globale Default-Werte)
  c.theme = {
    baseFontSize: 36,
    textColor: '#666666',
    cardBg: '#ffffff',
    labelColor: '#666666',
    valueColor: '#555555',
    fontFamily:
      '"Segoe UI", -apple-system, BlinkMacSystemFont, "Roboto", "Helvetica Neue", Arial, sans-serif'
  };

  // CSS-Variablen für globales Theme
  c.themeStyle = {};
  function updateThemeStyle() {
    c.themeStyle = {
      '--l1-base-font-size': c.theme.baseFontSize + 'px',
      '--l1-text-color': c.theme.textColor,
      '--l1-card-bg': c.theme.cardBg,
      '--l1-label-color': c.theme.labelColor,
      '--l1-value-color': c.theme.valueColor,
      '--l1-font-family': c.theme.fontFamily
    };
    updateWrapperMerged();
  }

  // Wrapper-Styles (z. B. Page Background)
  c.wrapperStyle = {};
  c.wrapperMergedStyle = {};
  function updateWrapperMerged() {
    // Theme-Variablen + Wrapper-Overrides
    c.wrapperMergedStyle = angular.extend({}, c.themeStyle, c.wrapperStyle);
  }

  updateThemeStyle();

  // --------------------------------------------
  // Design-Panel: Ziel & aktuelle Werte
  // --------------------------------------------
  c.designTarget = 'global'; // 'global','wrapper','allCards','datetime','unassigned','oldest','filters','custom'

  c.currentDesign = {
    fontSize: c.theme.baseFontSize,
    textColor: c.theme.textColor,
    cardBg: c.theme.cardBg,
    labelColor: c.theme.labelColor,
    valueColor: c.theme.valueColor,
    fontFamily: c.theme.fontFamily
  };

  // Card-spezifische Styles via CSS-Variablen auf Card-Ebene
  c.cardStyles = {
    all: {},
    datetime: {},
    unassigned: {},
    oldest: {},
    filters: {},
    custom: {}
  };

function designToVarStyle(design) {
  var st = {};

  // Schriftgröße (über Variable)
  if (design.fontSize) {
    st['--l1-base-font-size'] = design.fontSize + 'px';
  }

  // Primärfarbe für Text: Variable + direkter color-Override
  if (design.textColor) {
    st['--l1-text-color'] = design.textColor;
    st.color              = design.textColor; // wirkt sofort auf Card
  }

  // Card-Background: Variable + direktes background
  if (design.cardBg) {
    st['--l1-card-bg'] = design.cardBg;
    st.background      = design.cardBg; // überschreibt Gradient/Default
  }

  // Label/Value-Farben über Variablen (Labels/Values nutzen diese)
  if (design.labelColor) {
    st['--l1-label-color'] = design.labelColor;
  }

  if (design.valueColor) {
    st['--l1-value-color'] = design.valueColor;
  }

  // Schriftart
  if (design.fontFamily) {
    st['--l1-font-family'] = design.fontFamily;
    st['font-family']      = design.fontFamily;
  }

  return st;
}

	

  // Apply-Button: Design auf Target anwenden
  c.applyDesignTarget = function () {
    var d = c.currentDesign || {};
    if (!d) return;

    // Globales Theme (wirkt auf alle Cards & Texte über CSS-Variablen)
    if (c.designTarget === 'global') {
      if (d.fontSize)   c.theme.baseFontSize = d.fontSize;
      if (d.textColor)  c.theme.textColor    = d.textColor;
      if (d.cardBg)     c.theme.cardBg       = d.cardBg;
      if (d.labelColor) c.theme.labelColor   = d.labelColor;
      if (d.valueColor) c.theme.valueColor   = d.valueColor;
      if (d.fontFamily) c.theme.fontFamily   = d.fontFamily;
      updateThemeStyle();
      return;
    }
if (c.designTarget === 'wrapper') {
  // nutzt jetzt auch background/color aus designToVarStyle
  c.wrapperStyle = designToVarStyle(d);
  updateWrapperMerged();
  return;
}


    // Card-spezifische Styles
    var styleVars = designToVarStyle(d);

    if (c.designTarget === 'allCards') {
      c.cardStyles.all = styleVars;
    } else if (c.designTarget === 'datetime') {
      c.cardStyles.datetime = styleVars;
    } else if (c.designTarget === 'unassigned') {
      c.cardStyles.unassigned = styleVars;
    } else if (c.designTarget === 'oldest') {
      c.cardStyles.oldest = styleVars;
    } else if (c.designTarget === 'filters') {
      c.cardStyles.filters = styleVars;
    } else if (c.designTarget === 'custom') {
      c.cardStyles.custom = styleVars;
    }
  };

  // Card-Style: globale Card-Styles + Typ-spezifische
  c.getCardStyle = function (type) {
    var base = {};
    if (c.cardStyles.all) angular.extend(base, c.cardStyles.all);
    if (type && c.cardStyles[type]) angular.extend(base, c.cardStyles[type]);
    return base;
  };

  // Panels togglen
  c.toggleSettings = function () {
    c.showSettings = !c.showSettings;
  };

  c.toggleDesignPanel = function () {
    c.showDesign = !c.showDesign;
  };

  // ============================================
  // 3. Zeit / Datum
  // ============================================
  function updateNow() {
    var now = new Date();
    c.dateStr = now.toLocaleDateString('de-DE', {
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    c.timeStr = now.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  updateNow();
  var clockIv = $interval(updateNow, cfg.clockTickMs);

  // ============================================
  // 4. Audio-Handling (Alarm)
  // ============================================
  c.soundEnabled       = cfg.soundEnabledDefault;
  var soundEverEnabled = false;
  var audioEl          = null;
  var loopTimer        = null;
  var firstOverThresholdMs = null;
  var alarmActive          = false;

  c.volumeSelection = optVolume;
  c.repeatSeconds   = optRepeat;

  function initAudioIfNeeded() {
    if (audioEl) return;
    audioEl = document.getElementById('alarm-audio');
    if (!audioEl) return;

    if (alarmDataUri && alarmDataUri.indexOf('data:audio') === 0) {
      audioEl.src = alarmDataUri;
    } else if (alarmDataUri && alarmDataUri.indexOf('http') === 0) {
      audioEl.src = alarmDataUri;
    } else {
      audioEl.src = defaultAlarmUrl;
    }

    audioEl.loop   = false;
    audioEl.volume = c.volumeSelection;
  }

  c.toggleSound = function () {
    if (!soundEverEnabled) {
      soundEverEnabled = true;
      c.soundEnabled   = true;
      initAudioIfNeeded();
      if (audioEl) {
        try {
          if (!audioEl.src && alarmDataUri) audioEl.src = alarmDataUri;
          audioEl.currentTime = 0;
          audioEl.volume      = c.volumeSelection;
          audioEl.play();
          audioEl.pause();
          audioEl.currentTime = 0;
        } catch (e) {}
      }
    } else {
      c.soundEnabled = !c.soundEnabled;
      if (!c.soundEnabled) stopAlarmLoop();
    }
  };

  function playAlarmOnce() {
    if (!c.soundEnabled || !soundEverEnabled) return;
    initAudioIfNeeded();
    if (!audioEl || !audioEl.src) return;
    try {
      audioEl.currentTime = 0;
      audioEl.volume      = c.volumeSelection;
      audioEl.play();
    } catch (e) {}
  }

  function startAlarmLoop() {
    if (!c.soundEnabled || !soundEverEnabled || loopTimer) return;
    loopTimer = $interval(function () {
      playAlarmOnce();
    }, c.repeatSeconds * 1000);
    alarmActive = true;
  }

  function stopAlarmLoop() {
    if (loopTimer) {
      $interval.cancel(loopTimer);
      loopTimer = null;
    }
    if (audioEl) {
      try {
        audioEl.pause();
        audioEl.currentTime = 0;
      } catch (e) {}
    }
    alarmActive = false;
  }

  // ============================================
  // 5. Age / Alarm-Logik Oldest
  // ============================================
  function two(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function formatHHMMSS(totalSeconds) {
    if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00:00';
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    var s = Math.floor(totalSeconds % 60);
    return two(h) + ':' + two(m) + ':' + two(s);
  }

  function updateAgeFromNow() {
    if (!c.oldestMs) {
      c.ageFormatted      = '00:00:00';
      c.cardBgClass       = 'card-bg-green';
      c.isOverThreshold   = false;
      firstOverThresholdMs = null;
      stopAlarmLoop();
      return;
    }

    var nowMs  = Date.now();
    var ageSec = Math.max(0, (nowMs - c.oldestMs) / 1000);
    var ageMin = Math.floor(ageSec / 60);

    c.ageFormatted = formatHHMMSS(ageSec);

    var warnMin = parseInt(c.warningMinutes, 10);
    if (isNaN(warnMin) || warnMin < 1) warnMin = cfg.warningMinutes;

    var critMin = parseInt(c.criticalMinutes, 10);
    if (isNaN(critMin) || critMin <= warnMin) critMin = cfg.criticalMinutes;

    if (ageMin < warnMin) {
      c.cardBgClass = 'card-bg-green';
    } else if (ageMin < critMin) {
      c.cardBgClass = 'card-bg-yellow';
    } else {
      c.cardBgClass = 'card-bg-blue';
    }

    c.isOverThreshold = (ageMin >= c.thresholdMinutes);

    if (!c.isOverThreshold) {
      firstOverThresholdMs = null;
      stopAlarmLoop();
      return;
    }

    if (!firstOverThresholdMs) firstOverThresholdMs = nowMs;

    var overSec = (nowMs - firstOverThresholdMs) / 1000;
    var shouldBeActive =
      c.isOverThreshold &&
      c.soundEnabled &&
      soundEverEnabled &&
      (overSec >= cfg.initialAlarmDelaySeconds);

    if (shouldBeActive && !alarmActive) {
      playAlarmOnce();
      startAlarmLoop();
    } else if (!shouldBeActive && alarmActive) {
      stopAlarmLoop();
    }
  }

  updateAgeFromNow();
  var ageIv = $interval(updateAgeFromNow, cfg.ageTickMs);

  // ============================================
  // 6. Snapshot vom Server / Datenübernahme
  // ============================================
  function applySnapshot(d) {
    if (!d) d = {};
    $scope.data = d;
    c.oldestMs  = d.oldestUnassignedOpenedAtMs || null;
    firstOverThresholdMs = null;
    updateAgeFromNow();
  }

  function refresh() {
    $scope.server.get({ action: 'snapshot' }).then(function (resp) {
      applySnapshot(resp.data);
    });
  }
  refresh();

  // recordWatch auf Cases
  var watchQuery = 'stateNOT IN' + c.excludeStates + '^assigned_toISEMPTY';
  spUtil.recordWatch($scope, 'sn_customerservice_case', watchQuery, function () {
    $timeout(refresh, cfg.refreshDelayMs);
  });

  // ============================================
  // 7. Watches für Settings
  // ============================================
  $scope.$watch(function () { return c.thresholdMinutes; }, function (newVal) {
    var n = parseInt(newVal, 10);
    if (isNaN(n) || n < cfg.minThresholdMinutes) c.thresholdMinutes = cfg.minThresholdMinutes;
    firstOverThresholdMs = null;
    updateAgeFromNow();
  });

  $scope.$watch(function () { return c.volumeSelection; }, function (newVal) {
    var v = parseFloat(newVal);
    if (isNaN(v) || v < 0) v = 0;
    if (v > 1) v = 1;
    c.volumeSelection = v;
    if (audioEl) audioEl.volume = v;
  });

  $scope.$watch(function () { return c.repeatSeconds; }, function (newVal) {
    var n = parseInt(newVal, 10);
    if (isNaN(n) || n < 1) {
      c.repeatSeconds = cfg.repeatSecondsDefault;
      n = cfg.repeatSecondsDefault;
    }
    if (alarmActive) {
      stopAlarmLoop();
      startAlarmLoop();
    }
  });

  // ============================================
  // 8. MP3-Upload (Frontend-only)
  // ============================================
  c.loadMp3File = function (file) {
    if (!file) return;
    if (file.type &&
        file.type.indexOf('audio') !== 0 &&
        file.type !== 'audio/mpeg') {
      alert('Please upload an MP3 audio file.');
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      alarmDataUri = reader.result;
      initAudioIfNeeded();
      if (audioEl) audioEl.src = alarmDataUri;
      $scope.$applyAsync();
    };
    reader.readAsDataURL(file);
  };

  // ============================================
  // 9. Filter-Card: Öffnen des Filter-Links
  // ============================================
  c.openFilterList = function (filter) {
    if (!filter || !filter.url) return;
    $window.open(filter.url, '_blank');
  };

  // ============================================
  // 10. Custom Cards (Card-Adder)
  // ============================================
  function getDataSafe(key, fallback) {
    if (!$scope.data) return fallback;
    var v = $scope.data[key];
    return (v === undefined || v === null || v === '') ? fallback : v;
  }

  c.customCards = [];

  function newCustomCard() {
    return {
      id: 'card_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
      title: 'Custom Card',
      mode: 'static',  // 'static' | 'data'
      key: '',
      value: '',
      enabled: true
    };
  }

  c.addCustomCard = function () {
    c.customCards.push(newCustomCard());
  };

  c.removeCustomCard = function (card) {
    var idx = c.customCards.indexOf(card);
    if (idx >= 0) c.customCards.splice(idx, 1);
  };

  c.toggleCustomCard = function (card) {
    card.enabled = !card.enabled;
  };

  c.getCustomValue = function (card) {
    if (!card) return '';
    if (card.mode === 'data') {
      if (!card.key) return 'n/a';
      return getDataSafe(card.key, 'n/a');
    }
    return card.value || 'n/a';
  };

  // Demo-Card zum Start
  c.customCards.push({
    id: 'card_demo',
    title: 'Demo Custom',
    mode: 'static',
    key: '',
    value: 'Hello L1',
    enabled: true
  });

  // ============================================
  // 11. Single-Card-View: Karte in neuem Tab
  // ============================================
  c.openCard = function (key) {
    var params = {};
    try {
      var search = ($location && $location.search) ? ($location.search() || {}) : {};
      for (var p in search) {
        if (search.hasOwnProperty(p)) params[p] = search[p];
      }
    } catch (e) {}

    params.card = key;

    var queryParts = [];
    for (var k in params) {
      if (params.hasOwnProperty(k) &&
          params[k] !== undefined &&
          params[k] !== null &&
          params[k] !== '') {
        queryParts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      }
    }

    var basePath = ($location && $location.path) ? $location.path() : $window.location.pathname;
    var newUrl = basePath + (queryParts.length ? ('?' + queryParts.join('&')) : '');
    $window.open(newUrl, '_blank');
  };

  // ============================================
  // 12. Cleanup
  // ============================================
  $scope.$on('$destroy', function () {
    try { if (clockIv)   $interval.cancel(clockIv); } catch (e) {}
    try { if (ageIv)     $interval.cancel(ageIv);   } catch (e) {}
    try { if (loopTimer) $interval.cancel(loopTimer); } catch (e) {}
    stopAlarmLoop();
  });
}

