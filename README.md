# 🏠 아파트 실거래 알리미

시군구 → 아파트 단지 → **매매 / 전세 / 월세**를 고르면,
**최근 한 달 실거래**를 바로 받아보고 **앞으로 새로 신고되는 실거래**를 푸시 알림으로 받는 웹앱(PWA)입니다.

데이터: 국토교통부 실거래가 OpenAPI (공공데이터포털)

## 📱 안드로이드 앱 (PC·서버 없이 사용)

- **APK 다운로드**: [`release/apt-alert-1.2.1.apk`](release/apt-alert-1.2.1.apk) (또는 Releases)
- **설치·API 키·알림 설정 안내**: [docs/사용설명서.md](docs/사용설명서.md)
- **중계 서버 배포 (API 키 하나로 여러 명 사용)**: [docs/중계서버-배포.md](docs/중계서버-배포.md) — Cloudflare Worker(`worker/worker.js`), 무료
- 데이터 경로: 개인 API 키가 있으면 국토부 직접 호출, 없으면 중계 서버 경유. 새 거래 확인은 각 휴대폰이 WorkManager로 백그라운드에서 하고 알림을 띄웁니다.
- 소스: `android/` (Kotlin, WebView에 `public/` 웹 UI를 그대로 탑재)
- 빌드: `cd android && ./gradlew assembleRelease` 또는 GitHub Actions(`.github/workflows/android.yml`)

## 🌐 웹 버전 (서버 배포용, 아이폰 등)

## 화면 흐름

1. **단지 찾기** – 시·도 → 시·군·구 선택 (최근 본 지역 기억)
2. **단지 목록** – 최근 6개월 거래가 있는 단지, 검색, 최근 매매가·유형별 거래 건수
3. **단지 상세** – 매매/전세/월세 탭, 면적 필터, 최근 1개월 통계(건수·평균·최고·최저), 추이 그래프, 실거래 내역(해제·직거래·신규/갱신 표시)
   - **🔔 알림 받기** → 최근 한 달 실거래를 즉시 알림으로 받고, 이후 새로 신고된 거래와 **거래 해제**도 알림
4. **내 알림** – 구독 목록·해제, 알림함, 푸시 켜기/테스트

## 빠른 시작

```bash
npm install
cp .env.example .env      # MOLIT_SERVICE_KEY 입력 (비우면 데모 모드)
npm start                 # http://localhost:3000
npm test
```

**데모 모드**(키 없음)에서는 실제 API 응답과 같은 형태의 가짜 데이터로 동작합니다.
"내 알림" 화면의 `🧪 데모: 새 실거래 발생시키기` 버튼으로 신규 거래 알림을 바로 체험할 수 있습니다.

### 실제 데이터 사용
1. [공공데이터포털](https://www.data.go.kr)에서 아래 두 API를 **활용신청**
   - 국토교통부_아파트 매매 실거래가 자료 (`RTMSDataSvcAptTrade`)
   - 국토교통부_아파트 전월세 실거래가 자료 (`RTMSDataSvcAptRent`)
2. 발급된 인증키를 `.env`의 `MOLIT_SERVICE_KEY`에 입력 (Encoding/Decoding 키 모두 가능)
3. 개발계정 일일 트래픽은 API별 10,000건입니다. 단지 목록 최초 조회 시 지역당 약 12회 호출하며 결과는 캐시됩니다.

## 알림 동작 방식

- 실거래는 **계약 후 30일 이내** 신고되므로, 서버가 `POLL_INTERVAL_MINUTES`마다 구독 중인 지역의 **이번 달 + 지난달** 데이터를 다시 조회합니다.
- 처음 보는 거래 = 새 신고 → 해당 단지·유형 구독자에게 알림. 기존 거래가 해제(`cdealType=O`)로 바뀌면 해제 알림.
- 같은 지역·유형 구독은 한 번의 API 호출로 묶어 처리합니다.
- 알림은 **Web Push**(브라우저/안드로이드, iPhone은 *홈 화면에 추가* 후)와 **앱 내 알림함** 두 곳으로 전달됩니다.
- 로그인 없이 기기별 익명 ID(localStorage)로 구독을 구분합니다.

> Web Push는 HTTPS(또는 localhost)에서만 동작합니다. 휴대폰에서 쓰려면 HTTPS로 배포하세요 (Render, Fly.io, Railway, 집 서버 + Cloudflare Tunnel 등). 서버가 계속 켜져 있어야 주기 확인이 됩니다.

## 구조

```
server/
  index.js     Express 서버, REST API, 폴링 스케줄러
  molit.js     국토부 API 호출·XML 파싱·정규화·캐시
  demo.js      데모 데이터 생성기
  service.js   단지 목록 집계, 거래 조회, 통계
  alerts.js    구독, 신규/해제 거래 감지, 알림 생성
  push.js      Web Push(VAPID)
  store.js     JSON 파일 저장소 (data/db.json)
  regions.js   시군구 코드 로더 (shared/regions.json)
shared/        시군구 코드 목록 (서버·앱 공용)
worker/        중계 서버 (Cloudflare Worker: API 키 보관 + 캐시)
android/       안드로이드 앱 (Kotlin: 국토부 API·알림·백그라운드 확인 / WebView UI)
public/        PWA 프런트엔드 (index.html, app.js, style.css, sw.js)
test/          node:test 단위 테스트 (+ 실제 응답 형태 XML 픽스처)
```

### API
| Method | Path | 설명 |
|---|---|---|
| GET | `/api/regions` | 시도·시군구 목록 |
| GET | `/api/regions/:lawd/complexes` | 시군구 단지 목록 |
| GET | `/api/complexes/:lawd/:id/deals?type=trade\|jeonse\|monthly&months=6` | 거래 내역 + 통계 |
| GET/POST/DELETE | `/api/subscriptions` | 알림 구독 (헤더 `X-User-Id`) |
| GET | `/api/notifications` | 알림함 |
| POST | `/api/push/subscribe` | 푸시 구독 등록 |
| POST | `/api/admin/poll` | 즉시 확인 실행 (데모: `?inject=1`) |

## 참고 / 한계
- 단지 식별은 `시군구 + 법정동 + 지번 + 단지명`(공백 제거) 기준입니다. 최근 N개월 거래가 없는 단지는 목록에 나오지 않습니다.
- 행정구역 개편(2026 인천 제물포·영종·검단구, 화성시 일반구 등)은 국토부 API 반영 코드를 확인해 `shared/regions.json`에 추가하세요.
- 저장소는 JSON 파일이라 소규모(개인/가족) 용도입니다. 사용자가 많아지면 DB로 교체하세요.
