#!/usr/bin/env node
/**
 * 후보 공고의 "등록일"을 채운다.  node dates.js [--missing]
 *
 * 왜 필요한가: enrich.js 는 목록 ctx 에 등록일이 실려 있을 때만 날짜를 잡는데,
 * "작년도 공고 금지" 규칙을 검증하려면 등록일이 반드시 있어야 한다.
 *
 * 사이트별 실제 위치 (2026-08-28 확인):
 *   잡코리아·알바몬·알바천국 : 상세페이지 JSON-LD 의 datePosted
 *   고용24                   : 본문 "등록일시" (표 안이라 태그를 걷어내야 잡힘)
 *   사람인                   : PC 상세에는 없음 → 모바일(m.saramin.co.kr) 의 "시작일"
 *
 * 주의: 사람인 모바일은 연속 호출 시 짧은 응답으로 막힌다. 간격을 1초 이상 두고
 *       실패 시 재시도할 것 (fixdates.js 가 그 재시도 버전).
 */
const fs = require('fs'), path = require('path');
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UA_MO = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const get = async (url, ua) => {
  const r = await fetch(url, { headers: { 'User-Agent': ua, 'Accept-Language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
};

const norm = (y, m, d) => `${y.length === 2 ? '20' + y : y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/* 고용24는 "등록일시 2026.08.24 13:33:35" 가 표 안에 있어 태그를 걷어내야 잡힌다 */
const detag = h => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&[a-z]+;/gi, ' ').replace(/\s+/g, ' ');

function findDate(raw, mode) {
  const html = mode === 'ld' ? raw + ' ' + detag(raw) : raw;
  const pats = mode === 'saramin'
    ? [/시작일[\s\S]{0,60}?(\d{4})\.(\d{1,2})\.(\d{1,2})/]
    : [
        /datePosted\\*"\s*:\s*\\*"(\d{4})-(\d{2})-(\d{2})/,
        /등록일시?[^\d]{0,25}(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/,
        /등록일시?[^\d]{0,25}(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/,
        /게시일[^\d]{0,25}(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/,
      ];
  for (const p of pats) {
    const m = html.match(p);
    if (m) return norm(m[1], m[2], m[3]);
  }
  return '';
}

(async () => {
  const p = path.join(__dirname, 'candidates.json');
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const only = process.argv.includes('--missing');
  const list = data.candidates.filter(c => !only || !(c.detail && c.detail.reg));
  console.error(`등록일 조회 대상: ${list.length}건`);
  let ok = 0; const errs = {};
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    try {
      const d = c.site === '사람인'
        ? findDate(await get(`https://m.saramin.co.kr/job-search/view?rec_idx=${c.id}`, UA_MO), 'saramin')
        : findDate(await get(c.url, UA_PC), 'ld');
      if (d) { c.detail = c.detail || {}; c.detail.reg = d; ok++; }
      else errs[c.site + ':날짜없음'] = (errs[c.site + ':날짜없음'] || 0) + 1;
    } catch (e) {
      errs[c.site + ':' + e.message] = (errs[c.site + ':' + e.message] || 0) + 1;
    }
    if ((i + 1) % 30 === 0) console.error(`  ...${i + 1}/${list.length} (확보 ${ok})`);
    await sleep(1000);
  }
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.error(`등록일 확보 ${ok}건 / 조회 ${list.length}건`);
  console.error('실패 사유:', JSON.stringify(errs, null, 1));
})();
