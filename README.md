# 트릭컬 빙고 시뮬레이터

7×7 빙고판에 세로줄, 가로줄, 십자, X자, 네모를 배치하는 정적 웹앱입니다.
패턴 보관과 교환, 최근 배치 강조, 사용 재화 누적, 되돌리기, 되돌릴 수 있는 초기화를 포함합니다.

별도 빌드나 의존성 설치 없이 GitHub Pages에 배포할 수 있습니다.

## GitHub Pages 배포

1. ZIP을 풀고 `trickcal-bingo` 폴더 안의 파일과 폴더를 GitHub 저장소의 최상위에 올립니다. 저장소 최상위에서 `index.html`이 보여야 합니다. ZIP 자체를 올리는 방식은 아닙니다.
2. 저장소의 **Settings → Pages**를 엽니다.
3. **Build and deployment → Source**에서 **Deploy from a branch**를 선택합니다.
4. 파일을 올린 브랜치(예: `main`)와 **/(root)**를 선택하고 **Save**를 누릅니다.
5. 배포가 끝나면 Pages 화면에 표시된 웹사이트 주소로 접속합니다.

루트의 `.nojekyll` 파일도 함께 올려 주세요. 모든 앱 파일의 경로는 상대 경로로 되어 있어 프로젝트 저장소의 하위 주소에서도 사용할 수 있습니다.

설정 안내: [GitHub 공식 문서](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## 파일 구성

| 파일 | 역할 |
| --- | --- |
| `index.html` | 웹앱 화면 |
| `style.css` | PC·모바일 화면 스타일 |
| `app.js` | 입력, 화면 갱신, 보관함, 되돌리기, 초기화 |
| `solver.js` | 패턴 배치 알고리즘 |
| `planner.worker.js` | 백그라운드 배치 계산 |
| `favicon.svg` | 사이트 아이콘 |
| `.nojekyll` | GitHub Pages 정적 파일 배포 설정 |
| `package.json` | Node.js 모듈 설정과 검증 명령 |
| `scripts/verify.mjs` | 기능 및 화면 갱신 검증 |
| `scripts/validation/` | 알고리즘 비교 코드와 실험 결과 |

JavaScript는 브라우저의 ES 모듈을 사용합니다. `package.json`은 검증 코드를 위한 설정이며, 웹사이트 실행에 npm 설치나 빌드가 필요하지 않습니다.

## 로컬 실행

Python 3이 설치되어 있다면 프로젝트 폴더에서 다음을 실행합니다.

```sh
python -m http.server 8000
```

브라우저에서 `http://localhost:8000/`을 엽니다. 환경에 따라 명령은 `python3`을 사용하면 됩니다. 파일을 더블클릭하는 대신 로컬 서버를 통해 실행해 주세요.

## 기능 검증

Node.js가 설치되어 있다면 프로젝트 폴더에서 실행합니다.

```sh
node scripts/verify.mjs
```

또는 `npm test`로 실행할 수 있습니다. 검증에는 패턴별 모든 기준 칸, 꼭짓점 배치, 보관·교환, 사용 재화, 되돌리기, 초기화 복원, 계산 취소, 완료·건너뛰기와 불필요한 화면 갱신 방지가 포함됩니다.

알고리즘의 통계 검증은 `scripts/validation/README.md`를 참고하세요. 해당 실험을 다시 실행할 때만 Python의 NumPy와 SciPy가 필요합니다. 웹앱 배포에는 필요하지 않습니다.

## 규칙과 초기화

- 패턴의 중앙 기준 칸을 빙고판의 어느 칸에나 놓을 수 있으며, 판 밖의 부분은 잘립니다.
- 빙고판에 배치할 때마다 재화 200개가 누적됩니다. 보관은 무료이고 보관함에서 꺼내 배치하면 200개가 추가됩니다.
- **초기화**는 빙고판·보관함·사용 재화를 비웁니다. **되돌리기**로 초기화 직전 상태를 복원할 수 있으며 이전 입력 기록도 유지됩니다.
- 완성 후 **건너뛰기**는 새 판으로 시작하면서 되돌리기 기록까지 비웁니다.

내보낸 날짜: 2026-10-02. 원본 웹앱과 같은 알고리즘과 기능을 포함하며, 배포용 파일 배치와 JavaScript 확장자·경로를 GitHub Pages에 맞게 정리했습니다.
