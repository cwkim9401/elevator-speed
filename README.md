# 엘리베이터 속도 · 승차감 측정 PWA

고정한 휴대폰의 가속도 센서로 단일 운행의 속도와 이동거리를 추정하는 현장 참고용 앱입니다.

사용 방법, 변경 사항, 정확도의 한계와 검증 절차는 [ACCURACY.md](ACCURACY.md)를 확인하세요.

한 번의 측정으로 속도·승차감·상대 소음을 함께 기록합니다. 측정 중에는 3축 진동 그래프를 표시하며, 종료 후 속도와 X/Y/Z 진동 RMS, 상대 소음(dBFS)을 표시합니다. 승차감 모드의 실험용 ESV 내보내기와 저장 폴더 설정은 [RIDE-ESV.md](RIDE-ESV.md)를 확인하세요.

별도 빌드 없이 정적 HTTPS 호스팅에서 실행합니다. 아래 파일을 같은 폴더에 함께 배포하세요.

- `index.html`, `measurement.js`, `ride-core.js`, `ride.js`
- `esv-header.js`, `sound-worklet.js`, `sw.js`
- `manifest.webmanifest`, `icon-192.png`, `icon-512.png`

오프라인 캐시 v37. 로컬 수정만으로 기존 휴대폰 앱이 바뀌지는 않습니다. 기존 호스팅에 위 파일을 함께 업데이트하고 온라인에서 앱을 열었다 닫고 다시 실행하세요.

검증: `node --test measurement.test.cjs sw.test.cjs ride.test.cjs`

실제 Web Audio와 가상 센서를 이용한 모바일 화면 통합 검사: `node --test ride.browser.test.cjs` (이 PC의 번들 Playwright 및 Chrome 경로 사용).
