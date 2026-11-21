# 하루가계부

월급에서 고정지출을 빼고, 남은 돈을 그 달 일수로 나눠 하루 단위로 쓰는 모바일 웹앱.

## 계산 규칙
- 하루 기본 금액 = (월급 − 고정지출) ÷ 그 달 일수, 원 단위 내림
- 그날 남은 돈(파란색) = 가용 금액 − 사용 금액(빨간색) → 다음 날 가용 금액에 더해짐
- 초과 지출(마이너스)도 다음 날로 이월되어 빠짐
- 월말 잔액은 다음 달 1일로 이월
- 한 달 = 1일 ~ 말일
- 월 중간에 설정을 바꾸면: (새 남는 금액 − 이미 배정된 금액) ÷ 남은 일수 로 오늘부터 재배정
- 처음 설정한 날 이전 날짜는 예산 계산에서 제외

## 로컬에서 실행
```bash
python3 -m http.server 8000
```
브라우저에서 http://localhost:8000 접속. `firebase-config.js`가 비어 있으면 체험 모드(이 기기에만 저장)로 동작합니다.

## 로그인/동기화 켜기 (Firebase, 무료 요금제로 충분)
1. https://console.firebase.google.com 에서 프로젝트 생성
2. **Authentication → 로그인 방법**에서 `이메일/비밀번호`, `Google` 사용 설정
3. **Firestore Database** 생성 → 규칙 탭에 `firestore.rules` 내용 붙여넣고 게시
4. **프로젝트 설정 → 내 앱 → 웹 앱 추가** 후 나오는 설정값을 `firebase-config.js`에 붙여넣기
5. 배포: `npm i -g firebase-tools` → `firebase login` → `firebase init hosting`(public 폴더 = 이 폴더) → `firebase deploy`
6. 배포한 도메인을 Authentication → 설정 → 승인된 도메인에 추가 (firebase 기본 도메인은 자동)

한 번 로그인하면 브라우저에 로그인 상태가 유지되어 다음부터 자동 로그인됩니다.
휴대폰에서 "홈 화면에 추가"하면 앱처럼 쓸 수 있어요.

## 테스트
```bash
node logic.test.mjs
```
