#!/usr/bin/env node
/**
 * 고용24 공고의 복리후생·사회보험·근무형태를 채운다. (표에 '복리후생' 열이 있어 필요)
 * 고용24는 항목이 표로 구조화돼 있어 라벨 조각 바로 다음이 값이다.
 *
 * 주의: 복리후생이 비어 있는 공고는 다음 조각으로 UI 문구인 "관심정보 등록" 이 잡힌다.
 *       그 값은 복리후생이 아니므로 버린다.
 */
const fs = require('fs'), path = require('path');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const segs = html => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, '|').replace(/&nbsp;|&[a-z]+;/gi, ' ')
  .split('|').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

const after = (s, label) => {
  const i = s.findIndex(x => x === label);
  return i >= 0 ? (s[i + 1] || '') : '';
};
const UI_NOISE = /^(관심정보 등록|선택됨|-)$/;

(async () => {
  const p = path.join(__dirname, 'candidates.json');
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const list = data.candidates.filter(c => c.site === '고용24' && c.detail && !c.detail.wf);
  console.error(`복리후생 조회 대상: ${list.length}건`);
  let ok = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    try {
      const r = await fetch(c.url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(25000) });
      const s = segs(await r.text());
      const wf = after(s, '복리후생'), ins = after(s, '사회보험'), form = after(s, '근무형태');
      const parts = [];
      if (wf && !UI_NOISE.test(wf) && wf.length < 60) parts.push(wf);
      if (/보험/.test(ins)) parts.push(/국민연금.*고용보험.*산재보험.*건강보험/.test(ins) ? '4대보험' : ins.slice(0, 40));
      if (parts.length) { c.detail.wf = parts.join('·'); ok++; }
      if (form && form.length < 60) c.detail.form = form;
    } catch (e) { /* 못 채우면 표에는 '—' 로 나간다 */ }
    if ((i + 1) % 10 === 0) console.error(`  ...${i + 1}/${list.length}`);
    await sleep(350);
  }
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.error(`복리후생 확보 ${ok}건`);
})();
