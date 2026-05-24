/**
 * MyWay - Classement Promo
 * Developed by Nathan Di Fraja.
 * Independent project, not affiliated with CentraleSupélec or MyWay.
 *
 * Ce script s'injecte sur la page MyWay et ajoute :
 * 1. Le classement dans la promo à côté du graphique de distribution existant, par cours.
 * 2. Le classement par moyenne générale annuelle sous le bloc de l'année.
 */

const CURRENT_ACADEMIC_YEAR = '2025-2026';

// ——————————————————————————————————————————
// Utilitaires
// ——————————————————————————————————————————

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
 * Calcule le classement de l'étudiant et les stats de la promo en un seul passage.
 */
function computeRankDetails(userGrade, allGrades) {
    const numericGrades = [];
    let sum = 0;

    // Un seul parsing
    for (const grade of (allGrades || [])) {
        const parsed = parseMyWayMark(grade);
        if (Number.isFinite(parsed)) {
            numericGrades.push(parsed);
            sum += parsed;
        }
    }

    const total = numericGrades.length;
    if (!Number.isFinite(userGrade) || total === 0) return null;

    let better = 0;
    for (const g of numericGrades) {
        if (g > userGrade) better++;
    }

    const rank = better + 1;
    const percentile = Math.round(((total - better) / total) * 100);

    // Tri uniquement requis pour la médiane et le min/max
    numericGrades.sort((a, b) => a - b);
    const middle = Math.floor(total / 2);
    const median = total % 2
        ? numericGrades[middle]
        : (numericGrades[middle - 1] + numericGrades[middle]) / 2;

    return {
        rank, total, percentile,
        stats: {
            average: sum / total,
            median,
            min: numericGrades[0],
            max: numericGrades[total - 1]
        }
    };
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

function findAcademicYearRoot(gradesData, academicYear = CURRENT_ACADEMIC_YEAR) {
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

function getGeneralSessionsFromGrades(gradesData, academicYear = CURRENT_ACADEMIC_YEAR) {
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

async function getGeneralRankData(academicYear = CURRENT_ACADEMIC_YEAR) {
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
// Bloc général sous l'année
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
 * Trouve le plus petit élément visible qui référence l'année académique via un TreeWalker.
 */
function findYearHeaderElement(yearLabel = CURRENT_ACADEMIC_YEAR) {
    const [startYear, endYear] = yearLabel.split(/\s*[-–—]\s*/);
    const pattern = new RegExp(`${startYear}\\s*[-–—]\\s*${endYear}`);
    
    // Le TreeWalker ne parcourt QUE les nœuds de texte
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    const candidates = [];
    
    while ((node = walker.nextNode())) {
        if (pattern.test(node.nodeValue) && node.parentElement) {
            candidates.push(node.parentElement);
        }
    }

    return candidates
        .filter(isVisibleElement)
        .sort((a, b) => {
            const aRect = a.getBoundingClientRect();
            const bRect = b.getBoundingClientRect();
            return (aRect.width * aRect.height) - (bRect.width * bRect.height);
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
        const yearLabel = CURRENT_ACADEMIC_YEAR;
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

    const startYearText = CURRENT_ACADEMIC_YEAR.split('-')[0];

    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;

            const isModal =
                node.matches?.('[class*="modal"], [role="dialog"]') ||
                node.querySelector?.('[class*="modal"], [role="dialog"]');

            if (isModal && pendingRank) {
                shouldTryInjectModal = true;
            }

            // Vérification allégée sans parsing lourd Regex
            const mightContainYear = node.textContent && node.textContent.includes(startYearText);

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
// Initialisation
// ——————————————————————————————————————————

// On ne fait PLUS de requêtes réseau agressives (prefetch) au lancement du script.
// Le navigateur a besoin de sa bande passante pour charger le site d'abord !
// L'injection se lancera automatiquement quand le DOM sera prêt via le MutationObserver.

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        scheduleGeneralInjection(1000);
    });
} else {
    scheduleGeneralInjection(1000);
}

console.log('[MyWay Rank] Extension chargée ✓');
