(function () {
  // ============================================
  // L1 Support Widget – Server Script
  // - Case KPIs (unassigned, oldest)
  // - Filter (saved_filters = global+user, my_filters = nur User)
  // - News-Scraper & Ticker
  // ============================================

  data    = data    || {};
  options = options || {};
  input   = input   || {};

  // ---------- Helper ----------

  function toInt(val, def) {
    var n = parseInt(val, 10);
    return isNaN(n) ? def : n;
  }

  function safeString(v) {
    return String(v || '');
  }

  function buildListUrl(tableName, encodedQuery) {
    return tableName + '_list.do?sysparm_query=' + encodeURIComponent(encodedQuery || '');
  }

  // ============================================
  // 1) CASE-KPIs (unassigned count + oldest)
  // ============================================

  function initCaseData() {
    data.unassignedCount            = 0;
    data.oldestUnassignedOpenedAtMs = null;
    data.oldestShortDescription     = '';
    data.oldestSysId                = '';
  }

  function getExcludeStates() {
    var raw = (options.exclude_states || '6,7,8') + '';
    raw = raw.replace(/\s+/g, '');
    var cleaned = raw.replace(/[^0-9,]/g, '');
    if (!cleaned) cleaned = '6,7,8';
    return cleaned;
  }

  function baseCaseQuery(gr, excludeStates) {
    // nur Cases ohne assigned_to + State nicht in exclude
    gr.addEncodedQuery('stateNOT IN' + excludeStates + '^assigned_toISEMPTY');
  }

  function loadCaseKpis() {
    initCaseData();
    var exclude = getExcludeStates();

    // Count unassigned Cases
    var ga = new GlideAggregate('sn_customerservice_case');
    baseCaseQuery(ga, exclude);
    ga.addAggregate('COUNT');
    ga.query();
    if (ga.next()) {
      var cnt = parseInt(ga.getAggregate('COUNT'), 10);
      data.unassignedCount = isNaN(cnt) ? 0 : cnt;
    }

    // ältester unzugewiesener Case
    var gr = new GlideRecord('sn_customerservice_case');
    gr.setWorkflow(false);
    baseCaseQuery(gr, exclude);
    gr.orderBy('opened_at');
    gr.setLimit(1);
    gr.query();
    if (gr.next()) {
      var opened = new GlideDateTime(gr.getValue('opened_at'));
      data.oldestUnassignedOpenedAtMs = opened.getNumericValue();
      data.oldestShortDescription     = safeString(gr.getValue('short_description'));
      data.oldestSysId                = safeString(gr.getUniqueValue());
    }
  }

  // ============================================
  // 2) FILTER – saved_filters (global+user) + my_filters (nur User)
  // ============================================

  function initFilters() {
    data.saved_filters = []; // global + user
    data.my_filters    = []; // nur persönlicher User
  }

  // global + persönliche Filter (z. B. für "Team Filters")
  function loadSavedFilters() {
    initFilters();

    var tableName = options.filter_table || 'sn_customerservice_case';

    try {
      var grF = new GlideRecord('sys_ui_filter');
      grF.addQuery('table', tableName);

      // persönliche ODER globale Filter
      var qc = grF.addQuery('user', gs.getUserID());
      qc.addOrCondition('user', '');

      grF.addNotNullQuery('name');
      grF.orderBy('name');
      grF.setLimit(20);
      grF.query();

      while (grF.next()) {
        var enc = safeString(grF.getValue('filter') || grF.getValue('conditions'));
        if (!enc) continue;

        var name = safeString(grF.getValue('name'));
        var url  = buildListUrl(tableName, enc);

        data.saved_filters.push({
          name: name,
          url:  url
        });
      }
    } catch (e) {
      data.saved_filters_error = 'Could not load saved filters: ' + e;
    }
  }

  // nur persönliche Filter (für "My Filters")
  function loadMyFilters() {
    var tableName = options.filter_table || 'sn_customerservice_case';

    try {
      var grF = new GlideRecord('sys_ui_filter');
      grF.addQuery('table', tableName);
      grF.addQuery('user', gs.getUserID()); // nur aktueller User

      grF.addNotNullQuery('name');
      grF.orderBy('name');
      grF.setLimit(20);
      grF.query();

      while (grF.next()) {
        var enc = safeString(grF.getValue('filter') || grF.getValue('conditions'));
        if (!enc) continue;

        var name = safeString(grF.getValue('name'));
        var url  = buildListUrl(tableName, enc);

        data.my_filters.push({
          name: name,
          url:  url
        });
      }
    } catch (e) {
      data.my_filters_error = 'Could not load personal filters: ' + e;
    }
  }

  // ============================================
  // 3) NEWS – HTML-Scraper & Ticker
  // ============================================

  function initNews() {
    data.news_items  = [];
    data.ticker_text = '';
    data.news_error  = '';
  }

  function loadNews() {
    initNews();

    // optional abschaltbar über Options
    if (options.enable_news === false || options.enable_news === 'false')
      return;

    var url = options.html_url
      ? safeString(options.html_url)
      : 'https://www.dresden-it.de/aktuelle-themen/';

    if (!url) {
      data.news_error = 'No html_url set in widget options.';
      return;
    }

    var maxItems  = toInt(options.max_items, 10);
    var timeoutMs = toInt(options.timeout_ms, 6000);
    var midName   = options.mid_name ? safeString(options.mid_name) : '';

    function httpGet(u, useMid) {
      var r = new sn_ws.RESTMessageV2();
      r.setEndpoint(u);
      r.setHttpMethod('GET');
      r.setRequestHeader('Accept', 'text/html, */*');
      r.setHttpTimeout(timeoutMs);
      if (useMid && midName) r.setMIDServer(midName);

      var resp = r.execute();
      var code = resp.getStatusCode();
      if (code >= 200 && code < 300) {
        return safeString(resp.getBody() || '');
      }
      throw 'HTTP ' + code + ' for ' + u + (useMid ? ' (via MID ' + midName + ')' : '');
    }

    var html = '';
    try {
      try {
        html = httpGet(url, false);
      } catch (e1) {
        if (!midName) throw e1;
        html = httpGet(url, true);
      }
    } catch (e) {
      data.news_error = 'Fetch failed: ' + e;
      return;
    }

    if (!html) {
      data.news_error = 'Empty HTML';
      return;
    }

    function stripTags(s) {
      return safeString(s).replace(/<[^>]*>/g, '');
    }

    function collapseWs(s) {
      return safeString(s).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    }

    function decodeEntities(s) {
      var t = safeString(s);
      t = t.replace(/&nbsp;/g, ' ')
           .replace(/&amp;/g, '&')
           .replace(/&quot;/g, '"')
           .replace(/&#39;/g, "'")
           .replace(/&lt;/g, '<')
           .replace(/&gt;/g, '>');
      t = t.replace(/&#(\d+);/g, function (_, d) {
        try { return String.fromCharCode(parseInt(d, 10)); } catch (e) { return _; }
      });
      t = t.replace(/&#x([0-9a-fA-F]+);/g, function (_, h) {
        try { return String.fromCharCode(parseInt(h, 16)); } catch (e) { return _; }
      });
      return t;
    }

    function absolutize(href, base) {
      if (!href) return '';
      href = safeString(href);
      if (/^https?:\/\//i.test(href)) return href;
      if (href.indexOf('//') === 0) return 'https:' + href;
      var m = base.match(/^(https?:\/\/[^\/]+)/i);
      return m ? (m[1] + (href.charAt(0) === '/' ? href : '/' + href)) : href;
    }

    var blockRegex      = /<div[^>]+class="[^"]*\b(uc_image_carousel_container_holder|uc_carousel_item|ue-item)\b[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi;
    var titleBlockRegex = /<div[^>]+class="[^"]*\buc_post_title\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
    var firstLinkRegex  = /<a[^>]+href="([^"]+)"[^>]*>/i;
    var excerptRegex    = /<div[^>]+class="[^"]*\buc_paragraph\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i;

    var items = [];
    var m, iter = 0;

    while ((m = blockRegex.exec(html)) && items.length < maxItems && iter < 2000) {
      iter++;
      var block = safeString(m[0]);

      var title = '';
      var tb = block.match(titleBlockRegex);
      if (tb && tb[1]) title = collapseWs(stripTags(decodeEntities(tb[1])));

      var link = '';
      var idx  = block.indexOf(tb ? tb[0] : '');
      var aroundTitle = block.substring(
        Math.max(0, idx - 200),
        (idx >= 0 ? idx : 0) + (tb ? tb[0].length : 0) + 200
      );

      var linkTry = (aroundTitle || '').match(firstLinkRegex) || block.match(firstLinkRegex);
      if (linkTry && linkTry[1]) {
        link = absolutize(decodeEntities(linkTry[1]), url);
      }

      var excerpt = '';
      var exm = block.match(excerptRegex);
      if (exm && exm[1]) {
        excerpt = collapseWs(stripTags(decodeEntities(exm[1])));
      }

      if (title) {
        items.push({
          title:   title,
          link:    link,
          excerpt: excerpt
        });
      }
    }

    // Fallback: generische h2/h3-Überschriften
    if (!items.length) {
      var genericRegex = /<(h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi, gm;
      while ((gm = genericRegex.exec(html)) && items.length < maxItems) {
        var rawTitle = gm[2] || '';
        var a = rawTitle.match(firstLinkRegex);
        var t = collapseWs(stripTags(decodeEntities(rawTitle)));
        var l = a && a[1] ? absolutize(decodeEntities(a[1]), url) : '';
        if (t) {
          items.push({
            title:   t,
            link:    l,
            excerpt: ''
          });
        }
      }
    }

    if (!items.length) {
      data.news_error = 'No posts found (HTML heuristics matched nothing).';
      return;
    }

    data.news_items = items;

    var sep    = options.separator ? safeString(options.separator) : ' ... - • -  ';
    var prefix = options.prefix    ? safeString(options.prefix)    : 'News';

    var titles = [];
    for (var i = 0; i < items.length; i++) {
      titles.push(items[i].title);
    }

    data.ticker_text = (prefix ? prefix + ' ' : '') + titles.join(sep);
  }

  // ============================================
  // 4) SNAPSHOT – einmal alles laden
  // ============================================

  function buildSnapshot() {
    loadCaseKpis();     // KPIs
    loadSavedFilters(); // globale+user Filter
    loadMyFilters();    // persönliche Filter
    loadNews();         // News-Ticker
  }

  var action = input.action || '';
  if (!action || action === 'snapshot') {
    buildSnapshot();
  }

})();

