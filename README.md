# RECON CONSOLE

**제품명:** RECON CONSOLE  
**현 개발 프로젝트:** BASELINE

RECON CONSOLE의 독립 개발 저장소. 기존 `tactical-recon` 저장소는 변경하지 않고 보존한다.

## 실행

- GitHub Pages: https://chunbaefatherjunbae.github.io/recon-console/
- 직접 진입: https://chunbaefatherjunbae.github.io/recon-console/baseline/
- 정적 사이트 본체: `baseline/`
- 로컬 실행: `python3 -m http.server 8000` 후 `http://localhost:8000/baseline/`

`baseline/sw.js`는 `/recon-console/baseline/` 범위만 관리한다. 지도 라이브러리는 `vendor/`에 있고, 기존 아이콘은 `icons/`에 임시로 보관한다. 아이콘은 이후 새 디자인으로 교체한다.

## 검증

`node scripts/verify-deployment.cjs`로 필수 리소스와 설치 매니페스트를 검사한다.
`scripts/test-baseline-browser.cjs`는 Playwright 브라우저 회귀검사이다.
