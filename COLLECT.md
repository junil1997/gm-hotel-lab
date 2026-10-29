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
{ d:'26/08/24', c:'26/08/28', gu:'해운대구', hotel:'호텔명', corp:'업체명', op:'도급'|'직영',
  job:'룸메이드'|'하우스맨'|'인스펙터'|'하우스키핑 관리자'|'시설'|'미화'|'영선',
  pay:'월 250만원', wf:'복리후생', etc:'특이사항', src:'고용24', u:'공고 원문 URL' },
```

- `c` = **대시보드 반영일**(오늘, YY/MM/DD) — 반드시 넣는다. 시장조사 현황의 "업데이트일 기준" 필터와 헤더 수집일이 이 값으로 계산됨 (ver.70)
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

## 공고 마감 여부 확인 (ver.70 추가)

`node status.js` → 누적 공고 원문을 하나씩 열어 마감/진행/상시를 판정해 `data/job_status.json` 에 저장한다.
배포본 대시보드는 이 파일을 자동으로 불러와 모집 상태를 표시한다(index.html 수정 불필요).
Actions 워크플로에 `node status.js` 단계 + `git add data/job_status.json` 이 들어가 있으면 수집 때마다 자동 갱신.

## 등록일(d) 필수 — 비어 있으면 반영 전에 보완 (ver.76 추가)

`d`(공고 등록일)를 `'—'`로 두면 시장조사 월별 매트릭스에서 '미상' 칸으로 빠져 해당 월이 비어 보인다.
2026-10-02 반영분 69건 중 55건이 등록일 없이 들어가 10월 칸이 비어 보이는 문제가 실제로 발생했다.
- `detail.reg`가 있으면 그 날짜를 `d`에 넣는다.
- 없으면 JOBS에 추가한 뒤 **커밋 전에 `node backfill_dates.js` 실행** — 원문에서 등록일을 찾아 채우고 `dfix:1` 표시.
- 원문에서도 못 찾으면(삭제된 공고 등) `'—'` 그대로 둔다(추측 금지).

## 중복 재등록 금지 (ver.76 추가)

2026-10-02 반영 때 이미 JOBS에 있는 공고 26건이 같은 URL로 다시 추가되어 누적 건수가 부풀었다(435→실제 409).
candidates.json의 `newCount`는 '수집기가 처음 본 공고'라 JOBS와 겹칠 수 있다 — **추가 전 반드시 URL(사람인은 rec_idx)로 JOBS와 대조**하고,
같은 URL이 있으면 추가하지 않는다. 한 공고가 여러 직종을 뽑아도 행은 1개(기존 관례).

## 근무지·등록일 수집 보강 (2026-10-24)

- enrich.js가 고용24 외 4개 사이트의 `detail.loc`(근무지)·`detail.reg`(등록일)를 비워 두던 문제를 고쳤다
  (사람인=모바일 상세의 '근무지위치'·'시작일', 잡코리아=근무지주소·datePosted, 알바몬·알바천국=JSON-LD 주소·datePosted).
- 근무지는 사이트에 따라 **"부산 동구 …"처럼 '부산광역시'가 아닌 '부산'으로 시작**한다 → 부산 판정은 `loc`이 "부산"으로 시작하는지로 한다.
- 등록일 보완(`backfill_dates.js`)은 채용사이트에 접속 가능한 **GitHub Actions에서 수집 때마다 자동 실행**된다(index.html 커밋 포함).
  클라우드 루틴은 `detail.reg`를 `d`에 넣기만 하면 되고, 비어 있으면 '—'로 두면 다음 수집 때 채워진다.

## 호텔 프런트 공고 (2026-10-29 추가)

- 수집기(collect.js)가 프런트 검색어(호텔 프론트·프런트·리셉션·나이트 오디터)로 찾은 후보에는 **`cat: "front"`** 가 붙는다.
- **`cat: "front"` 후보는 JOBS 가 아니라 `FRONTS` 배열 끝에 추가**한다(JOBS 바로 아래). 형식은 JOBS와 같고 `job`은
  `'프런트'` | `'야간 프런트'`(야간·나이트·당직) | `'프런트 관리자'`(지배인·팀장·총괄·매니저 — 소규모 호텔·모텔의 '프론트 실장'은 일반 프런트 직원 호칭이라 관리자 아님) 중 하나.
- 선별: 부산 + **숙박시설(호텔·리조트·레지던스·모텔·료칸)의 프런트 데스크 직무**만. 병원·자동차 매장·웨딩홀 리셉션, 피트니스·사우나 안내, 예약실 전용 공고는 제외.
- `op`: 채용 회사가 호텔 자체(그 호텔 법인)면 `'직영'`, 운영대행·위탁운영·인력회사면 `'도급'`.
- `etc`: 근무형태 요약(주간·야간·주2일·아르바이트·정규직·신입/경력·일본어 등). `pay`는 공고 표기 그대로, 없으면 '—'.
- 중복: URL로 기존 FRONTS와 대조, 같은 호텔·같은 직무·등록일 3일 이내 다른 사이트 게시본은 1건만.
- 한 공고가 하우스키핑과 프런트를 같이 뽑으면(통합 채용) JOBS·FRONTS 양쪽에 각각 넣어도 된다.
- 마감 확인(status.js)·등록일 보완(backfill_dates.js)은 FRONTS 도 자동 처리.
