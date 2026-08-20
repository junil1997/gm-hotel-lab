# 주간 자동 수집 절차 (매주 금요일 17:00 KST)

## 1. 수집 실행
```bash
node collect.js
```
- 5개 사이트(고용24·사람인·잡코리아·알바몬·알바천국) × 19개 검색을 순회
- `index.html` 안의 기존 공고번호와 대조해 **신규만** `candidates.json`으로 출력
- 고용24·사람인은 URL에 부산 지역필터 적용, 나머지는 본문에서 부산 여부 확인

## 2. 후보 정리 (판단 필요 — 자동화하지 않음)
`candidates.json`의 각 후보를 보고 **실제 부산 호텔 관련 공고만** 선별한다.
- 호텔·리조트·레지던스와 무관한 공고(사무직, 공장, 병원 등)는 제외
- `ctx` 필드에 회사명·공고명·급여·등록일이 들어있음. 불명확하면 `url`을 직접 열어 확인
- **업체명이 확인되지 않으면 "미확인"으로 쓰지 말고 공고 상세페이지를 열어 확인할 것**

## 3. index.html 반영
`JOBS` 배열 **끝에** 아래 형식으로 추가한다. 기존 항목은 절대 삭제하지 않는다(누적 방식).

```js
{ d:'26/08/20', gu:'해운대구', hotel:'호텔명', corp:'업체명', op:'도급'|'직영',
  job:'룸메이드'|'하우스맨'|'인스펙터'|'하우스키핑 관리자'|'시설',
  pay:'월 250만원', wf:'복리후생', etc:'특이사항', src:'고용24', u:'공고 원문 URL' },
```
- 사람인 공고는 `u` 대신 `id:54123456` 사용 가능(URL 자동 생성됨)
- 지엠네트웍스 자사 공고는 `gm:true` 추가
- 공고에 없는 정보는 `'—'`로 표기 (추측 금지)

## 4. 검증
```bash
node -e "const fs=require('fs'),vm=require('vm');const h=fs.readFileSync('index.html','utf8');const s=h.match(/<script>([\s\S]*?)<\/script>/)[1];const els={};const mk=i=>els[i]||(els[i]={id:i,innerHTML:'',textContent:'',value:'',classList:{toggle(){}}});const c={document:{getElementById:mk,querySelectorAll:()=>[],querySelector:()=>({})},console};vm.createContext(c);vm.runInContext(s,c);console.log('OK',els['jobCnt'].textContent)"
```
오류 없이 건수가 출력되면 정상.

## 5. 배포
```bash
git add index.html && git commit -m "주간 수집: 신규 N건" && git push
```
푸시되면 https://junil1997.github.io/gm-hotel-lab/ 에 1~2분 내 자동 반영된다.

## 데이터 원칙
- 부산 지역 한정 / 당해연도 공고만 / 전 건 원문 URL 필수 / 거짓 작성 금지 / 신규만 누적
