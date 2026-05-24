const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');

function createElement(tagName) {
  return {
    tagName: tagName.toUpperCase(),
    className: '',
    innerHTML: '',
    textContent: '',
    style: {},
    dataset: {},
    children: [],
    parentElement: null,
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    insertBefore(child, referenceChild) {
      child.parentElement = this;
      const index = this.children.indexOf(referenceChild);
      if (index === -1) {
        this.children.push(child);
      } else {
        this.children.splice(index, 0, child);
      }
      return child;
    },
    remove() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    closest() {
      return null;
    },
    getBoundingClientRect() {
      return { width: 0, height: 0, left: 0 };
    }
  };
}

function createTreeWalker(root) {
  const textNodes = [];

  function collectTextNodes(element) {
    if (!element) return;

    if (element.textContent) {
      textNodes.push({
        nodeValue: element.textContent,
        parentElement: element
      });
    }

    for (const child of element.children || []) {
      collectTextNodes(child);
    }
  }

  collectTextNodes(root);

  return {
    nextNode() {
      return textNodes.shift() ?? null;
    }
  };
}

function loadContentScript() {
  const context = {
    console: { log() {}, warn() {}, error() {} },
    fetch() {},
    setTimeout() {
      return 0;
    },
    clearTimeout() {},
    Node: { ELEMENT_NODE: 1 },
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
      observe() {}
    },
    document: {
      body: createElement('body'),
      head: createElement('head'),
      createElement,
      createTreeWalker,
      querySelector() {
        return null;
      },
      addEventListener() {}
    },
    window: {
      getComputedStyle() {
        return { display: 'block', visibility: 'visible' };
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('content.js', 'utf8'), context);
  return context;
}

test('createRankBadge renders the compact signature layout', () => {
  const context = loadContentScript();

  const badge = context.createRankBadge({
    rank: 12,
    total: 147,
    percentile: 92,
    stats: { average: 13.42, median: 13.5, min: 6, max: 19 }
  });

  assert.equal(badge.className, 'mw-rank-badge');
  assert.match(badge.innerHTML, /mw-rank-accent/);
  assert.match(badge.innerHTML, /Rang promo/);
  assert.match(badge.innerHTML, /12/);
  assert.match(badge.innerHTML, /147/);
  assert.match(badge.innerHTML, /Top 8%/);
  assert.match(badge.innerHTML, /Moy\./);
  assert.match(badge.innerHTML, /13\.42/);
  assert.match(badge.innerHTML, /Méd\./);
  assert.match(badge.innerHTML, /13\.50/);
  assert.match(badge.innerHTML, /Min/);
  assert.match(badge.innerHTML, /6\.00/);
  assert.match(badge.innerHTML, /Max/);
  assert.match(badge.innerHTML, /19\.00/);
  assert.doesNotMatch(badge.innerHTML, /🏆/);
});

test('syncBadgeWidthWithGraph copies the visible graph width onto the badge', () => {
  const context = loadContentScript();
  const badge = createElement('div');
  const graph = createElement('canvas');
  const statsArea = createElement('section');

  graph.getBoundingClientRect = () => ({ width: 432.4, left: 32 });
  statsArea.getBoundingClientRect = () => ({ width: 640, left: 20 });
  statsArea.querySelectorAll = (selector) => {
    assert.match(selector, /canvas/);
    return [graph];
  };

  context.syncBadgeWidthWithGraph(badge, statsArea);

  assert.equal(badge.style.width, '396px');
  assert.equal(badge.style.marginLeft, '30px');
  assert.equal(badge.style.maxWidth, '100%');
});

test('injected badge styles use a white background', () => {
  const css = fs.readFileSync('content.css', 'utf8');

  assert.match(css, /background:\s*#fff;/);
  assert.doesNotMatch(css, /background:\s*#fbfaf7;/);
});

test('general rank panel fills its aligned curriculum column', () => {
  const css = fs.readFileSync('content.css', 'utf8');

  assert.match(css, /\.mw-general-rank-panel\s*{[^}]*width:\s*100%;/s);
  assert.doesNotMatch(css, /\.mw-general-rank-panel\s*{[^}]*width:\s*min\(100%,\s*560px\);/s);
});

test('course rank inline badge styles are absent from the stylesheet', () => {
  const css = fs.readFileSync('content.css', 'utf8');

  assert.doesNotMatch(css, /mw-course-rank-pill/);
});

test('findYearHeaderElement matches a visible academic year inside a decorated header', () => {
  const context = loadContentScript();
  const wideContainer = createElement('div');
  const decoratedHeader = createElement('h2');

  wideContainer.textContent = 'Année académique 2025 - 2026 Voir le détail';
  decoratedHeader.textContent = 'Année académique 2025 - 2026 Voir le détail';

  wideContainer.getBoundingClientRect = () => ({ width: 600, height: 80, left: 0 });
  decoratedHeader.getBoundingClientRect = () => ({ width: 260, height: 32, left: 0 });

  context.document.body.appendChild(wideContainer);
  context.document.body.appendChild(decoratedHeader);

  assert.equal(context.findYearHeaderElement('2025-2026'), decoratedHeader);
});

test('createGeneralRankInsertionElement aligns the panel with the course column', () => {
  const context = loadContentScript();
  const headerRow = createElement('div');
  const yearHeader = createElement('div');
  const panel = createElement('div');

  headerRow.className = 'g-0 row';
  yearHeader.className = 'd-flex align-items-center fw-bold col';
  panel.className = 'mw-general-rank-panel';

  headerRow.appendChild(createElement('div')).className = 'fw-bold col-lg-3 col-md-4';
  headerRow.appendChild(createElement('div')).className = 'col-md-1';
  headerRow.appendChild(yearHeader);

  yearHeader.closest = (selector) => selector === '.row' ? headerRow : null;

  const insertionElement = context.createGeneralRankInsertionElement(panel, yearHeader);

  assert.equal(insertionElement.className, 'mw-general-rank-row pt-2 pb-4 g-0 flex-column align-items-center flex-md-row align-items-md-stretch row');
  assert.equal(insertionElement.children.length, 3);
  assert.equal(insertionElement.children[0].className, 'col-lg-3 col-md-4');
  assert.equal(insertionElement.children[1].className, 'col-sm-1');
  assert.equal(insertionElement.children[2].className, 'col-lg-8 col-md-7');
  assert.equal(insertionElement.children[2].children[0], panel);
});

test('injectGeneralRankBadges ignores concurrent general injections while the first is loading', () => {
  const context = loadContentScript();
  const header = createElement('div');

  header.textContent = '2025-2026';
  header.getBoundingClientRect = () => ({ width: 220, height: 32, left: 0 });

  context.document.body.appendChild(header);
  context.document.querySelector = () => null;

  let fetchCalls = 0;
  context.fetch = () => {
    fetchCalls += 1;
    return new Promise(() => {});
  };

  void context.injectGeneralRankBadges();
  void context.injectGeneralRankBadges();

  assert.equal(fetchCalls, 1);
});

test('injectGeneralRankBadges does not warn while the page is still rendering the year header', async () => {
  const warnings = [];
  const context = loadContentScript();

  context.console.warn = (...args) => warnings.push(args.join(' '));
  context.document.readyState = 'loading';
  context.document.querySelector = () => null;

  await context.injectGeneralRankBadges();

  assert.deepEqual(warnings, []);
});

test('computeRankDetails returns average median min and max', () => {
  const context = loadContentScript();

  assert.deepEqual(JSON.parse(JSON.stringify(context.computeRankDetails(16.5, ['12', '16,5', 10, 'PASS', 18]).stats)), {
    average: 14.125,
    median: 14.25,
    min: 10,
    max: 18
  });
});

test('getGeneralSessionsFromGrades keeps annual and semester sessions', () => {
  const context = loadContentScript();
  const sessions = context.getGeneralSessionsFromGrades({
    level: 1,
    courseId: null,
    sessionId: 101,
    sessionName: 'Année 1',
    mark: '15,6',
    sessionParcours: { academicYear: '2025-2026' },
    children: [
      {
        level: 2,
        courseId: null,
        sessionId: 201,
        sessionName: 'Semestre 5',
        mark: '15,3',
        sessionParcours: { academicYear: '2025-2026' }
      }
    ]
  });

  assert.deepEqual(JSON.parse(JSON.stringify(sessions)), [
    {
      id: 101,
      kind: 'Année',
      displayName: '2025-2026',
      sessionName: 'Année 1',
      userGrade: 15.6
    },
    {
      id: 201,
      kind: 'Semestre',
      displayName: 'Semestre 5',
      sessionName: 'Semestre 5',
      userGrade: 15.3
    }
  ]);
});

test('getGeneralRankData fetches annual and semester statistics endpoints', async () => {
  const context = loadContentScript();
  const urls = [];

  context.fetch = async (url) => {
    urls.push(url);

    if (url === '/students/grades.json') {
      return {
        ok: true,
        json: async () => ({
          level: 1,
          courseId: null,
          sessionId: 101,
          sessionName: 'Année 1',
          mark: '15,6',
          sessionParcours: { academicYear: '2025-2026' },
          children: [{
            level: 2,
            courseId: null,
            sessionId: 201,
            sessionName: 'Semestre 5',
            mark: '15,3',
            sessionParcours: { academicYear: '2025-2026' }
          }]
        })
      };
    }

    if (url === '/courses/101/statistics') {
      return {
        ok: true,
        json: async () => ({
          userGrade: 15.6,
          allGrades: [18, 16, 15.6, 12]
        })
      };
    }

    if (url === '/courses/201/statistics') {
      return {
        ok: true,
        json: async () => ({
          userGrade: 15.3,
          allGrades: [17, 15.3, 14, 10]
        })
      };
    }

    throw new Error(`Unexpected fetch ${url}`);
  };

  const result = await context.getGeneralRankData('2025-2026');

  assert.deepEqual(urls, [
    '/students/grades.json',
    '/courses/101/statistics',
    '/courses/201/statistics'
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].session.id, 101);
  assert.equal(result[1].session.id, 201);
  assert.deepEqual(JSON.parse(JSON.stringify(result[0].rankInfo)), {
    rank: 3,
    total: 4,
    percentile: 50,
    stats: {
      average: 15.4,
      median: 15.8,
      min: 12,
      max: 18
    }
  });
});

test('inline course rank functions are not exposed', () => {
  const context = loadContentScript();

  assert.equal(context.createCourseRankPill, undefined);
  assert.equal(context.injectCourseRankInCard, undefined);
  assert.equal(context.observeCourseRankCards, undefined);
});

test('course card mutations do not schedule rank loading', () => {
  let timeoutCalls = 0;
  let observerCallback;
  const context = {
    console: { log() {}, warn() {}, error() {} },
    fetch() {},
    setTimeout(callback) {
      timeoutCalls += 1;
      callback();
      return 0;
    },
    clearTimeout() {},
    Node: { ELEMENT_NODE: 1 },
    MutationObserver: class {
      constructor(callback) {
        observerCallback = callback;
      }
      observe() {}
    },
    document: {
      readyState: 'loading',
      body: createElement('body'),
      head: createElement('head'),
      createElement,
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener() {}
    },
    window: {
      getComputedStyle() {
        return { display: 'block', visibility: 'visible' };
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync('content.js', 'utf8'), context);

  timeoutCalls = 0;
  observerCallback([{
    addedNodes: [{
      nodeType: 1,
      textContent: '',
      matches: (selector) => selector.includes('.card'),
      querySelector: () => null
    }]
  }]);

  assert.equal(timeoutCalls, 0);
});
