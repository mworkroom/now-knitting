# Now Knitting 연결 및 배포

## 현재 상태

2026-10-01: J님의 명시적인 배포 승인 후 `now-knitting` Worker 생성, 전용 Access All traffic 설정, 운영 앱 배포를 완료했다. 화면·API·모든 정적 파일의 비로그인 요청은 Access 로그인으로 이동한다. J님이 `NOTION_TOKEN`을 Secret으로 등록하고 배포한 것을 확인했다. 실데이터의 START/END와 실기기 검증은 남아 있다.

2026-10-04: 한국시간 저장·END 직후 링크·프로젝트 본문 종료 시간 추가와 프로젝트 상세·PDF 표시를 포함한 최신 앱 전체를 배포했다. Chrome 운영 Timer·상세·패턴 진입과 새 자산/API의 Access 보호를 확인했다. 이번 작업에서 운영 START/END 시험 기록은 만들지 않았다.

- 앱: https://now-knitting.mworkroom.workers.dev/
- 계정: `3345251b69db705496b39fee040d036c`
- Worker ID: `f42d044394934c04a222d3566c47cc2e`
- Access 앱: `Now Knitting` (`24b45f7f-60ec-422c-8a28-8ac2481ecb58`)
- 정책: `J only`, Allow Emails J님의 등록 이메일 한 개, 앱 세션 1개월 (`1 month`), 정책 세션은 앱 설정 상속 (2026-10-13 운영 설정 확인)
- 보호 대상: 해당 Worker의 모든 트래픽. 계정 전체 Worker 정책이나 공개 예외는 없다.
- 운영 버전 ID: `c2687e9a-9c0c-4fa6-be53-c0a04b184669` (2026-10-05, 왼쪽 선택 영역·상세 진입·조건 뱃지/필터·Preview 바로가기)
- Durable Object: `KnittingCoordinator`, migration `v1`, SQLite namespace `77caa29e05b1400e96b292e1af867bad`
- `workers.dev` 활성화, preview URL 비활성화

최초 배포는 Cloudflare 연결 API와 정적 자산의 한시적 업로드 세션을 사용했고 업로드 토큰과 임시 파일을 삭제했다. 2026-10-04에는 J님의 승인으로 계정·사용자 조회 및 Worker 쓰기 범위의 Wrangler OAuth 로그인을 연결하고 `wrangler deploy --keep-vars`로 배포했다. Notion Secret과 기존 vars·바인딩을 유지했다.

계정 서브도메인을 `easylong`에서 `mworkroom`으로 변경했다. 앱의 API·PWA 경로는 상대 경로이고 Access는 Worker ID를 보호하므로 주소 변경만으로 재빌드하거나 보호 정책을 다시 만들 필요가 없다. 새 주소를 사용하고 기존 주소의 북마크를 갱신한다. 이전 주소로 홈 화면 앱을 설치했다면 새 주소에서 다시 설치한다.

운영 연결 확인: Chrome에서 실제 Schedule 프로젝트 11개, Notion의 `V-neck Chokki Black` 선택 상태·진행률·누적 시간이 표시되고 Timer/Projects 탭 전환이 정상이다. `/api/state` 200 응답과 새 버전 반영을 로그로 확인했다. 실제 START/END 기록은 아직 검증하지 않았다.

2026-10-05: `npm run deploy`로 최신 로컬 구현을 운영에 반영했다. 기존 vars·Secret·DO를 유지했다. 화면·API·새 JS/CSS·manifest·아이콘의 비로그인 요청이 모두 Access 로그인으로 302 이동하는 것을 확인했다. Chrome 연결이 끊겨 내장 브라우저로 확인했지만 로그인 세션이 없어 이번 버전의 인증 후 실데이터 화면은 검증하지 못했다. 운영 프로젝트 선택·START/END 시험 기록은 만들지 않았다. 조건 속성 ID 연결은 로그인 후 첫 정상 조회에서 이루어진다.

## GitHub 자동 배포

2026-10-24 대시보드 확인: 기존 Worker에 `mworkroom/now-knitting` 저장소와 배포용 토큰이 이미 연결돼 있었다. 빌드 명령이 비어 있어 `npm run build`로 설정하고 배포 명령을 `npx wrangler deploy --keep-vars`로 저장했다. 기존 연결·토큰을 사용하며 별도의 GitHub Actions는 추가하지 않는다.

| 항목 | 설정 |
| --- | --- |
| 저장소 | `mworkroom/now-knitting` |
| 운영 브랜치 | `main` |
| 루트 디렉터리 | `/` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy --keep-vars` |

수정 후 `npm run check`로 검증하고 변경 범위를 확인해 커밋·푸시한다. Cloudflare Workers Builds가 의존성 설치·빌드·배포를 수행하며, 대시보드의 Deployments에서 해당 커밋의 결과를 확인한다. 로컬 저장 또는 커밋만으로는 배포되지 않는다. `wrangler.jsonc`의 Worker 이름은 기존 `now-knitting`을 유지한다.

Notion 토큰은 기존 운영 Worker의 runtime Secret을 사용한다. GitHub나 Build variables에 복사하지 않는다. `.dev.vars*`, 비밀 환경 파일, `node_modules/`, `dist/`, 개인 학습 메모·로컬 QA 메모·PSD·임시 CSV는 업로드하지 않는다. `.env.example`과 `.env.demo`는 토큰 없는 데모 모드 예제다. 운영 Access와 Durable Object는 기존 Worker 구성을 유지하며, `preview_urls`는 계속 비활성이다.

빌드 설정 변경 자체는 운영 코드를 교체하지 않는다. 최초 GitHub 푸시 후 자동 배포 결과와 화면·API의 Access 보호를 확인해야 연동 검증이 완료된다. 수동 복구 배포는 기존 `npm run deploy`를 사용한다.

공식 안내: [기존 Worker에 Git 연결](https://developers.cloudflare.com/workers/ci-cd/builds/#connect-an-existing-worker), [빌드 설정](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## 로그인 세션

2026-10-13: 개인 앱에서 거의 매일 재로그인해야 하는 불편을 줄이기 위해 Cloudflare Access의 `Now Knitting` 앱 Session Duration을 `24 hours`에서 지원 최대값인 `1 month`로 변경했다. 저장 성공 안내와 설정 화면 재진입 후 `1 month` 값을 확인했다. `J only` 정책의 Session duration은 `Same as application session timeout`이므로 별도 정책 변경 없이 앱 기간을 따른다.

세션 기간은 React 코드나 Wrangler 배포 설정이 아니라 Cloudflare Access에서 관리한다. Worker 재배포는 필요하지 않다. 전역 세션과 허용 이메일·Worker 보호 범위는 변경하지 않았다. Cloudflare 공식 설명에 따르면 유효한 앱 토큰은 자체 유효기간 동안 접근을 허용하므로 전역 세션 기간을 늘릴 필요는 없다. 이미 발급된 24시간 토큰의 만료는 소급 변경되지 않으며, 다음 로그인으로 발급되는 세션부터 새 기간을 사용한다. 쿠키 삭제나 로그아웃·세션 폐기 등으로 더 일찍 재로그인이 필요할 수 있으며, 실제 iPad에서 한 달 유지되는지는 아직 장기간 확인하지 않았다.

공식 기준: [Cloudflare Access 세션 관리](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/).

## 안전한 배포 순서

1. 대상 계정에서 `now-knitting` Worker가 없는지 다시 확인한다. 동일 이름이 있으면 소유·용도를 확인하기 전까지 덮어쓰지 않는다.
2. Notion secret·개인 데이터·정적 자산이 없는 준비용 Worker를 만든다. 공개 응답은 503 안내만 반환해야 한다.
3. 이 Worker의 **Access → All traffic**만 적용한다. 계정 전체 Worker에 적용하지 않는다. Zero Trust의 해당 Access 앱 정책을 `Allow → Emails → J님의 정확한 이메일 한 개`로 설정한다. Email domain, Everyone, Bypass를 사용하지 않는다. 현재 승인 멤버 이메일은 배포 시 계정 멤버 목록에서 다시 확인한다.
4. 비로그인 요청으로 `/`, `/api/state`, 정적 자산 경로가 모두 Access 로그인/차단 응답을 받는지 확인한다. 준비용 Worker의 503 본문이 로그인 없이 보이면 Access가 아직 적용되지 않은 것이다.
5. Notion 내부 연결을 생성하고 아래 두 원본 데이터베이스에 공유한다. 읽기·콘텐츠 삽입·업데이트 권한이 필요하다. MCP의 Notion 로그인은 이 토큰을 대신하지 않는다.
6. 보호된 Worker에 실제 앱을 배포하고 Worker secret에 `NOTION_TOKEN`을 등록한다. secret 등록은 J님이 Cloudflare 화면에서 직접 진행한다. 현재 운영 Worker에서는 앱 배포와 secret 등록을 완료했다.
7. 비로그인 화면·API·JS/CSS·manifest·아이콘 접근을 다시 확인한다. 이후 로그인한 브라우저에서 실제 Schedule 및 START/END를 검증한다.

Worker Static Assets 구성에서는 `ctx.access`가 사용자 Worker에 전달되지 않을 수 있으므로 그 값만으로 인증 여부를 판정하지 않는다. 모든 도메인·경로를 보호하는 Worker 전용 Access 정책과 실제 비로그인 접근 결과를 기준으로 확인한다. [Cloudflare 공식 문서](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

## Notion 내부 연결과 secret 등록

- Projects data source: `5138ecac-8835-4f5e-b82a-5d98c756dd3f`
- Daily Log data source: `327010b4-b582-4f08-abb2-440ea77fbcab`
- Schedule view: `243f66af-29b2-80d6-a34a-000c9ac6aa68`

Notion 연결 관리 화면에서 앱 전용 내부 연결을 만들고, 각 **원본 데이터베이스** 메뉴의 Connections에 연결을 추가한다. Projects의 Schedule이 연결된 view이면 view만 공유하지 않고 원본 Projects 데이터베이스까지 공유한다.

Cloudflare 대시보드의 **Workers & Pages → now-knitting → Settings → Variables and Secrets → Add**에서:

- Type: `Secret`
- Variable name: `NOTION_TOKEN`
- Value: Notion의 내부 연결 토큰

토큰은 채팅·Git·프런트엔드 `.env`·manifest에 넣지 않는다. 생성된 `now-knitting` Worker에서 위 설정을 저장·배포한 뒤 앱에 로그인하고 새로고침한다. 별도의 앱 재빌드는 필요하지 않다.

대시보드의 “Update your Wrangler configuration…” 문구는 일반적인 동기화 안내다. Secret 값은 `wrangler.jsonc`의 `vars`에 복사하지 않는다. `NOTION_TOKEN`이 Text로 등록됐다면 Secret으로 다시 등록한다. 현재 운영 설정은 `secret_text`로 확인됐다. 연결 설정 배포 후에는 앱 오른쪽 위 새로고침으로 Notion 상태를 다시 읽는다.

Wrangler 배포를 사용할 경우 Cloudflare MCP 연결과 별도로 CLI 로그인이 필요하다:

```powershell
npx wrangler login
npm run check
npm run deploy
```

`npm run deploy`는 위 순서의 6번, Access 확인 후 실제 앱 배포에만 사용한다. `--keep-vars`로 대시보드 설정을 유지한다. `.dev.vars`는 로컬 전용이며 운영 secret을 대체하지 않는다.

## API 계약

| 경로 | 요청·결과 |
| --- | --- |
| `GET /api/projects` | Schedule 순서의 프로젝트 목록 |
| `GET /api/state` | 프로젝트 목록, Notion의 선택·열린 세션, 충돌 안내, `needsReview` |
| `POST /api/select-project` | `{ projectId, revision? }` |
| `POST /api/toggle` | `{ startAt?, revision? }`; 결과 `action: started / ended` |
| `POST /api/reconcile` | `{ reviewed: true }`; 불확실한 작업을 Notion에서 확인한 뒤 안전 잠금 해제 |
| `GET /api/patterns?projectId=…` | 프로젝트의 PDF 메타데이터 목록; 원본 파일은 포함하지 않음 |
| `GET /api/annotations?projectId=…&hash=…` | 해당 PDF의 표시 작업 기록 또는 `document: null` |
| `POST /api/annotations` | 버전 1 메타데이터와 최대 100개 표시 작업; 저장 확인된 `acceptedIds` 반환 |

타이머·프로젝트 선택 쓰기 요청은 `Content-Type: application/json`, `Idempotency-Key: 새 UUID`를 사용한다. 브라우저는 `revision`으로 직전 조회 상태도 보낸다. 동일한 요청 ID로 같은 요청을 다시 보내면 24시간 내 저장한 처리 결과와 새로 읽은 Notion 상태를 반환하며 쓰기를 반복하지 않는다. 다른 내용으로 ID를 재사용하면 거부한다. 별도 요청이어도 실행 중이거나 직전 완료 후 2.5초 이내이면 두 번째 쓰기를 막는다.

표시 저장은 별도의 불변 작업 ID로 중복을 제거하므로 `Idempotency-Key`와 타이머 잠금을 사용하지 않는다. 같은 작업 ID의 다른 내용은 충돌로 거부한다. 기존 COORDINATOR의 `pattern-meta:`·`pattern-op:`에 저장하며 24시간 타이머 영수증 정리에서 제외한다. R2나 새 binding·migration은 필요하지 않다. 최대 5,000개 작업/PDF·프로젝트이며 원본 PDF는 업로드하지 않는다. 새 API도 기존 All traffic Access 보호 안에서 사용한다.

Notion 429는 `Retry-After`를 따르며 최대 세 번 재시도한다. 거절된 429는 쓰기 완료가 아니므로 안전한 재시도지만, 연결 끊김·5xx 등 불확실한 쓰기는 재시도하지 않는다. 조회·쓰기 모두 제한 시간과 명확한 오류를 사용한다. Schedule 조회는 [공식 view query](https://developers.notion.com/reference/create-view-query)의 결과 참조를 순서대로 페이지 속성으로 해석한다.

일반적인 START/END는 확인 질문 없이 실행된다. 불확실한 응답·서버 중단이 있었을 때만 Notion 확인과 명시적 잠금 해제 경로를 보여준다. 프로젝트 선택 중 일부 페이지만 수정됐어도 재조회하고 복구 안내를 표시한다. Notion에서 여러 프로젝트가 선택돼 있어도 열린 로그가 정확히 하나이고 유효하면 그 로그를 먼저 END할 수 있다.

## 남은 실제 검증

- Schedule 대상·순서·WIP·On Pause가 실제 view와 일치하는지
- 실제 프로젝트를 선택하고 현재 시각 START → 같은 Daily Log END → 입력 시각 START
- Name·Category·프로젝트 관계·Start·End가 올바른지, 기록 중 선택이 막히는지
- iPhone/iPad Safari와 홈 화면 PWA에서 로그인 유지·만료 후 재인증, 재진입 타이머 복원, Notion 링크
- secret 등록 이후에도 비로그인 화면·API·모든 정적 자산 접근 차단이 유지되는지 (현재 배포에서 확인 완료)
- 물리 키와 단축어는 1차 연결·실기기 검증 이후 진행

서비스 워커는 설치만 지원하고 개인 화면·API·로그인 응답을 오프라인 캐시하지 않는다. 네트워크가 없으면 타이머 기록을 큐에 넣지 않는다. 2026-10-05 운영 버전에서 Pattern은 `shortcuts://run-shortcut?name=OpenPreview`를 열며 내부 PDF 모듈은 비활성이다. 위 표시 API·저장 데이터는 유지한다. 선택적 PDF 모듈을 다시 활성화하면 이미 열린 PDF 화면의 표시를 IndexedDB에 저장하고 재연결·재진입 때 표시 작업만 다시 동기화한다. 앱 자체의 오프라인 재실행은 지원하지 않는다. Notion을 직접 수정하는 다른 클라이언트와의 원자적 트랜잭션은 Notion API가 제공하지 않으므로 외부 수정은 새로 읽은 상태로 확인한다.
