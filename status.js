#!/usr/bin/env node
/**
 * 구인공고 마감 여부 확인기 — index.html 의 JOBS 공고 원문을 하나씩 열어 마감/진행 상태를 판정한다.
 *
 * 사용법:  node status.js          → data/job_status.json 갱신
 *
 * 판정 근거 (2026-09-28 사이트별 실측):
 *   사람인  : 페이지 meta "마감일:YYYY-MM-DD" (채용시 마감이면 상시)
 *   고용24  : "마감된 채용정보입니다" → 마감 / "접수 마감일 YYYY.MM.DD" → 날짜 비교
 *   잡코리아: JSON-LD validThrough
 *   알바몬  : 내부 응답 코드 RCRV006("마감된 공고입니다") → 마감
 *   알바천국: 삭제 시 수백 바이트 안내 페이지 / JSON-LD validThrough
 * 날짜를 못 읽은 공고는 '확인불가'로 두고 추측하지 않는다.
 */
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const OUT = path.join(__dirname, 'data', 'job_status.json');
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);   // KST

function loadJobs(){
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const L = html.split('\n');
  const i0 = L.findIndex(x => x.trim().startsWith('const JOBS = ['));
  let i1 = i0; while (L[i1].trim() !== '];') i1++;
  const J = eval(L.slice(i0, i1 + 1).join('\n').replace(/const JOBS = /, ''));
  return J.map(j => ({ src: j.src, url: j.u || ('https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=' + j.id) }));
}

const byDate = dl => ({ st: dl < TODAY ? '마감' : '진행', dl });
const norm = s => s.replace(/\./g, '-').slice(0, 10);

/* 스크립트·태그를 걷어낸 본문 텍스트 — 고용24는 스크립트 안에 "채용시까지" 문구가 늘 있어 원문 그대로 매칭하면 오판 */
const text = b => b.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

function judge(src, body, code){
  if (code === 404) return { st: '마감', why: '페이지 없음' };
  let m;
  /* 사람인 채용공고는 고용24 출처로 등재된 것도 있어 URL 도메인 기준으로 판정 */
  if (src === '사람인') {
    if ((m = body.match(/마감일:(\d{4}-\d{2}-\d{2})/))) return byDate(m[1]);
    if (/마감일:(상시채용|채용시)|채용시 마감/.test(body)) return { st: '상시' };
  } else if (src === '고용24') {
    if (body.length < 5000 && /마감된 채용정보입니다/.test(body)) return { st: '마감' };
    if (body.length < 5000 && /상세 내역이 없습니다/.test(body)) return { st: '마감', why: '공고 삭제' };
    const t = text(body);
    if ((m = t.match(/접수 마감일 (\d{4}\.\d{2}\.\d{2})/))) return byDate(norm(m[1]));
    if (/접수 마감일 채용시까지/.test(t)) return { st: '상시' };
  } else if (src === '잡코리아') {
    if ((m = body.match(/validThrough"\s*:\s*"(\d{4}-\d{2}-\d{2})/))) return byDate(m[1]);
    if ((m = body.match(/마감일\s*:\s*(\d{4}\.\d{2}\.\d{2})/))) return byDate(norm(m[1]));
    if (/상시채용|채용시 마감/.test(body)) return { st: '상시' };
  } else if (src === '알바몬') {
    if (/RCRV006/.test(body)) return { st: '마감' };
    if (/RCRV005/.test(body)) return { st: '마감', why: '공고 삭제' };
    if ((m = body.match(/(?:recruitEndDate|closingDate|endDate)\\?"\s*:\s*\\?"(\d{4}-\d{2}-\d{2})/i))) return byDate(m[1]);
    if (/상시모집/.test(body)) return { st: '상시' };
  } else if (src === '알바천국') {
    if (body.length < 2000 && /마감된 공고/.test(body)) return { st: '마감' };
    if ((m = body.match(/validThrough"\s*:\s*"(\d{4}-\d{2}-\d{2})/))) return byDate(m[1]);
    if (/상시모집/.test(body)) return { st: '상시' };
  }
  return { st: '확인불가' };
}

async function check(job){
  for (let t = 0; t < 2; t++) {
    try {
      const r = await fetch(job.url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko' }, redirect: 'follow',
                                       signal: AbortSignal.timeout(25000) });
      const body = await r.text();
      /* 출처 표기가 아니라 실제 URL 도메인으로 판정 (고용24 출처인데 사람인 URL인 공고가 있음) */
      const site = /saramin/.test(job.url) ? '사람인' : /work24/.test(job.url) ? '고용24' : /jobkorea/.test(job.url) ? '잡코리아'
                 : /albamon/.test(job.url) ? '알바몬' : /alba\.co\.kr/.test(job.url) ? '알바천국' : job.src;
      return judge(site, body, r.status);
    } catch (e) { if (t) return { st: '확인불가', why: String(e.message || e).slice(0, 60) }; }
  }
}

(async () => {
  const jobs = loadJobs();
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')).s || {} : {};
  const s = {};
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const j = jobs[i++];
      /* 이미 마감 확정된 공고는 다시 열지 않음(마감은 되돌아가지 않음) */
      if (prev[j.url] && prev[j.url].st === '마감') { s[j.url] = prev[j.url]; continue; }
      const r = await check(j);
      /* 이번에 확인불가인데 전에 날짜를 알았으면 그 날짜로 재판정 */
      s[j.url] = (r.st === '확인불가' && prev[j.url] && prev[j.url].dl) ? { ...byDate(prev[j.url].dl), stale: 1 } : r;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ at: TODAY, s }, null, 0));
  const c = {}; Object.values(s).forEach(v => c[v.st] = (c[v.st] || 0) + 1);
  console.log('확인일', TODAY, '| 공고', jobs.length, '|', JSON.stringify(c));
})();
