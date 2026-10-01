# 엘리베이터 속도 측정 PWA

고정한 휴대폰의 가속도 센서로 단일 운행의 속도와 이동거리를 추정하는 현장 참고용 앱입니다.

사용 방법, 변경 사항, 정확도의 한계와 검증 절차는 [ACCURACY.md](ACCURACY.md)를 확인하세요.

별도 빌드 없이 정적 HTTPS 호스팅에서 실행합니다. `measurement.js`도 HTML과 함께 배포해야 합니다.

검증: `node --test measurement.test.cjs sw.test.cjs`
