#!/usr/bin/env node
/**
 * candidates.json 의 각 후보를 실제 공고 페이지까지 열어 상세정보를 채운다.
 *
 * 왜 필요한가:
 *   선별을 담당하는 AI 에이전트는 클라우드에서 도는데, 한국 채용사이트가 클라우드 IP를
 *   403으로 막는다(2026-08-24 확인). 그래서 "웹 접근이 되는 곳"인 GitHub Actions 안에서
 *   상세정보까지 미리 뽑아두고, 에이전트는 판단만 하도록 역할을 나눈다.
 *
 * 채우는 값: 회사명 / 공고제목 / 급여 / 근무지 / 등록일
 */
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const flat = s => s.replace(/\s+/g, ' ').trim();

const get = async url => {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
};

/** 태그를 구분자로 바꿔 조각 배열로 (본문에서 라벨-값 쌍을 찾기 위함) */
const segs = html => flat(
  html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '|')
      .replace(/&nbsp;|&[a-z]+;/gi, ' ')
).split('|').map(s => s.trim()).filter(Boolean);

const PAY = /(월급|일급|시급|연봉|건별)\s*[\d,]+\s*(만원|원)?(\s*(이상|~\s*[\d,]+\s*(만원|원)?))?/;

function parse(site, html) {
  const title = flat((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
  const t = flat(html);
  const out = { title: title.slice(0, 120), corp: '', name: '', pay: '', loc: '' };

  if (site === '고용24') {
    const s = segs(html);
    // 상세페이지는 [회사명] ... [공고제목] ... 순으로 나온다. '채용정보 상세' 뒤쪽에서 찾는다.
    const start = Math.max(s.lastIndexOf('채용정보 상세'), 0);
    const tail = s.slice(start, start + 60);
    out.corp = tail.find(x => /㈜|\(주\)|（주）|주식회사|유한회사|회사|그룹/.test(x) && x.length < 45) || '';
    const ci = out.corp ? tail.indexOf(out.corp) : -1;
    out.name = (ci >= 0 ? tail.slice(ci + 1, ci + 8) : tail)
      .find(x => x.length > 5 && x.length < 80 && !/조회수|대기업|중견|코스피|가족|지원자격|근무조건/.test(x)) || '';
    out.loc = (t.match(/지역\s*\|?\s*(부산광역시[^<|]{0,60}|경상남도[^<|]{0,60})/) || [])[1] || '';
    if (!out.loc) out.loc = (t.match(/(부산광역시[^<|]{0,55})/) || [])[1] || '';
  } else if (site === '사람인') {
    // <title> = [회사명] 공고명(D-n) - 사람인
    const m = title.match(/^\[([^\]]+)\]\s*(.*?)(?:\([^)]*\))?\s*-\s*사람인/);
    if (m) { out.corp = m[1]; out.name = m[2]; }
    out.loc = (t.match(/근무지위치[^가-힣]{0,12}([^<]{0,60})/) || [])[1] || '';
  } else if (site === '잡코리아') {
    const m = title.match(/^(.*?)\s*채용\s*-\s*(.*?)\s*\|\s*잡코리아/);
    if (m) { out.corp = m[1]; out.name = m[2]; }
  } else if (site === '알바몬') {
    const m = title.match(/^\[([^\]]+)\]\s*\|\s*(.*?)\s*\|\s*알바몬/);
    if (m) { out.corp = m[1]; out.name = m[2]; }
    else out.name = title.replace(/\s*\|\s*알바몬.*/, '');
  } else if (site === '알바천국') {
    const m = title.match(/^(.*?)\s*채용정보\s*:\s*(.*?)\s*-\s*알바천국/);
    if (m) { out.corp = m[1]; out.name = m[2]; }
  }
  out.pay = flat((t.match(PAY) || [])[0] || '');
  ['corp', 'name', 'loc'].forEach(k => { out[k] = flat(out[k]).slice(0, 70); });
  return out;
}

(async () => {
  const p = path.join(__dirname, 'candidates.json');
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const list = data.candidates || [];
  console.error(`상세 조회 대상: ${list.length}건`);
  let ok = 0, fail = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    try {
      // 고용24 상세는 필수 파라미터가 없으면 빈 페이지가 온다 (과거 수집분 방어)
      let url = c.url;
      if (c.site === '고용24' && /wantedAuthNo=/.test(url) && !/infoTypeCd=/.test(url)) {
        url += '&infoTypeCd=VALIDATION&infoTypeGroup=tb_workinfoworknet';
        c.url = url;
      }
      const html = await get(url);
      c.detail = parse(c.site, html);
      // 등록일은 목록 ctx 쪽이 더 정확한 경우가 많아 함께 보존
      const reg = (c.ctx || '').match(/등록일\s*:?\s*(\d{4}-\d{2}-\d{2})/);
      if (reg) c.detail.reg = reg[1];
      ok++;
    } catch (e) {
      c.detail = { error: e.message };
      fail++;
    }
    if ((i + 1) % 25 === 0) console.error(`  ...${i + 1}/${list.length}`);
    await sleep(400);
  }
  data.enrichedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.error(`상세 조회 완료 — 성공 ${ok} / 실패 ${fail}`);
})();
