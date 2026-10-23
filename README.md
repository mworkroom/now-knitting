# Now Knitting

Notion의 Knitting Projects와 Daily Log를 사용하는 개인 뜨개 시간 기록 PWA. Timer와 Projects 두 탭에서 프로젝트를 선택하고 같은 버튼으로 START/END를 기록한다.

## 실행

Node.js 22.12+ 또는 24+와 npm이 필요하다.

```powershell
npm ci
npm run dev:demo
```

데모는 `http://127.0.0.1:5173`에서 실행된다. 샘플 데이터만 사용하고 Notion을 수정하지 않는다. 새로고침하면 데모 상태가 초기화된다. 운영 빌드는 데모 코드를 활성화하지 않는다.

```powershell
npm run dev
```

실제 앱과 Worker는 `http://127.0.0.1:8787`에서 실행된다. 로컬 Notion 연결을 시험할 경우에만 `.dev.vars`에 `NOTION_TOKEN`을 등록한다. 파일은 Git에서 제외된다. J님은 운영 Worker secret에 직접 등록하는 방식을 선택했으므로 로컬 토큰 등록은 필요하지 않다.

## 검증

```powershell
npm run check
```

Wrangler 타입 생성, TypeScript/Vite 빌드, Cloudflare 런타임 테스트, 배포 없는 Worker 번들 검사를 수행한다. `worker-configuration.d.ts`는 빌드 때 생성되며 저장소에 넣지 않는다.

## 앱 아이콘 교체

`public/icon-512.png`가 브라우저 탭·Android 설치·iPhone/iPad 홈 화면 아이콘의 공통 이미지다. 새 **512×512 PNG**를 같은 이름으로 덮어쓴다. `index.html`과 `public/manifest.webmanifest`의 아이콘 URL 및 manifest URL에 붙은 `?v=...` 값을 새 날짜·번호로 함께 바꾼 뒤 배포한다. 기존 `icon.svg`, `icon-192.png`, `apple-touch-icon.png`는 현재 앱에서 참조하지 않는다.

로컬 파일 교체만으로 운영 앱이 바뀌지는 않는다. GitHub의 `main`에 커밋·푸시하면 기존 Cloudflare Worker의 Workers Builds가 빌드·배포한다. 수동 배포가 필요한 경우에만 프로젝트 터미널에서 최초 1회 `npx wrangler login`, 이후 `npm run deploy`를 실행한다. 설치된 홈 화면 앱에 이전 아이콘이 남으면 해당 기기에서 제거 후 새로 추가한다.

## 연결·배포

[연결 및 배포 안내](docs/setup.md)를 따른다. **빈 Worker에 전용 Access를 먼저 적용하고 비로그인 차단을 확인한 뒤** Notion secret과 실제 앱을 연결한다. 앱 코드만 배포하면 Access 정책이 자동 생성되지 않는다.

운영 앱은 [now-knitting.mworkroom.workers.dev](https://now-knitting.mworkroom.workers.dev/)에 배포됐다. 전용 Access는 J님의 등록 이메일 한 개만 허용한다. J님이 Worker `NOTION_TOKEN` secret을 등록했다. 새 환경에서는 아래 연결 안내에 따라 secret과 데이터베이스 접근 권한을 설정한다.

2026-10-05 배포 버전 `c2687e9a-9c0c-4fa6-be53-c0a04b184669`에서 왼쪽 프로젝트 선택 영역·카드 본문 상세 진입·조건 뱃지/복합 필터·조건 속성 ID 연결·Preview 바로가기를 반영했다. 내부 PDF 화면은 비활성으로 분리했으며 기존 표시 API·저장 데이터는 유지한다. 한국시간 저장·종료 직후 링크·프로젝트 본문 종료 기록도 유지한다.

2026-10-24: 현재 앱 전체를 GitHub에 최초 업로드하고 커밋 `0f6ec19`의 Cloudflare 자동 빌드·배포 성공과 운영 트래픽 100% 적용을 확인했다(버전 `73b48362-3c5d-4bc1-ac5c-04250d3882ed`). 화면·API·정적 파일의 비로그인 Access 보호도 유지된다. 앱 동작 코드는 바꾸지 않았으며 로그인 후 실데이터 화면은 이번 작업에서 확인하지 못했다. 이후 버전은 Cloudflare Deployments에서 해당 GitHub 커밋으로 확인한다.

## 구현 범위

- Schedule view의 순서·페이지네이션을 사용하는 프로젝트 목록, 검색, 선택과 Notion 링크
- 선택을 임의로 만들지 않는 Timer, 단일 START/END, 현지 시작 시각 입력, Notion에서 세션 복원
- Start·End를 한국시간 `+09:00`으로 저장하고 END 성공 시 연결 프로젝트 본문 끝에 같은 시각의 날짜 멘션 블록 추가
- END 직후 마지막 세션 링크 표시; 프로젝트 본문 저장 미확인 시 Daily Log·프로젝트 확인 전 타이머 변경 잠금
- 다중 선택 복구, 다중 열린 로그 차단, 활성 세션 중 선택 잠금
- 요청 ID 재사용·동시 요청·연속 입력 방어, 실패한 toggle 자동 재시도 금지
- PWA manifest, iOS 설치 아이콘, 네트워크 전용 서비스 워커

숫자 Progress formula는 화면에서 퍼센트로 표시한다(`0.66` → `66%`). Timer는 Time Spent의 총 시간만 표시하고, Projects는 프로젝트명 → 진행률·단계 뱃지 → 기존 시간 상세 순서로 표시한다. 프로젝트 선택은 즉시 눌림 효과와 선택 중 표시를 보여주며, Notion 응답으로 저장이 확인된 뒤 선택 체크와 Timer를 갱신한다.

서버의 Durable Object는 타이머 요청 영수증·안전 잠금과 별도 패턴 표시 기록을 저장한다. 프로젝트·선택·세션의 원본은 Notion이며 응답 스냅샷을 서버에 저장하지 않는다. 같은 요청의 결과를 다시 반환할 때도 현재 상태는 Notion에서 새로 읽는다. 완료 영수증만 24시간 후 정리하며 패턴 표시에는 자동 만료를 두지 않는다. 불확실한 타이머 작업은 명시적 검토 전까지 잠근다. 브라우저에 선택·세션을 영속 저장하지 않는다.

## 프로젝트 상세·패턴

Timer의 `Project details`와 Projects 카드의 본문 영역에서 접근한다. 카드 왼쪽에는 폭 44px의 프로젝트 선택 영역을 공백 없이 붙인다. 선택되지 않은 프로젝트는 원, 선택된 프로젝트는 진한 그레이와 체크로 표시한다. 왼쪽을 누르면 저장 확인 후 Timer로 이동하고, 썸네일·제목·정보 영역을 누르면 상세를 연다. 선택 대기 중에는 기존 선택을 유지하면서 새 대상에 스피너와 `Selecting…`를 표시한다. 활성 세션 중에는 다른 프로젝트 선택만 잠그며 상세는 계속 열 수 있다. 목록 하단의 별도 아이콘 줄은 제거하고 Pattern·Notion 링크는 상세에서 제공한다.

상세에는 큰 프로젝트명과 바로 뒤의 Notion 링크를 한 번만 표시한다. 썸네일·단계·진행률·누적 시간은 요약 블록에 두고, `Cafe / Mindless / Summer` 상태 뱃지는 블록 밖에 표시한다. 가능은 그레이, 불가능은 화이트이며 미확인은 `—`로 구분한다. Row Checklist와 Yarn Usage는 자리만 마련했으며 아직 입력·계산 기능이 없다.

Notion 속성명은 `카뜨가능`(formula)·`역행용`(checkbox)·`여름불가`(checkbox)를 유지한다. 앱의 Cafe·Mindless는 각각 가능/체크 상태를 표시하고 Summer는 **여름불가 체크가 해제된 경우** 가능이다. checkbox·boolean formula와 명시적인 `Yes`/`No` 문자열 formula를 읽으며 다른 값은 미확인으로 남긴다.

운영 API는 최초 조회에서 세 조건의 속성 ID를 스키마로 확인해 COORDINATOR에 `condition-bindings:v1:<PROJECTS_SOURCE_ID>`로 저장한다. 연결 후에는 속성명이 바뀌어도 저장한 ID를 읽으며, 삭제된 ID를 같은 이름의 새 속성으로 자동 교체하지 않는다. 연결 이전에 이름을 바꾸거나 속성을 삭제·재생성하면 재연결 확인이 필요하다. 프로젝트 선택·시간 기록 등 나머지 속성은 기존 이름 기반 연결을 유지한다.

Projects 검색창 아래의 같은 세 뱃지는 앱 내부 필터다. 여러 조건은 AND로 적용하고 검색어도 함께 적용한다. 다시 누르면 해당 조건만 해제하며 결과가 없으면 `Clear filters`로 조건을 초기화할 수 있다. 미확인 조건은 활성 필터를 통과하지 않는다. 검색·필터는 상세 복귀와 탭 이동 시 유지하고 페이지 새로고침 시 초기화한다. 필터 클릭은 Notion을 수정하거나 API를 재조회하지 않는다. 2026-10-05 운영 버전에 반영했다.

Timer·프로젝트 상세의 Pattern은 모두 `shortcuts://run-shortcut?name=OpenPreview`를 연다. J님이 확인한 단축어 이름의 대소문자를 그대로 유지하며, 새 창 없이 직접 링크를 실행한다. Preview 앱이 열린 뒤 파일은 직접 선택한다. 프로젝트별 PDF를 자동으로 선택하는 링크는 아니다. 2026-10-05 운영 버전에 반영했다. 실제 홈 화면 PWA에서 버튼을 통한 앱 전환은 iOS 확인이 필요하다.

## 보관한 PDF annotation 모듈

기존 기능은 [선택적 PDF 모듈](src/features/pdf-annotations/README.md)로 분리했다. 현재 앱에서는 화면을 열거나 자동 동기화하지 않으며 기본 빌드에 PDF.js·PDF 보조 자산을 넣지 않는다. 아래 내용은 다시 활성화할 때의 기능 설명이다. IndexedDB와 서버 저장 API·데이터·의존성·계약 테스트는 유지하며 기존 표시는 삭제하지 않는다.

PDF는 Files/iCloud Drive에서 선택해 기기 IndexedDB에만 저장한다. 최대 64MB이며 서버로 업로드하지 않는다. PDF.js는 패턴 화면 진입 시 로드하고 worker·폰트·CMap·WASM도 같은 사이트에서 제공한다. View 모드에서는 스크롤하고 Highlight 모드에서는 숫자 위를 드래그해 직사각형으로 표시한다. Erase·Undo·페이지 이동·확대/축소를 지원한다.

표시는 프로젝트 ID + PDF 원본 바이트의 SHA-256을 기준으로 별도 저장한다. 파일명 변경은 허용하지만 PDF 내용이 바뀌면 다른 문서로 취급한다. 기기 사본을 제거하거나 브라우저 저장소가 정리돼도 원본 PDF를 다시 선택하면 Cloudflare에서 표시를 복원한다. 같은 PDF를 여러 프로젝트에 쓰면 표시가 서로 섞이지 않는다.

`GET /api/patterns`, `GET/POST /api/annotations`가 기존 COORDINATOR의 `pattern-meta:`·`pattern-op:` 영역을 사용한다. 기존 Access 인증 범위를 그대로 사용하며 R2·새 결제 서비스·새 binding은 필요 없다. 추가/삭제를 고유 ID의 변경 기록으로 보관해 재전송이 중복 표시를 만들지 않고, 오프라인 변경과 다른 기기의 변경을 병합한다. 저장은 기기 확인 후 클라우드 전송하며 실패 시 재시도 상태를 표시한다. 재접속·앱 복귀 때 자동 동기화한다. 문서당 변경 기록 5,000개, 전송당 100개로 제한한다.

`Pattern files & backup`에서 표시 JSON을 내보내거나 불러올 수 있다. 백업에는 PDF가 포함되지 않으므로 원본과 함께 iCloud Drive에 보관한다. 가져오기는 같은 프로젝트·PDF만 허용하고 기존 기록과 병합한다. `Remove local PDF`는 기기의 PDF만 제거하며 표시를 삭제하지 않는다. 전체 PWA 화면/API는 기존 정책대로 서비스 워커에 캐시하지 않는다. 오프라인 상태에서 이미 열린 패턴 작업은 가능하지만 인터넷 없이 앱을 새로 실행하는 것은 보장하지 않는다.

모듈의 데모 표시 클라우드는 브라우저 localStorage로 모사하며 운영 저장소에 접속하지 않는다. 타이머 데모와 달리 표시·PDF는 새로고침 후에도 남는다. 분리 전 2026-10-04 운영 패턴 화면 진입까지 확인했으며, 다시 활성화할 경우 실제 iOS Files/Pencil·Access 세션 만료·장기 보관은 실기기 확인이 필요하다.

타이머 기록용 물리 키·단축어는 2차 범위다. 나중에 같은 `POST /api/toggle`을 호출하며, Notion 토큰은 단축어에 넣지 않는다. Preview를 여는 현재 단축어 링크와는 별개다.
