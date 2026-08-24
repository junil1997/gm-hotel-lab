# 주간 자동 수집 절차

## 역할 분담 (2026-08-24 개편)

한국 채용사이트가 클라우드 IP를 403으로 차단하기 때문에, **웹 접근이 되는 GitHub Actions가
수집과 상세조회까지 끝내고**, AI 에이전트는 **판단(선별)과 반영만** 담당한다.

| 단계 | 실행 주체 | 시각(KST) | 결과 |
|---|---|---|---|
| 1. 수집 + 상세조회 | GitHub Actions (`.github/workflows/collect.yml`) | 매주 금 15:00 | `candidates.json` 커밋 |
| 2. 선별 + 반영 + 배포 | Claude 루틴 | 매주 금 17:00 | `index.html` 갱신 후 푸시 |

Actions는 `collect.js`(목록 수집) → `enrich.js`(공고별 회사명·급여·근무지 조회) 순으로 돈다.
**에이전트는 웹에 접속할 필요가 없다** — `candidates.json` 안에 판단에 필요한 정보가 이미 들어있다.

## candidates.json 구조

```json
{
  "collectedAt": "...", "enrichedAt": "...",
  "knownCount": 157, "newCount": 42,
  "searchReport": ["고용24 \"룸메이드\" → 조회 44 / 신규 22", ...],
  "candidates": [
    { "id": "...", "url": "공고 원문 URL", "site": "고용24", "kw": "룸메이드",
      "ctx": "목록에서 긁은 주변 텍스트",
      "detail": { "corp": "회사명", "name": "공고제목", "pay": "월급 240만원",
                  "loc": "부산광역시 ...", "reg": "2026-08-21" } }
  ]
}
```

## 선별 기준

**포함**: 부산 지역 호텔·리조트·레지던스의 객실/시설 관련 공고
**직종 키워드**: 룸메이드 · 하우스맨 · 하우스키핑 · 인스펙터 · 센터장 · 소장 · 시설 · 미화 · 영선
**제외**: 부산 외 지역(거제·김해공항 등) · 호텔 무관 업종(사무직·공장·병원·콜센터·골프장) · 2025년 이하 공고

`detail.loc`에 "부산광역시"가 있으면 부산 확정. `detail.corp`가 비어 있으면 `ctx`에서 회사명을 찾고,
그래도 없으면 그 건은 건너뛴다(추측 금지).

## index.html 반영

`JOBS` 배열 **끝에** 추가한다. 기존 항목은 절대 삭제하지 않는다(누적 방식).

```js
{ d:'26/08/24', gu:'해운대구', hotel:'호텔명', corp:'업체명', op:'도급'|'직영',
  job:'룸메이드'|'하우스맨'|'인스펙터'|'하우스키핑 관리자'|'시설'|'미화'|'영선',
  pay:'월 250만원', wf:'복리후생', etc:'특이사항', src:'고용24', u:'공고 원문 URL' },
```

- 사람인 공고는 `u` 대신 `id:54123456` 사용 가능(URL 자동 생성)
- 지엠네트웍스 자사 공고는 `gm:true` 추가
- `op` 판정: 호텔명과 회사명이 같으면 직영, 다르면 도급
- 공고에 없는 정보는 `'—'` (추측 금지)
- 고용24 URL은 반드시 `?wantedAuthNo=XXX&infoTypeCd=VALIDATION&infoTypeGroup=tb_workinfoworknet` 형식

## 버전 올리기

`index.html`의 `ver.NN`을 헤더 `<small>`과 `<footer>` **두 곳 모두** `ver.(NN+1)`로 바꾸고,
푸터 날짜도 오늘로 갱신한다.

## 검증

```bash
node -e "const fs=require('fs'),vm=require('vm');const h=fs.readFileSync('index.html','utf8');const s=h.match(/<script>([\s\S]*?)<\/script>/)[1];const els={};const mk=i=>els[i]||(els[i]={id:i,innerHTML:'',textContent:'',value:'',dataset:{},classList:{toggle(){}},scrollIntoView(){}});const c={document:{getElementById:mk,querySelectorAll:()=>[],querySelector:()=>({})},console};vm.createContext(c);vm.runInContext(s,c);console.log('OK',els['jobCnt'].textContent)"
```
오류 없이 건수가 출력되면 정상.

## 배포

```bash
git add index.html && git commit -m "주간 수집 ver.NN: 신규 N건" && git push
```
푸시되면 https://junil1997.github.io/gm-hotel-lab/ 에 1~2분 내 반영된다.
**푸시 권한이 없어 실패하면 중단하지 말고, 추가하려던 JOBS 항목 코드 전체를 응답에 출력**한다.
