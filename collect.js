#!/usr/bin/env node
/**
 * 지엠네트웍스 호텔 상권분석 — 부산 구인공고 자동 수집기
 *
 * 사용법:  node collect.js            → 신규 공고만 candidates.json 으로 출력
 *          node collect.js --all      → 기존 수집분 포함 전체 출력
 *
 * 동작: 5개 채용사이트(고용24·사람인·잡코리아·알바몬·알바천국)를 검색하고,
 *       index.html 에 이미 들어있는 공고번호와 대조해 "신규 공고"만 골라낸다.
 *       호텔명·도급업체 판정 같은 판단이 필요한 정리는 사람(또는 에이전트)이 수행.
 */

const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const enc = encodeURIComponent;

/** 수집 대상: 사이트 × 검색 키워드 */
const TARGETS = [
  // ── 고용24 (부산 지역필터 region=26000) — 정부 원문 URL 확보 가능
  ...['룸메이드', '하우스맨', '인스펙터', '하우스키핑', '객실정비', '호텔 시설', '호텔 미화', '영선', '숙박서비스종사원', '숙박시설 서비스원'].map(kw => ({
    site: '고용24', kw,
    url: `https://www.work24.go.kr/wk/a/b/1200/retriveDtlEmpSrchList.do?srcKeyword=${enc(kw)}` +
         `&region=26000&codeDepth1Info=26000&codeDepth2Info=26000&resultCnt=50` +
         `&sortField=DATE&sortOrderBy=DESC&siteClcd=all&searchMode=Y&pageIndex=1`,
  })),
  // ── 사람인 (부산 loc_cd=106000)
  ...['호텔 룸메이드', '호텔 하우스맨', '호텔 인스펙터', '호텔 하우스키핑', '호텔 시설', '호텔 미화', '호텔 영선'].map(kw => ({
    site: '사람인', kw,
    url: `https://www.saramin.co.kr/zf_user/search/recruit?searchword=${enc(kw)}&loc_cd=106000&recruitPageCount=100`,
  })),
  // ── 잡코리아 (전국 검색 후 부산만 필터)
  ...['호텔 하우스키핑', '호텔 시설관리', '객실정비', '호텔 룸메이드'].map(kw => ({
    site: '잡코리아', kw,
    url: `https://www.jobkorea.co.kr/Search/?stext=${enc(kw)}&tabType=recruit`,
  })),
  // ── 알바몬 (잡코리아 통합검색의 알바몬 탭)
  ...['부산 호텔 룸메이드', '부산 호텔 객실청소'].map(kw => ({
    site: '알바몬', kw,
    url: `https://www.jobkorea.co.kr/Search/?stext=${enc(kw)}&tabType=amRecruit`,
  })),
  // ── 알바천국
  ...['부산 호텔 룸메이드', '부산 호텔 하우스키핑'].map(kw => ({
    site: '알바천국', kw,
    url: `https://www.alba.co.kr/search/Search?section=ALL&srchType=ALL&clsType=search&EasySearch=mainSearch&wsSrchWord=${enc(kw)}`,
  })),
];

/** 사이트별 공고 추출 규칙 */
const EXTRACT = {
  '고용24': html => uniq(html, /wantedAuthNo=([A-Za-z0-9]+)/g,
    id => `https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=${id}&infoTypeCd=VALIDATION&infoTypeGroup=tb_workinfoworknet`),
  '사람인': html => uniq(html, /rec_idx=(\d+)/g,
    id => `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${id}`),
  '잡코리아': html => uniq(html, /\/Recruit\/GI_Read\/(\d+)/g,
    id => `https://www.jobkorea.co.kr/Recruit/GI_Read/${id}`),
  '알바몬': html => uniq(html, /albamon\.com\/jobs\/detail\/(\d+)/g,
    id => `https://www.albamon.com/jobs/detail/${id}`),
  '알바천국': html => uniq(html, /joblistscrapgen(\d+)/g,
    id => `https://www.alba.co.kr/job/Detail?adid=${id}`),
};

function uniq(html, re, urlFn) {
  const out = new Map();
  let m;
  while ((m = re.exec(html))) if (!out.has(m[1])) out.set(m[1], { id: m[1], url: urlFn(m[1]) });
  return [...out.values()];
}

const strip = s => s
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&[a-z]+;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * 공고번호가 여러 번(스크립트·목록 등) 나오므로, 등장 위치마다 주변을 훑어
 * '실제 목록 행'으로 보이는 것(급여·등록일·지역이 있는 텍스트)을 고른다.
 */
function context(html, id) {
  let best = '';
  let idx = -1;
  while ((idx = html.indexOf(id, idx + 1)) >= 0) {
    const t = strip(html.slice(Math.max(0, idx - 1500), idx + 1500));
    let score = 0;
    if (/부산/.test(t)) score += 3;
    if (/등록일|마감일|D-\d/.test(t)) score += 2;
    if (/월급|일급|시급|연봉|만원|원/.test(t)) score += 2;
    if (/호텔|리조트|레지던스|모텔/.test(t)) score += 2;
    if (/function|var |\$\(|jQuery|substring/.test(t)) score -= 6;
    if (score > 0 && t.length > best.length * 0.5) {
      const cur = best ? scoreOf(best) : -99;
      if (score > cur) { best = t; best.__s = score; }
    }
    if (!best && score > 0) best = t;
  }
  return (best || strip(html.slice(0, 0))).slice(0, 300);
  function scoreOf(t) {
    let s = 0;
    if (/부산/.test(t)) s += 3;
    if (/등록일|마감일|D-\d/.test(t)) s += 2;
    if (/월급|일급|시급|연봉|만원/.test(t)) s += 2;
    if (/호텔|리조트|레지던스|모텔/.test(t)) s += 2;
    if (/function|var |\$\(|jQuery|substring/.test(t)) s -= 6;
    return s;
  }
}

async function get(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

/** index.html 안의 JOBS 배열에서 이미 수집한 공고번호를 뽑는다 */
function knownIds(indexHtml) {
  const ids = new Set();
  for (const m of indexHtml.matchAll(/id:(\d+)/g)) ids.add(m[1]);                       // 사람인
  for (const m of indexHtml.matchAll(/wantedAuthNo=([A-Za-z0-9]+)/g)) ids.add(m[1]);    // 고용24
  for (const m of indexHtml.matchAll(/GI_Read\/(\d+)/g)) ids.add(m[1]);                 // 잡코리아
  for (const m of indexHtml.matchAll(/jobs\/detail\/(\d+)/g)) ids.add(m[1]);            // 알바몬
  for (const m of indexHtml.matchAll(/adid=(\d+)/g)) ids.add(m[1]);                     // 알바천국
  return ids;
}

(async () => {
  const showAll = process.argv.includes('--all');
  const indexPath = path.join(__dirname, 'index.html');
  const known = fs.existsSync(indexPath) ? knownIds(fs.readFileSync(indexPath, 'utf8')) : new Set();
  console.error(`기존 수집 공고번호: ${known.size}건`);

  const found = new Map();   // id -> {id, url, site, kw, ctx}
  const report = [];

  for (const t of TARGETS) {
    try {
      const html = await get(t.url);
      const rows = EXTRACT[t.site](html);
      // 고용24·사람인은 URL에 부산 지역필터가 걸려 있으나, 잡코리아 등은 없으므로 본문에서 부산 여부를 확인
      const needBusanCheck = !['고용24', '사람인'].includes(t.site);
      let neu = 0, skipped = 0;
      for (const r of rows) {
        if (found.has(r.id)) continue;
        if (!showAll && known.has(r.id)) continue;
        const ctx = context(html, r.id);
        if (needBusanCheck && !/부산|해운대|기장|김해/.test(ctx)) { skipped++; continue; }
        found.set(r.id, { ...r, site: t.site, kw: t.kw, ctx });
        neu++;
      }
      const tail = skipped ? ` / 부산외 제외 ${skipped}` : '';
      report.push(`${t.site} "${t.kw}" → 조회 ${rows.length} / 신규 ${neu}${tail}`);
      console.error(`  ✓ ${t.site} "${t.kw}" : ${rows.length}건 (신규 ${neu}${tail})`);
    } catch (e) {
      report.push(`${t.site} "${t.kw}" → 실패 (${e.message})`);
      console.error(`  ✗ ${t.site} "${t.kw}" : ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 1500));  // 사이트 부하 방지
  }

  const list = [...found.values()];
  const out = {
    collectedAt: new Date().toISOString(),
    knownCount: known.size,
    newCount: list.length,
    searchReport: report,
    candidates: list,
  };
  fs.writeFileSync(path.join(__dirname, 'candidates.json'), JSON.stringify(out, null, 2), 'utf8');
  console.error(`\n신규 후보 ${list.length}건 → candidates.json 저장 완료`);
})();
