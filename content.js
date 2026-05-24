/**
 * MyWay - Classement Promo
 * Developed by Nathan Di Fraja.
 * Independent project, not affiliated with CentraleSupélec or MyWay.
 *
 * Ce script s'injecte sur la page MyWay et ajoute :
 * 1. Le classement dans la promo à côté du graphique de distribution existant, par cours.
 * 2. Le classement par moyenne générale annuelle sous le bloc 2025-2026.
 */


// ——————————————————————————————————————————
// Utilitaires
// ——————————————————————————————————————————

function normalizeText(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
}

function textMatchesAcademicYear(text, academicYear) {
    const normalizedText = normalizeText(text);
    const normalizedYear = normalizeText(academicYear);
    const yearParts = normalizedYear.match(/^(\d{4})\s*[-–—]\s*(\d{4})$/);

    if (!yearParts) {
        return normalizedText === normalizedYear;
    }

    const [, startYear, endYear] = yearParts;
    const academicYearPattern = new RegExp(
        `(^|\\D)${startYear}\\s*[-–—]\\s*${endYear}(\\D|$)`
    );

    return academicYearPattern.test(normalizedText);
}

/**
 * Convertit une note MyWay en nombre.
 * Exemples :
 * "15,6" -> 15.6
 * "PASS" -> null
 * null -> null
 */
function parseMyWayMark(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;

    if (typeof value === 'string') {
        const normalized = value.trim().replace(',', '.');
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

/**
 * Calcule le classement de l'étudiant dans la promo.
 */
function computeRank(userGrade, allGrades) {
    const numericGrades = (allGrades ?? [])
        .map(parseMyWayMark)
        .filter(Number.isFinite);

    const total = numericGrades.length;

    if (!Number.isFinite(userGrade) || total === 0) {
        return null;
    }

    const better = numericGrades.filter(g => g > userGrade).length;
    const rank = better + 1;
    const percentile = Math.round(((total - better) / total) * 100);

    return { rank, total, percentile };
}

function computeDistributionStats(allGrades) {
    const numericGrades = (allGrades ?? [])
        .map(parseMyWayMark)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

    const total = numericGrades.length;

    if (!total) return null;

    const middle = Math.floor(total / 2);
    const median = total % 2
        ? numericGrades[middle]
        : (numericGrades[middle - 1] + numericGrades[middle]) / 2;
    const average = numericGrades.reduce((sum, grade) => sum + grade, 0) / total;

    return {
        average,
        median,
        min: numericGrades[0],
        max: numericGrades[total - 1]
    };
}

function computeRankDetails(userGrade, allGrades) {
    const rankInfo = computeRank(userGrade, allGrades);
    const stats = computeDistributionStats(allGrades);

    if (!rankInfo || !stats) return null;

    return { ...rankInfo, stats };
}

function formatStat(value) {
    return Number(value).toFixed(2);
}

/**
 * Récupère les statistiques d'un cours ou d'une session depuis l'API.
 */
async function fetchStats(id) {
    const response = await fetch(`/courses/${id}/statistics`, {
        credentials: 'include'
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    return response.json();
}

const statsRequestCache = new Map();

function fetchStatsCached(id) {
    if (!statsRequestCache.has(id)) {
        statsRequestCache.set(
            id,
            fetchStats(id).catch(error => {
                statsRequestCache.delete(id);
                throw error;
            })
        );
    }

    return statsRequestCache.get(id);
}

/**
 * Récupère les données de notes de l'étudiant.
 */
async function fetchGrades() {
    const response = await fetch('/students/grades.json', {
        credentials: 'include'
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    return response.json();
}

let gradesRequest = null;

function fetchGradesCached() {
    if (!gradesRequest) {
        gradesRequest = fetchGrades().catch(error => {
            gradesRequest = null;
            throw error;
        });
    }

    return gradesRequest;
}


// ——————————————————————————————————————————
// Détection dynamique des sessions générales
// ——————————————————————————————————————————

function findAcademicYearRoot(gradesData, academicYear = '2025-2026') {
    const roots = Array.isArray(gradesData) ? gradesData : [gradesData];

    return roots.find(node =>
        node &&
        typeof node === 'object' &&
        node.level === 1 &&
        node.courseId === null &&
        node.sessionId &&
        node.sessionParcours?.academicYear === academicYear
    ) ?? null;
}

function getGeneralSessionsFromGrades(gradesData, academicYear = '2025-2026') {
    const yearRoot = findAcademicYearRoot(gradesData, academicYear);

    if (!yearRoot) {
        console.warn(`[MyWay Rank] Racine académique introuvable pour ${academicYear}`, gradesData);
        return [];
    }

    const sessions = [{
        id: yearRoot.sessionId,
        kind: 'Année',
        displayName: academicYear,
        sessionName: yearRoot.sessionName,
        userGrade: parseMyWayMark(yearRoot.mark)
    }];

    const semesters = (yearRoot.children ?? [])
        .filter(child =>
            child &&
            typeof child === 'object' &&
            child.level === 2 &&
            child.courseId === null &&
            child.sessionId &&
            /^Semestre\s+\d+$/i.test(child.sessionName ?? '') &&
            child.sessionParcours?.academicYear === academicYear
        )
        .sort((a, b) => {
            const numA = Number(String(a.sessionName).match(/\d+/)?.[0] ?? 0);
            const numB = Number(String(b.sessionName).match(/\d+/)?.[0] ?? 0);
            return numA - numB;
        });

    for (const semester of semesters) {
        sessions.push({
            id: semester.sessionId,
            kind: 'Semestre',
            displayName: semester.sessionName,
            sessionName: semester.sessionName,
            userGrade: parseMyWayMark(semester.mark)
        });
    }

    return sessions;
}

const GENERAL_RANK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function getGeneralRankCacheKey(academicYear) {
    return `mw-general-rank:${academicYear}`;
}

function readCachedGeneralRank(academicYear) {
    try {
        const raw = window.localStorage?.getItem(getGeneralRankCacheKey(academicYear));
        if (!raw) return null;

        const cached = JSON.parse(raw);
        const age = Date.now() - Number(cached.cachedAt ?? 0);

        if (age < 0 || age > GENERAL_RANK_CACHE_TTL_MS) return null;
        if (Array.isArray(cached.items) && cached.items.length) return cached;
        if (!cached.rankInfo || !Number.isFinite(cached.userGrade)) return null;

        return {
            ...cached,
            items: [{
                session: {
                    displayName: cached.displayName,
                    userGrade: cached.userGrade
                },
                rankInfo: cached.rankInfo
            }]
        };
    } catch {
        return null;
    }
}

function writeCachedGeneralRank(academicYear, rankItems) {
    try {
        window.localStorage?.setItem(
            getGeneralRankCacheKey(academicYear),
            JSON.stringify({
                cachedAt: Date.now(),
                items: rankItems
            })
        );
    } catch {
        // Storage can be unavailable; ranking still works from network data.
    }
}

async function getGeneralRankData(academicYear = '2025-2026') {
    const gradesData = await fetchGradesCached();
    const sessions = getGeneralSessionsFromGrades(gradesData, academicYear);

    if (!sessions.length) return [];

    const rankItems = (await Promise.all(
        sessions.map(async (session) => {
            const statsData = await fetchStatsCached(session.id);

            if (!statsData?.allGrades?.length) {
                console.warn(`[MyWay Rank] Pas de distribution allGrades pour ${session.displayName}`, statsData);
                return null;
            }

            const statsUserGrade = parseMyWayMark(statsData.userGrade);
            const userGrade = Number.isFinite(statsUserGrade)
                ? statsUserGrade
                : session.userGrade;

            if (!Number.isFinite(userGrade)) {
                console.warn(`[MyWay Rank] userGrade introuvable pour ${session.displayName}`, {
                    session,
                    statsData
                });
                return null;
            }

            const rankInfo = computeRankDetails(userGrade, statsData.allGrades);

            if (!rankInfo) {
                console.warn(`[MyWay Rank] Impossible de calculer le rang pour ${session.displayName}`, {
                    session,
                    statsData
                });
                return null;
            }

            return {
                session: { ...session, userGrade },
                rankInfo
            };
        })
    )).filter(Boolean);

    if (rankItems.length) writeCachedGeneralRank(academicYear, rankItems);

    return rankItems;
}

function prefetchGeneralRankData(academicYear = '2025-2026') {
    return getGeneralRankData(academicYear).catch(() => null);
}


// ——————————————————————————————————————————
// Badge de classement dans la modal, par cours
// ——————————————————————————————————————————

function createRankBadge(rankInfo) {
    const topPercent = Math.max(1, 100 - rankInfo.percentile);
    const statsHtml = rankInfo.stats ? `
    <span class="mw-rank-stats">
      <span>Moy. <strong>${formatStat(rankInfo.stats.average)}</strong></span>
      <span>Méd. <strong>${formatStat(rankInfo.stats.median)}</strong></span>
      <span>Min <strong>${formatStat(rankInfo.stats.min)}</strong></span>
      <span>Max <strong>${formatStat(rankInfo.stats.max)}</strong></span>
    </span>
  ` : '';

    const badge = document.createElement('div');
    badge.className = 'mw-rank-badge';

    badge.innerHTML = `
    <span class="mw-rank-accent" aria-hidden="true"></span>
    <span class="mw-rank-main">
      <span class="mw-rank-label">Rang promo</span>
      <span class="mw-rank-line">
        <strong class="mw-rank-value">${rankInfo.rank}</strong>
        <span class="mw-rank-total">/ ${rankInfo.total}</span>
      </span>
    </span>
    <span class="mw-rank-percentile">Top ${topPercent}%</span>
    ${statsHtml}
  `;

    return badge;
}

function syncBadgeWidthWithGraph(badge, statsArea) {
    const sideInset = 18;
    const graphSelector = [
        'canvas',
        'svg',
        '.chartjs-render-monitor',
        '.apexcharts-canvas',
        '[class*="chart"]',
        '[class*="graph"]'
    ].join(', ');

    const graph = Array.from(statsArea.querySelectorAll(graphSelector)).find((el) => {
        const rect = el.getBoundingClientRect?.();
        return rect && rect.width > 120;
    });

    badge.style.maxWidth = '100%';

    if (!graph) {
        badge.style.width = `calc(100% - ${sideInset * 2}px)`;
        badge.style.marginLeft = `${sideInset}px`;
        return;
    }

    const graphRect = graph.getBoundingClientRect();
    const areaRect = statsArea.getBoundingClientRect?.() || { left: graphRect.left };

    const leftOffset = Math.max(0, Math.round(graphRect.left - areaRect.left)) + sideInset;
    const width = Math.max(0, Math.round(graphRect.width) - sideInset * 2);

    badge.style.width = `${width}px`;
    badge.style.marginLeft = `${leftOffset}px`;
}

function injectRankInModal(rankInfo) {
    const modal = document.querySelector('.modal.show, [class*="modal"][style*="display: block"], [role="dialog"]');
    if (!modal) return;
    if (modal.querySelector('.mw-rank-badge')) return;

    const statsArea = modal.querySelector('.modal-body, .modal-content');
    if (!statsArea) return;

    const badge = createRankBadge(rankInfo);
    syncBadgeWidthWithGraph(badge, statsArea);

    const allDivs = statsArea.querySelectorAll('div, p');
    let inserted = false;

    for (const el of allDivs) {
        if (el.children.length === 0 && el.textContent.includes('Ce graphique indicatif')) {
            el.parentElement.insertBefore(badge, el);
            inserted = true;
            break;
        }
    }

    if (!inserted) statsArea.appendChild(badge);

    setTimeout(() => syncBadgeWidthWithGraph(badge, statsArea), 50);
}


// ——————————————————————————————————————————
// Bloc général sous 2025-2026
// ——————————————————————————————————————————

function isVisibleElement(el) {
    if (!el) return false;

    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);

    return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
    );
}

/**
 * Trouve le plus petit élément visible qui référence l'année académique.
 */
function findYearHeaderElement(yearLabel = '2025-2026') {
    const all = Array.from(document.querySelectorAll('body *'));

    return all
        .filter(isVisibleElement)
        .filter(el => textMatchesAcademicYear(el.textContent, yearLabel))
        .sort((a, b) => {
            const aRect = a.getBoundingClientRect();
            const bRect = b.getBoundingClientRect();
            const aArea = aRect.width * aRect.height;
            const bArea = bRect.width * bRect.height;
            return aArea - bArea;
        })[0] ?? null;
}

function createGeneralStatCard(session, rankInfo) {
    const topPercent = Math.max(1, 100 - rankInfo.percentile);
    const grade = Number(session.userGrade).toFixed(2);
    const stats = rankInfo.stats;

    const card = document.createElement('div');
    card.className = 'mw-general-rank-card';

    card.innerHTML = `
    <div class="mw-general-rank-card-title">${session.displayName}</div>

    <div class="mw-general-rank-mainline">
      <span class="mw-general-rank-rank">${rankInfo.rank}</span>
      <span class="mw-general-rank-total">/ ${rankInfo.total}</span>
    </div>

    <div class="mw-general-rank-details">
      <span>Ta moyenne : <strong>${grade}</strong></span>
      <span>Top ${topPercent}%</span>
      ${stats ? `
        <span>Moy. promo : <strong>${formatStat(stats.average)}</strong></span>
        <span>Médiane : <strong>${formatStat(stats.median)}</strong></span>
        <span>Min : <strong>${formatStat(stats.min)}</strong></span>
        <span>Max : <strong>${formatStat(stats.max)}</strong></span>
      ` : ''}
    </div>
  `;

    return card;
}

function createGeneralRankPanel() {
    const panel = document.createElement('div');
    panel.className = 'mw-general-rank-panel';

    panel.innerHTML = `
    <div class="mw-general-rank-panel-header">
      <div>
        <div class="mw-general-rank-panel-title">Classement général</div>
        <div class="mw-general-rank-panel-subtitle">Année et semestres</div>
      </div>
    </div>
    <div class="mw-general-rank-grid"></div>
  `;

    return panel;
}

function createGeneralRankInsertionElement(panel, yearHeader) {
    const row = document.createElement('div');
    row.className = 'mw-general-rank-row pt-2 pb-4 g-0 flex-column align-items-center flex-md-row align-items-md-stretch row';

    const leftColumn = document.createElement('div');
    leftColumn.className = 'col-lg-3 col-md-4';

    const spacerColumn = document.createElement('div');
    spacerColumn.className = 'col-sm-1';

    const contentColumn = document.createElement('div');
    contentColumn.className = 'col-lg-8 col-md-7';
    contentColumn.appendChild(panel);

    row.appendChild(leftColumn);
    row.appendChild(spacerColumn);
    row.appendChild(contentColumn);

    return row;
}

function insertGeneralRankPanel(yearHeader, cards) {
    if (!cards.length || document.querySelector('.mw-general-rank-panel')) return null;

    const panel = createGeneralRankPanel();
    const grid = panel.querySelector('.mw-general-rank-grid');

    for (const card of cards) {
        grid.appendChild(card);
    }

    const insertionRoot =
        yearHeader.closest('.row') ??
        yearHeader.closest('.card, section, div') ??
        yearHeader.parentElement;

    insertionRoot.insertAdjacentElement(
        'afterend',
        createGeneralRankInsertionElement(panel, yearHeader)
    );

    return panel;
}

let generalRankInjectionInProgress = false;

async function injectGeneralRankBadges() {
    if (
        generalRankInjectionInProgress ||
        document.querySelector('.mw-general-rank-panel')
    ) {
        return;
    }

    generalRankInjectionInProgress = true;

    try {
        const yearLabel = '2025-2026';
        const yearHeader = findYearHeaderElement(yearLabel);

        if (!yearHeader) {
            if (document.readyState === 'complete') {
                console.warn(`[MyWay Rank] En-tête "${yearLabel}" introuvable pour l'injection générale`);
            }
            return;
        }

        const cachedRank = readCachedGeneralRank(yearLabel);
        if (cachedRank) {
            insertGeneralRankPanel(
                yearHeader,
                cachedRank.items.map(item => createGeneralStatCard(item.session, item.rankInfo))
            );
            return;
        }

        if (document.querySelector('.mw-general-rank-panel')) return;

        const generalRankData = await getGeneralRankData(yearLabel);
        if (!generalRankData.length) {
            return;
        }

        insertGeneralRankPanel(
            yearHeader,
            generalRankData.map(item => createGeneralStatCard(item.session, item.rankInfo))
        );
    } finally {
        generalRankInjectionInProgress = false;
    }
}


// ——————————————————————————————————————————
// Interception des clics sur l'icône graphique, par cours
// ——————————————————————————————————————————

let pendingRank = null;

function getCourseIdFromClick(clickedEl) {
    const card = clickedEl.closest('.card');
    if (!card) return null;

    return getCourseIdFromCard(card);
}

function getCourseIdFromCard(card) {
    const checkbox = card.querySelector('input[type="checkbox"][id^="course-"]');
    if (!checkbox) return null;

    const match = checkbox.id.match(/course-(\d+)/);
    return match ? parseInt(match[1], 10) : null;
}

async function handleChartClick(event) {
    const chartIcon = event.target.closest('[data-icon="chart-line"]');
    if (!chartIcon) return;

    const courseId = getCourseIdFromClick(chartIcon);
    if (!courseId) return;

    const card = chartIcon.closest('.card');

    const loadingBadge = document.createElement('div');
    loadingBadge.className = 'mw-rank-badge mw-rank-loading';
    loadingBadge.innerHTML = `
    <span class="mw-rank-accent" aria-hidden="true"></span>
    <span class="mw-rank-main">
      <span class="mw-rank-label">Classement</span>
      <span class="mw-rank-loading-text">Calcul en cours...</span>
    </span>
  `;

    card?.appendChild(loadingBadge);

    try {
        const data = await fetchStatsCached(courseId);
        const userGrade = Number.isFinite(data.userGrade) ? data.userGrade : parseMyWayMark(data.userGrade);
        const rankInfo = computeRankDetails(userGrade, data.allGrades);

        loadingBadge.remove();

        if (!rankInfo) {
            console.warn('[MyWay Rank] Impossible de calculer le rang du cours', {
                courseId,
                data
            });
            return;
        }

        pendingRank = rankInfo;

        setTimeout(() => {
            if (pendingRank) {
                injectRankInModal(pendingRank);
                pendingRank = null;
            }
        }, 300);
    } catch (error) {
        loadingBadge.remove();
        console.error('[MyWay Rank] Erreur:', error);
    }
}

document.addEventListener('click', handleChartClick, true);


// ——————————————————————————————————————————
// Observer les modifications du DOM
// ——————————————————————————————————————————

let generalInjectTimeout = null;

function scheduleGeneralInjection(delay = 0) {
    clearTimeout(generalInjectTimeout);
    generalInjectTimeout = setTimeout(() => {
        injectGeneralRankBadges();
    }, delay);
}

const domObserver = new MutationObserver((mutations) => {
    let shouldTryInjectModal = false;
    let shouldTryInjectGeneral = false;

    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;

            const isModal =
                node.matches?.('[class*="modal"], [role="dialog"]') ||
                node.querySelector?.('[class*="modal"], [role="dialog"]');

            if (isModal && pendingRank) {
                shouldTryInjectModal = true;
            }

            const text = normalizeText(node.textContent);
            const mightContainYear = text.includes('2025-2026');

            if (mightContainYear) {
                shouldTryInjectGeneral = true;
            }
        }

        if (mutation.target && pendingRank) {
            const modal = mutation.target.closest?.('[class*="modal"], [role="dialog"]');
            if (modal) shouldTryInjectModal = true;
        }
    }

    if (shouldTryInjectModal) {
        setTimeout(() => {
            injectRankInModal(pendingRank);
            pendingRank = null;
        }, 100);
    }

    if (shouldTryInjectGeneral) scheduleGeneralInjection();
});

function startDomObserver() {
    if (document.body) {
        domObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        return;
    }

    document.addEventListener('DOMContentLoaded', startDomObserver, { once: true });
}

startDomObserver();


// ——————————————————————————————————————————
// Styles CSS injectés
// ——————————————————————————————————————————

const style = document.createElement('style');

style.textContent = `
  /* Badge de classement dans la modal */
  .mw-rank-badge {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    box-sizing: border-box;
    width: 100%;
    background: #fff;
    border: 1px solid #1f2326;
    border-radius: 8px;
    padding: 14px 16px;
    margin: 12px 0 14px;
    box-shadow: 0 14px 34px rgba(23, 23, 23, 0.10);
    font-size: 14px;
    color: #202020;
  }

  .mw-rank-badge .mw-rank-accent {
    width: 4px;
    height: 42px;
    border-radius: 999px;
    background: #9a1f28;
  }

  .mw-rank-badge .mw-rank-main {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .mw-rank-badge .mw-rank-label {
    color: #73706a;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    line-height: 1;
    text-transform: uppercase;
  }

  .mw-rank-badge .mw-rank-line {
    display: flex;
    align-items: baseline;
    gap: 5px;
    min-width: 0;
  }

  .mw-rank-badge .mw-rank-value {
    color: #202020;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.1;
  }

  .mw-rank-badge .mw-rank-total {
    color: #858079;
    font-size: 18px;
    font-weight: 500;
    line-height: 1.1;
  }

  .mw-rank-badge .mw-rank-percentile {
    justify-self: end;
    color: #9a1f28;
    background: #fff;
    border: 1px solid #d9d5cc;
    border-radius: 999px;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
  }

  .mw-rank-badge .mw-rank-stats {
    grid-column: 2 / 4;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, auto));
    gap: 8px 12px;
    color: #605c55;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.2;
  }

  .mw-rank-badge .mw-rank-stats strong {
    color: #202020;
    font-weight: 700;
  }

  .mw-rank-badge.mw-rank-loading {
    border-color: #d9d5cc;
    box-shadow: none;
  }

  .mw-rank-badge.mw-rank-loading .mw-rank-accent {
    background: #c7c1b8;
  }

  .mw-rank-badge .mw-rank-loading-text {
    color: #55504a;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.2;
  }

  /* Bloc général sous l'année 2025-2026 */
  .mw-general-rank-panel {
    width: 100%;
    margin: 0;
    padding: 16px;
    box-sizing: border-box;
    background: #fff;
    border: 1px solid #dedbd5;
    border-radius: 12px;
    box-shadow: 0 14px 34px rgba(23, 23, 23, 0.08);
  }

  .mw-general-rank-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
    padding-left: 10px;
    border-left: 4px solid #9a1f28;
  }

  .mw-general-rank-panel-title {
    color: #202020;
    font-size: 15px;
    font-weight: 700;
    line-height: 1.2;
  }

  .mw-general-rank-panel-subtitle {
    margin-top: 3px;
    color: #77736c;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.2;
  }

  .mw-general-rank-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .mw-general-rank-card {
    min-width: 0;
    padding: 13px 12px;
    background: #fbfaf8;
    border: 1px solid #e4e0d8;
    border-radius: 10px;
  }

  .mw-general-rank-card-title {
    color: #73706a;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mw-general-rank-mainline {
    display: flex;
    align-items: baseline;
    gap: 4px;
    margin-top: 8px;
  }

  .mw-general-rank-rank {
    color: #202020;
    font-size: 24px;
    font-weight: 800;
    line-height: 1;
  }

  .mw-general-rank-total {
    color: #858079;
    font-size: 15px;
    font-weight: 600;
  }

  .mw-general-rank-details {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 9px;
    color: #605c55;
    font-size: 12px;
    line-height: 1.2;
  }

  .mw-general-rank-details strong {
    color: #202020;
    font-weight: 700;
  }

  @media (max-width: 520px) {
    .mw-rank-badge {
      grid-template-columns: auto minmax(0, 1fr);
      gap: 12px;
      padding: 13px 14px;
    }

    .mw-rank-badge .mw-rank-percentile {
      grid-column: 2;
      justify-self: start;
      margin-top: 2px;
    }

    .mw-rank-badge .mw-rank-stats {
      grid-column: 1 / -1;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .mw-general-rank-panel {
      width: 100%;
      padding: 14px;
    }

    .mw-general-rank-grid {
      grid-template-columns: 1fr;
    }
  }
`;

function appendStyleElement(styleElement) {
    const target = document.head || document.documentElement;

    if (target) {
        target.appendChild(styleElement);
        return;
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.head?.appendChild(styleElement);
    }, { once: true });
}

appendStyleElement(style);


// ——————————————————————————————————————————
// Initialisation
// ——————————————————————————————————————————

if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    prefetchGeneralRankData();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        scheduleGeneralInjection();
    });
} else {
    scheduleGeneralInjection();
}

console.log('[MyWay Rank] Extension chargée ✓');
