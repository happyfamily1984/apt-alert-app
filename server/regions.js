// 시군구 법정동코드 앞 5자리 (국토교통부 실거래가 API의 LAWD_CD)
// 행정구역 개편 시 shared/regions.json 만 수정하면 됩니다.
// 참고: 강원특별자치도(2023.6, 42→51), 전북특별자치도(2024.1, 45→52), 군위군 대구 편입(2023.7),
//       부천시 일반구 설치(2024.1). 2026년 인천(제물포·영종·검단구), 화성시 일반구 신설은
//       국토부 API 반영 코드를 확인한 뒤 추가하세요.

import fs from 'node:fs';

// 서버와 안드로이드 앱이 같은 파일(shared/regions.json)을 사용합니다.
export const REGIONS = JSON.parse(fs.readFileSync(new URL('../shared/regions.json', import.meta.url), 'utf8'));

const byCode = new Map();
for (const { sido, sigungu } of REGIONS) {
  for (const s of sigungu) byCode.set(s.code, { ...s, sido, fullName: `${sido} ${s.name}` });
}

export function getRegion(code) {
  return byCode.get(String(code)) || null;
}
