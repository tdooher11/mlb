#!/usr/bin/env node
/**
 * backtest.js — MLB HR Power Index backtester
 *
 * Usage:  node backtest.js [days=40] [topN=12]
 *
 * ⚠  Uses current season stats, not stats-as-of-date. Scores for early-season
 *    dates will be slightly inflated vs what the live tool would have shown,
 *    but the rank-order correlation is still meaningful for algorithm tuning.
 */

const MLB_BASE = 'https://statsapi.mlb.com/api/v1';

// ── Mirror constants from index.html ──────────────────────────────────────

const PARK_FACTORS = {
  'Great American Ball Park': 1.18,
  'Coors Field':              1.20,
  'Minute Maid Park':         1.10,
  'Citizens Bank Park':       1.13,
  'Yankee Stadium':           1.10,
  'Globe Life Field':         1.08,
  'Comerica Park':            0.91,
  'Oracle Park':              0.88,
  'Petco Park':               0.89,
  'T-Mobile Park':            0.90,
  'Kauffman Stadium':         0.93,
  'Dodger Stadium':           0.98,
  'Truist Park':              1.05,
  'American Family Field':    1.06,
  'Busch Stadium':            0.95,
  'Camden Yards':             1.09,
  'PNC Park':                 0.93,
  'Wrigley Field':            1.01,
  'Guaranteed Rate Field':    1.04,
  'Fenway Park':              0.97,
  'Target Field':             0.96,
  'Tropicana Field':          0.95,
  'loanDepot park':           0.92,
  'Citi Field':               0.94,
  'Rogers Centre':            1.03,
  'Angel Stadium':            0.97,
  'Oakland Coliseum':         0.95,
  'Chase Field':              1.05,
  'Nationals Park':           1.02,
  'Progressive Field':        0.98,
  'Sutter Health Park':       0.95, // Oakland A's Sacramento
};

const STADIUM_DATA = {
  'Yankee Stadium':           { lat: 40.8296,  lon: -73.9262,  bearing: 135, dome: false },
  'Fenway Park':              { lat: 42.3467,  lon: -71.0972,  bearing: 90,  dome: false },
  'Wrigley Field':            { lat: 41.9484,  lon: -87.6553,  bearing: 85,  dome: false },
  'Dodger Stadium':           { lat: 34.0739,  lon: -118.2400, bearing: 335, dome: false },
  'Oracle Park':              { lat: 37.7786,  lon: -122.3893, bearing: 40,  dome: false },
  'Coors Field':              { lat: 39.7559,  lon: -104.9942, bearing: 330, dome: false },
  'Great American Ball Park': { lat: 39.0975,  lon: -84.5061,  bearing: 10,  dome: false },
  'Truist Park':              { lat: 33.8908,  lon: -84.4678,  bearing: 55,  dome: false },
  'Camden Yards':             { lat: 39.2838,  lon: -76.6218,  bearing: 90,  dome: false },
  'Citizens Bank Park':       { lat: 39.9061,  lon: -75.1665,  bearing: 75,  dome: false },
  'T-Mobile Park':            { lat: 47.5914,  lon: -122.3325, bearing: 285, dome: false },
  'Petco Park':               { lat: 32.7073,  lon: -117.1566, bearing: 315, dome: false },
  'PNC Park':                 { lat: 40.4469,  lon: -80.0057,  bearing: 335, dome: false },
  'Busch Stadium':            { lat: 38.6226,  lon: -90.1928,  bearing: 355, dome: false },
  'Target Field':             { lat: 44.9817,  lon: -93.2781,  bearing: 295, dome: false },
  'Progressive Field':        { lat: 41.4962,  lon: -81.6852,  bearing: 315, dome: false },
  'Kauffman Stadium':         { lat: 39.0517,  lon: -94.4803,  bearing: 30,  dome: false },
  'Angel Stadium':            { lat: 33.8003,  lon: -117.8827, bearing: 285, dome: false },
  'Guaranteed Rate Field':    { lat: 41.8299,  lon: -87.6338,  bearing: 95,  dome: false },
  'Citi Field':               { lat: 40.7571,  lon: -73.8458,  bearing: 50,  dome: false },
  'Nationals Park':           { lat: 38.8730,  lon: -77.0074,  bearing: 15,  dome: false },
  'Comerica Park':            { lat: 42.3390,  lon: -83.0485,  bearing: 15,  dome: false },
  'Oakland Coliseum':         { lat: 37.7516,  lon: -122.2005, bearing: 330, dome: false },
  'Sutter Health Park':       { lat: 38.5803,  lon: -121.5002, bearing: 30,  dome: false },
  'Globe Life Field':         { lat: 32.7473,  lon: -97.0822,  bearing: 0,   dome: true  },
  'American Family Field':    { lat: 43.0280,  lon: -87.9712,  bearing: 0,   dome: true  },
  'Minute Maid Park':         { lat: 29.7572,  lon: -95.3555,  bearing: 0,   dome: true  },
  'loanDepot park':           { lat: 25.7781,  lon: -80.2197,  bearing: 0,   dome: true  },
  'Chase Field':              { lat: 33.4453,  lon: -112.0667, bearing: 0,   dome: true  },
  'Tropicana Field':          { lat: 27.7682,  lon: -82.6534,  bearing: 0,   dome: true  },
  'Rogers Centre':            { lat: 43.6414,  lon: -79.3894,  bearing: 0,   dome: true  },
};

const VENUE_ALIASES = {
  'Rate Field':                    'Guaranteed Rate Field',
  'UNIQLO Field at Dodger Stadium':'Dodger Stadium',
  'Oriole Park at Camden Yards':   'Camden Yards',
  'LoanDepot Park':                'loanDepot park',
  'loandepot park':                'loanDepot park',
  'Daikin Park':                   'Minute Maid Park',
};

function normalizeVenue(name) { return VENUE_ALIASES[name] || name; }

// ── Utilities ─────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function offsetDate(str, days) {
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m-1, d+days);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

async function apiFetch(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch(e) {
      if (i === retries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

// ── Weather ────────────────────────────────────────────────────────────────

function extractWeather(data, gameISODate, bearing, isArchive) {
  if (!data?.hourly?.time) return null;
  const gd = new Date(gameISODate);
  const target = [
    gd.getUTCFullYear(),
    String(gd.getUTCMonth()+1).padStart(2,'0'),
    String(gd.getUTCDate()).padStart(2,'0'),
  ].join('-') + 'T' + String(gd.getUTCHours()).padStart(2,'0') + ':00';

  const idx = data.hourly.time.indexOf(target);
  if (idx === -1) return null;

  const windSpeed  = data.hourly.wind_speed_10m?.[idx]  ?? 0;
  const windDir    = data.hourly.wind_direction_10m?.[idx] ?? 0;
  const temp       = data.hourly.temperature_2m?.[idx]  ?? 72;

  let precipProb = 0;
  if (isArchive) {
    const mm = data.hourly.precipitation?.[idx] ?? 0;
    precipProb = mm > 1 ? 80 : mm > 0.3 ? 50 : 0;
  } else {
    precipProb = data.hourly.precipitation_probability?.[idx] ?? 0;
  }

  const windTo = (windDir + 180) % 360;
  let diff = ((windTo - bearing) + 360) % 360;
  if (diff > 180) diff -= 360;
  const windOut = Math.round(windSpeed * Math.cos(diff * Math.PI / 180));
  return { windSpeed: Math.round(windSpeed), windOut, temp: Math.round(temp), precipProb };
}

function calcWeatherBonus(w) {
  if (!w) return 0;
  const windPart = Math.max(-3, Math.min(3, w.windOut / 10 * 2.5));
  const tempPart = (w.temp - 72) / 40;
  const rainPart = w.precipProb > 60 ? -2 : w.precipProb > 40 ? -1 : 0;
  return Math.round((windPart + tempPart + rainPart) * 10) / 10;
}

async function fetchWeatherForVenues(venues, date) {
  const today = todayStr();
  const isArchive = date < offsetDate(today, -6);
  const base = isArchive
    ? 'https://archive-api.open-meteo.com/v1/archive'
    : 'https://api.open-meteo.com/v1/forecast';
  const precipVar = isArchive ? 'precipitation' : 'precipitation_probability';
  const end = offsetDate(date, 1);

  const cache = {};
  await Promise.all(venues.map(async venue => {
    const sd = STADIUM_DATA[venue];
    if (!sd || sd.dome) return;
    try {
      const url = `${base}?latitude=${sd.lat}&longitude=${sd.lon}` +
        `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,${precipVar}` +
        `&wind_speed_unit=mph&temperature_unit=fahrenheit&timezone=UTC` +
        `&start_date=${date}&end_date=${end}`;
      const data = await fetch(url).then(r => r.json());
      cache[venue] = { data, isArchive };
    } catch(e) {}
  }));
  return cache;
}

// ── Actual HR results ─────────────────────────────────────────────────────

async function fetchActualHRs(gameIds) {
  const hrMap = {};
  await Promise.all([...gameIds].map(async gameId => {
    try {
      const data = await apiFetch(`${MLB_BASE}/game/${gameId}/boxscore`);
      for (const side of ['home', 'away']) {
        for (const player of Object.values(data.teams?.[side]?.players || {})) {
          const pid = player.person?.id;
          const hrs = parseInt(player.stats?.batting?.homeRuns) || 0;
          if (pid != null) hrMap[pid] = (hrMap[pid] || 0) + hrs;
        }
      }
    } catch(e) {}
  }));
  return hrMap;
}

// ── Score a single date ────────────────────────────────────────────────────

async function scoreDate(date) {
  const season = parseInt(date.split('-')[0]);
  const schedData = await apiFetch(
    `${MLB_BASE}/schedule?sportId=1&date=${date}&hydrate=probablePitcher,venue`
  );
  const games = schedData.dates?.[0]?.games || [];
  if (!games.length) return null;

  const playerMap = {};

  await Promise.all(games.map(async game => {
    const gameId   = game.gamePk;
    const venue    = normalizeVenue(game.venue?.name || 'Unknown');
    const parkFactor = PARK_FACTORS[venue] || 1.0;
    const gameStatus = game.status?.abstractGameState || 'Preview';

    const awayTeam   = game.teams?.away?.team;
    const homeTeam   = game.teams?.home?.team;
    const awayPitcher = game.teams?.away?.probablePitcher;
    const homePitcher = game.teams?.home?.probablePitcher;

    const [awayRoster, homeRoster] = await Promise.all([
      apiFetch(`${MLB_BASE}/teams/${awayTeam?.id}/roster?rosterType=active`).catch(() => ({ roster: [] })),
      apiFetch(`${MLB_BASE}/teams/${homeTeam?.id}/roster?rosterType=active`).catch(() => ({ roster: [] })),
    ]);

    const add = (roster, oppPitcher, myTeam, atHome) => {
      for (const e of roster.roster || []) {
        if (e.position?.type === 'Pitcher') continue;
        const pid = e.person?.id;
        if (!pid || playerMap[pid]) continue;
        playerMap[pid] = {
          id: pid, name: e.person?.fullName || 'Unknown',
          teamAbbr: myTeam?.abbreviation || '',
          position: e.position?.abbreviation || '?',
          opposingPitcher: oppPitcher || null,
          venue, parkFactor, gameDateISO: game.gameDate || '',
          gameId, atHome, gameStatus,
        };
      }
    };
    add(awayRoster, homePitcher, awayTeam, false);
    add(homeRoster, awayPitcher, homeTeam, true);
  }));

  const playerIds = Object.keys(playerMap);
  if (!playerIds.length) return null;

  // Season hitting stats (batched)
  const statsByPid = {};
  for (let i = 0; i < playerIds.length; i += 50) {
    const ids = playerIds.slice(i, i + 50).join(',');
    try {
      const res = await apiFetch(
        `${MLB_BASE}/people?personIds=${ids}&hydrate=stats(group=hitting,type=season,season=${season})`
      );
      for (const p of res.people || []) {
        const h = p.stats?.find(s => s.group?.displayName === 'hitting' && s.type?.displayName === 'season');
        if (h?.splits?.length) statsByPid[p.id] = h.splits[0].stat;
      }
    } catch(e) {}
  }

  // Pitcher stats
  const pitcherIds = [...new Set(
    Object.values(playerMap).map(p => p.opposingPitcher?.id).filter(Boolean)
  )];
  const pitcherStats = {};
  if (pitcherIds.length) {
    try {
      const res = await apiFetch(
        `${MLB_BASE}/people?personIds=${pitcherIds.join(',')}&hydrate=stats(group=pitching,type=season,season=${season})`
      );
      for (const p of res.people || []) {
        const pit = p.stats?.find(s => s.group?.displayName === 'pitching' && s.type?.displayName === 'season');
        if (pit?.splits?.length) pitcherStats[p.id] = pit.splits[0].stat;
      }
    } catch(e) {}
  }

  // Weather
  const uniqueVenues = [...new Set(Object.values(playerMap).map(p => p.venue))];
  const weatherCache = await fetchWeatherForVenues(uniqueVenues, date);

  // Score
  const picks = [];
  for (const pid of playerIds) {
    const meta = playerMap[pid];
    const s = statsByPid[pid];
    if (!s) continue;

    const pa  = parseInt(s.plateAppearances) || 0;
    const hr  = parseInt(s.homeRuns) || 0;
    const avg = parseFloat(s.avg) || 0;
    const obp = parseFloat(s.obp) || 0;
    const ops = parseFloat(s.ops) || 0;
    const slg = parseFloat(s.slg) || Math.max(0, ops - obp);
    const iso = Math.max(0, slg - avg);

    if (pa < 120) continue;

    const hrRate = hr / pa;

    const ps = meta.opposingPitcher?.id ? pitcherStats[meta.opposingPitcher.id] : null;
    const pitcherFactor = (ps ? (parseFloat(ps.homeRunsPer9) || 1.0) : 1.0) / 1.1;

    const sd = STADIUM_DATA[meta.venue];
    const wc = weatherCache[meta.venue];
    const weather = (sd && !sd.dome && wc && meta.gameDateISO)
      ? extractWeather(wc.data, meta.gameDateISO, sd.bearing, wc.isArchive)
      : null;
    const weatherBonus = calcWeatherBonus(weather);

    const isoForScore = Math.min(iso, 0.280);
    const rawScore =
      (hrRate * 500 * 0.35) +
      (isoForScore * 100 * 0.25) +
      (meta.parkFactor * 10 * 0.20) +
      (pitcherFactor * 10 * 0.20) +
      weatherBonus;

    picks.push({ ...meta, hr, pa, iso, score: Math.min(Math.round(rawScore), 99) });
  }

  picks.sort((a, b) => b.score - a.score);
  return picks.slice(0, 60);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const days = parseInt(process.argv[2]) || 40;
  const topN = parseInt(process.argv[3]) || 12;
  const today = todayStr();

  console.log(`\nMLB HR Power Index Backtest`);
  console.log(`Period: last ${days} days  |  Top ${topN} picks per day`);
  console.log(`⚠  Uses current season stats (not as-of-date)\n`);
  console.log('─'.repeat(80));

  const results = [];

  for (let i = days; i >= 1; i--) {
    const date = offsetDate(today, -i);
    process.stdout.write(`${date}  loading...`);

    try {
      const picks = await scoreDate(date);

      if (!picks) {
        process.stdout.write(`\r${date}  — no games scheduled\n`);
        continue;
      }

      const top = picks.slice(0, topN);
      const finishedIds = new Set(
        top.filter(p => p.gameStatus === 'Final' || p.gameStatus === 'Live').map(p => p.gameId)
      );

      if (!finishedIds.size) {
        process.stdout.write(`\r${date}  — games not completed\n`);
        continue;
      }

      const hrMap = await fetchActualHRs(finishedIds);
      let hits = 0;
      const withResults = top.map(p => {
        const actualHR = hrMap[p.id] ?? 0;
        if (actualHR > 0) hits++;
        return { ...p, actualHR };
      });

      const pct = (hits / topN * 100).toFixed(0);
      const hrLine = withResults
        .filter(p => p.actualHR > 0)
        .map(p => `${p.name}${p.actualHR > 1 ? ` ×${p.actualHR}` : ''} (#${top.indexOf(p) + 1})`)
        .join(', ');

      process.stdout.write(`\r${date}  ${String(hits).padStart(2)}/${topN} = ${String(pct).padStart(3)}%`);
      if (hrLine) process.stdout.write(`  ${hrLine}`);
      console.log();

      results.push({ date, picks: withResults, hits, topN });
    } catch(e) {
      process.stdout.write(`\r${date}  error: ${e.message}\n`);
    }

    await sleep(700);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const valid = results.filter(r => r.topN > 0);
  if (!valid.length) { console.log('\nNo completed days found.'); return; }

  const totalHits  = valid.reduce((s, r) => s + r.hits, 0);
  const totalPicks = valid.reduce((s, r) => s + r.topN, 0);
  const overallPct = (totalHits / totalPicks * 100).toFixed(1);
  const multiplier = (totalHits / totalPicks / 0.12).toFixed(2);

  console.log('\n' + '═'.repeat(80));
  console.log(`Days analyzed : ${valid.length}`);
  console.log(`Total picks   : ${totalPicks}`);
  console.log(`HR hits       : ${totalHits}  (${overallPct}%)`);
  console.log(`League avg    : ~12%`);
  console.log(`Multiplier    : ${multiplier}x better than random`);

  // Hit rate by rank
  console.log('\nHit rate by rank position:');
  for (let rank = 0; rank < topN; rank++) {
    const atRank  = valid.map(r => r.picks[rank]).filter(Boolean);
    const hitsHere = atRank.filter(p => p.actualHR > 0).length;
    const pct      = atRank.length ? (hitsHere / atRank.length * 100).toFixed(0) : '—';
    const bar      = '█'.repeat(Math.round((hitsHere / atRank.length || 0) * 30));
    console.log(`  #${String(rank+1).padStart(2)}  ${String(hitsHere).padStart(2)}/${atRank.length} = ${String(pct).padStart(3)}%  ${bar}`);
  }

  // Best and worst days
  const sorted = [...valid].sort((a, b) => b.hits/b.topN - a.hits/a.topN);
  console.log('\nBest days:');
  sorted.slice(0, 5).forEach(r =>
    console.log(`  ${r.date}  ${r.hits}/${r.topN} = ${(r.hits/r.topN*100).toFixed(0)}%`)
  );
  console.log('\nWorst days:');
  sorted.slice(-5).reverse().forEach(r =>
    console.log(`  ${r.date}  ${r.hits}/${r.topN} = ${(r.hits/r.topN*100).toFixed(0)}%`)
  );
}

main().catch(console.error);
