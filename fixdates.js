/* merged.json 에서 등록일이 아직 '—' 인 공고만 다시 시도한다.
   사람인 모바일은 연속 호출 시 차단이 걸리므로 간격을 늘리고 2회까지 재시도한다. */
const fs = require('fs');
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UA_MO = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const detag = h => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&[a-z]+;/gi, ' ').replace(/\s+/g, ' ');
const norm = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const yymmdd = iso => iso.slice(2).replace(/-/g, '/');

const get = async (url, ua) => {
  const r = await fetch(url, { headers: { 'User-Agent': ua, 'Accept-Language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const t = await r.text();
  if (t.length < 3000) throw new Error('short ' + t.length);
  return t;
};

async function one(j) {
  if (/saramin/.test(j.url)) {
    const id = j.id || (j.url.match(/rec_idx=(\d+)/) || [])[1];
    if (!id) return '';
    const h = await get('https://m.saramin.co.kr/job-search/view?rec_idx=' + id, UA_MO);
    const m = h.match(/시작일[\s\S]{0,60}?(\d{4})\.(\d{1,2})\.(\d{1,2})/);
    return m ? norm(m[1], m[2], m[3]) : '';
  }
  const raw = await get(j.url, UA_PC);
  const h = raw + ' ' + detag(raw);
  for (const p of [/datePosted\\*"\s*:\s*\\*"(\d{4})-(\d{2})-(\d{2})/,
                   /등록일시?[^\d]{0,25}(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/,
                   /게시일[^\d]{0,25}(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/]) {
    const m = h.match(p);
    if (m) return norm(m[1], m[2], m[3]);
  }
  return '';
}

(async () => {
  const all = JSON.parse(fs.readFileSync('merged.json', 'utf8'));
  const need = all.filter(j => j.d === '—');
  console.log('재시도 대상:', need.length);
  let ok = 0; const errs = {};
  for (let i = 0; i < need.length; i++) {
    const j = need[i];
    for (let a = 0; a < 2 && j.d === '—'; a++) {
      try {
        const d = await one(j);
        if (d) { j.d = yymmdd(d); j.dfix = 1; ok++; }
        else errs['날짜없음'] = (errs['날짜없음'] || 0) + 1;
      } catch (e) { errs[e.message] = (errs[e.message] || 0) + 1; await sleep(2500); }
      await sleep(1200);
    }
    if ((i + 1) % 10 === 0) console.log(`  ...${i + 1}/${need.length} (확보 ${ok})`);
  }
  console.log(`확보 ${ok}/${need.length}`, JSON.stringify(errs));
  fs.writeFileSync('merged.json', JSON.stringify(all, null, 1), 'utf8');
  const still = all.filter(j => j.d === '—');
  console.log('미확보 잔여:', still.length);
  still.forEach(j => console.log('   ', j.src, j.corp, '|', j.hotel, '|', j.url));
})();
