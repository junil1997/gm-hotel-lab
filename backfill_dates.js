#!/usr/bin/env node
/**
 * 등록일 보완기 — index.html JOBS 중 등록일(d)이 '—'인 공고의 원문을 열어 실제 등록일을 찾아 채운다.
 *   node backfill_dates.js          → 찾은 날짜를 index.html 에 반영(d 교체 + dfix:1 표시)
 *   node backfill_dates.js --dry    → 반영하지 않고 결과만 출력
 * 판독 규칙은 fixdates.js 와 같음(사람인 모바일 '시작일', 그 외 datePosted·등록일시). 못 찾은 건 '—' 그대로 둔다(추측 금지).
 */
const fs = require('fs');
const path = require('path');
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const UA_MO = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const detag = h => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&[a-z]+;/gi, ' ').replace(/\s+/g, ' ');
const norm = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const FILE = path.join(__dirname, 'index.html');

async function get(url, ua){
  const r = await fetch(url, { headers: { 'User-Agent': ua, 'Accept-Language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(30000) });
  return { code: r.status, body: await r.text() };
}
async function regDate(url){
  if (/saramin/.test(url)) {
    const id = (url.match(/rec_idx=(\d+)/) || [])[1];
    const { body } = await get('https://m.saramin.co.kr/job-search/view?rec_idx=' + id, UA_MO);
    let m = body.match(/시작일[\s\S]{0,60}?(\d{4})\.(\d{1,2})\.(\d{1,2})/);
    if (m) return norm(m[1], m[2], m[3]);
    const pc = (await get(url, UA_PC)).body;
    m = pc.match(/datePosted\\*"\s*:\s*\\*"(\d{4})-(\d{2})-(\d{2})/);
    return m ? norm(m[1], m[2], m[3]) : '';
  }
  const { body } = await get(url, UA_PC);
  const h = body + ' ' + detag(body);
  for (const p of [/datePosted\\*"\s*:\s*\\*"(\d{4})-(\d{2})-(\d{2})/,
                   /등록일시?\s*[:：]?\s*(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/,
                   /(?:registDate|regDt|regDate|openDate)\\*"\s*:\s*\\*"(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})/i]) {
    const m = h.match(p); if (m) return norm(m[1], m[2], m[3]);
  }
  return '';
}

(async () => {
  const dry = process.argv.includes('--dry');
  let html = fs.readFileSync(FILE, 'utf8');
  const L = html.split('\n');
  const i0 = L.findIndex(x => x.trim().startsWith('const JOBS = ['));
  let i1 = i0; while (L[i1].trim() !== '];') i1++;
  const targets = [];
  for (let i = i0 + 1; i < i1; i++) {
    if (!/^\s*\{ d:'—'/.test(L[i])) continue;
    const u = (L[i].match(/u:'(https:[^']+)'/) || [])[1] || ((L[i].match(/\bid:(\d+)/) || [])[1] ? 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=' + L[i].match(/\bid:(\d+)/)[1] : '');
    if (u) targets.push({ i, u });
  }
  console.log('등록일 없는 공고', targets.length, '건');
  let ok = 0; const months = {};
  for (const t of targets) {
    let d = '';
    for (let k = 0; k < 2 && !d; k++) { try { d = await regDate(t.u); } catch (e) {} if (!d) await sleep(1500); }
    if (d && /^2026-/.test(d)) {
      ok++; months[d.slice(0, 7)] = (months[d.slice(0, 7)] || 0) + 1;
      const yy = d.slice(2).replace(/-/g, '/');
      L[t.i] = L[t.i].replace(/^(\s*)\{ d:'—',/, `$1{ d:'${yy}', dfix:1,`);
    } else console.log('  못 찾음:', t.u.slice(0, 95));
    await sleep(/saramin/.test(t.u) ? 900 : 300);
  }
  console.log('찾음', ok, '/', targets.length, '| 월별', JSON.stringify(months));
  if (!dry) { fs.writeFileSync(FILE, L.join('\n')); console.log('index.html 반영 완료'); }
})();
