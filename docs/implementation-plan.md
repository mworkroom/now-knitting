# Now Knitting 구현 계획서

최종 정리: 2026-09-30 · 기준: [Notion Knitting Projects의 Schedule view](https://app.notion.com/p/marionlee/243f66af29b280ba84b9c4ba00eb1184?v=243f66af29b280d6a34a000c9ac6aa68), 제공된 화면 캡처·UI 시안·초기 구현 브리프

## 1. 목표와 확정된 범위

Now Knitting의 출발점은 **매크로 키보드의 물리 키 한 개로 뜨개 시간을 시작하고, 같은 키를 다시 눌러 종료**하는 것이다. 두 키 중 나머지 하나는 차트를 볼 때 하이라이터 이동에 사용하며 Now Knitting의 입력으로 쓰지 않는다. Notion에 매번 들어가 `Now Knitting` 체크박스를 누르지 않도록 프로젝트 선택 화면을 제공한다. Notion은 프로젝트와 작업 기록의 유일한 원본이며, 앱의 화면 문구는 영어를 사용한다.

- **1차 앱 완성:** **Timer**, **Projects** 두 탭, 프로젝트 검색, 현재 프로젝트의 Notion 페이지 열기, 설치 가능한 PWA. Timer의 **버튼 하나**가 대기 중에는 START, 기록 중에는 END로 동작한다. START는 기본적으로 현재 시각을 사용하고, 필요할 때 시작 시각을 입력할 수 있다. 화면 버튼으로 Notion 기록까지 동작하면 단축어 없이 앱을 사용할 수 있다.
- **2차 물리 키 연결:** 앱에서 이미 사용하는 같은 toggle 작업을 iPad 매크로 키 한 개에도 연결한다. 차트를 주로 iPad에서 보므로 **iPad에 키보드를 연결해 시간 기록 키와 차트 하이라이터 키를 함께 쓰고, iPhone은 앱 리모컨으로 유지**한다. 차트 앱을 보는 중에도 시간 기록 키가 동작해야 한다. 물리 키는 최종 목표이지만 1차 앱 개발의 선행 조건은 아니다. 같은 PWA가 iPhone과 iPad에서 동작하며, 화면 잠금 중 동작은 별도 확인 대상이다.
- Projects는 Schedule view에 보이는 대상을 기준으로 한다. **WIP와 On Pause를 모두 포함**하며 WIP 전용 필터를 추가하지 않는다.
- 앱이 임의로 첫 프로젝트를 선택하지 않는다. Notion의 `Now Knitting` 값이 있으면 그대로 표시하고, 없으면 J님이 Projects에서 선택한다.
- 세션이 진행 중이면 프로젝트 변경을 막고 **END를 먼저 누르도록** 안내한다.
- 카페·역행·여름 필터, 프로젝트 상세 화면, 설정 화면은 후속 범위다. 잊고 누르지 못한 END의 시간 수정은 첫 버전에서 Notion에서 직접 한다.

## 2. 확인한 Notion 구조

| 원본 | ID | 첫 버전에서 사용할 값 |
| --- | --- | --- |
| Knitting Projects data source | `5138ecac-8835-4f5e-b82a-5d98c756dd3f` | `Name`, `Progress`, `Progress Status`, `Time Spent`, `Now Knitting`, 페이지 URL·아이콘 |
| Schedule view | `243f66af-29b2-80d6-a34a-000c9ac6aa68` | 프로젝트 포함 범위와 정렬 순서 |
| Daily Log data source | `327010b4-b582-4f08-abb2-440ea77fbcab` | `Name`, `Category`, `Start`, `End`, `🧵 Knitting Projects` 관계 |

초기 브리프의 속성명과 달리 실제 이름은 `Progress`(formula), `Progress Status`(select), `역행용`(checkbox), `카뜨가능`(formula), `여름불가`(checkbox)다. `Time Spent`도 formula다. **`Now Knitting` checkbox는 이미 생성되어 있다.** 조사 시점에 Schedule에는 12개 프로젝트가 있었으며, 선택값은 데이터에 따라 바뀌므로 이름이나 개수를 코드에 고정하지 않는다.

Daily Log의 기존 뜨개 기록은 `Name = 프로젝트명`, `Category = Knitting`, `Start`·`End`의 시각, `🧵 Knitting Projects` 관계를 사용한다. START는 같은 형태의 새 기록을 만들고 END는 열린 기록의 `End`를 채운다. 브라우저는 Notion 데이터베이스 버튼을 조작하지 않는다.

Projects의 포함 범위와 정렬은 [Notion view query](https://developers.notion.com/reference/create-view-query)를 기준으로 읽는다. 해당 API가 페이지 참조만 반환하면 필요한 페이지 속성을 추가 조회한다. 페이지네이션과 429의 `Retry-After`를 처리하고, 빈번한 자동 폴링은 하지 않는다. formula 결과가 비어 있거나 예상 형식이 아니면 `0`으로 꾸미지 않고 값 없음으로 표시한다.

## 3. 앱·서버·인증 구성

```text
iPhone·iPad PWA / desktop browser
        │  화면 버튼 → POST /api/toggle
        │
물리 매크로 키 → iOS/iPadOS 실행 경로(실기기 확인 필요)
        │  같은 toggle 동작 호출
        ▼
Cloudflare Access (Now Knitting Worker 한 개, 모든 트래픽)
        ▼
Cloudflare Worker (정적 화면 + API)
        │  서버 측 NOTION_TOKEN
        ▼
Notion API → Knitting Projects / Daily Log
```

- 프런트엔드는 React + Vite + TypeScript, 서버는 TypeScript Cloudflare Worker로 구성한다. Worker Static Assets가 화면을 제공하고 `/api/*`는 같은 Worker에서 처리한다. 첫 배포 주소는 `workers.dev`를 사용하며 개인 도메인 연결은 후속 작업이다.
- Cloudflare **Zero Trust 초기 설정은 완료**됐다. Worker와 Access 앱은 아직 없다. Worker를 만든 다음 [해당 Worker에만 Access `All traffic`](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)을 적용한다. 계정의 모든 Worker에 적용하는 설정은 사용하지 않는다.
- 허용 정책은 Cloudflare 계정의 현재 유일한 승인 멤버인 J님의 **정확한 이메일 주소 1개**로 제한한다. `Email domain` 전체 허용은 사용하지 않는다. 정적 자산과 API 모두 비로그인 접근을 차단하는지 배포 검증을 통과해야 한다.
- Notion 내부 연결의 토큰은 Worker의 `NOTION_TOKEN` secret에만 보관한다. 프로젝트 data source와 Daily Log data source에 해당 연결의 읽기·쓰기 권한을 부여한다. MCP의 Notion 로그인과 앱용 내부 연결은 별개다. 토큰을 채팅·저장소·브라우저 코드·PWA 설정에 넣지 않는다.
- 이 버전은 자체 DB, Supabase, 서비스 역할 키, 별도 프런트엔드 호스팅을 사용하지 않는다. 세션과 선택 상태를 브라우저에 영속 저장하지 않고 Notion에서 복원한다.
- 배포할 때 빈 Worker에 전용 Access를 먼저 붙여 비로그인 차단을 확인한 뒤 Notion secret과 실기능을 연결한다. Cloudflare의 정적 자산 경로에서는 `ctx.access`가 Worker 코드로 전달되지 않을 수 있으므로 그 값만으로 보안을 판단하지 않는다.
- 브라우저의 키 입력 처리는 Now Knitting 화면이 활성화된 동안에만 기대할 수 있다. 다른 앱을 보는 중 물리 키가 시간을 기록하려면 iPadOS가 해당 키로 단축어를 실행해야 한다. 기존 Notion 명령은 다른 앱 위에서 작동함을 확인했다. **Now Knitting용 단축어 제작과 검증은 1차 앱·API가 작동한 뒤** 진행한다.
- 해당 경로의 Access 인증도 실제 기기에서 확인한다. 브라우저 로그인 쿠키가 단축어의 네트워크 요청에 자동 전달된다고 가정하지 않는다. 비대화식 인증이 필요하면 Notion 토큰 대신 해당 경로만을 위한 별도·폐기 가능한 [Cloudflare Access service token](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)과 기존 Access 앱의 Service Auth 정책을 검토한다. 자격 증명이 단축어에 들어가는 부담과 보관·폐기 방법을 확인한 뒤 채택한다.
- 실제 매크로 키로 iPhone의 다른 앱 위에서 Notion 빠른 메모 명령이 작동했고, iPad의 차트 앱 위에서도 **하이라이터 이동 키와 Notion 명령 키가 모두 작동**했다. 따라서 두 키의 기기 입력 경로는 확인됐다. 직접 만든 Now Knitting 단축어와 Access 인증은 아직 검증하지 않았다.
- iPad에서 전체 키보드 접근을 켠 뒤 [knitting-chart-marker](https://github.com/mworkroom/knitting-chart-marker)의 하이라이터 키와 Notion 명령 키가 차트 앱 위에서 작동했고, 이전처럼 상단 빈 공간을 터치하지 않아도 바로 반응했다. 처음에는 화면 전체가 파랗게 선택되어 불편했지만 J님이 **전체 키보드 접근의 포커스 색과 자동 숨김 시간을 조정해 해결**했다. 따라서 이 표시 때문에 차트 앱의 포커스 코드를 수정하지 않는다. 키보드 전원을 매번 끄는 것을 기본 사용 절차로 요구하지 않는다.

## 4. 화면과 조작

### Timer

- 앱을 열면 Timer가 기본 탭이다. 현재 선택 프로젝트의 아이콘/이미지, 이름, `Progress Status`, `Progress`, `Time Spent` 총계를 표시한다. 프로젝트명을 누르면 해당 Notion 페이지 URL을 연다.
- Timer에는 **같은 위치의 큰 버튼 하나**만 둔다. 세션이 없으면 START, 있으면 경과 시간과 END를 보여준다. 다시 누를 때까지 프로젝트 선택값을 유지하며, END 후 다음 누름은 새 START다. START를 바로 누르면 현재 시각으로 시작한다. 필요할 때만 **Set start time**에서 날짜·시각을 입력한 뒤 START를 누를 수 있다. 이 입력은 새 세션을 시작하기 전의 시각 지정이며, 저장된 기록 수정은 첫 버전에서 Notion에서 한다.
- 경과 시간은 Notion `Start`를 기준으로 화면에서 계산하여 앱을 다시 열어도 이어 보인다. 총계 formula에 진행 중 세션을 임의로 더하지 않는다.
- 선택 프로젝트가 없으면 빈 상태와 **Choose Project** 버튼을 보여준다. 일반적인 START/END에는 확인 모달을 넣지 않는다. 쓰기가 진행 중이면 버튼을 잠그고 완료된 Notion 상태를 다시 읽은 뒤 다음 입력을 받는다.
- 물리 키가 다른 앱 위에서 실행된다면 결과를 확인할 수 있도록 시작·종료·실패를 짧은 기기 알림으로 알려준다. 성공 전에는 성공 알림을 내지 않고, 정상 실행에 추가 탭이나 확인 질문을 요구하지 않는다.

### Projects

- Schedule 순서의 세로 목록을 사용하고 현재 선택 항목을 표시한다. 프로젝트 행의 주요 탭은 선택 동작이다. 별도의 링크 아이콘/버튼을 누르면 그 프로젝트의 Notion 페이지가 열리므로 선택과 외부 링크를 혼동하지 않는다.
- 이름 검색은 이미 받은 목록에서 수행한다. 같은 프로젝트를 다시 누르면 변경하지 않는다. 진행 중 세션이 있으면 항목 변경을 막고 Timer의 END로 돌아갈 수 있게 한다.
- 모바일에서 가로 표를 만들지 않는다. 썸네일은 Notion 콘텐츠이므로 색을 유지할 수 있으며, 앱 자체의 색은 검정·흰색·중립 회색으로 제한한다. 시스템 sans-serif, 충분한 터치 영역, 명확한 로딩·빈 상태·오류 표시를 사용한다.
- 자주 읽는 본문·버튼·입력 글자는 약 14–16px 이상, 보조 글자도 약 12–14px 이상으로 설계한다. 글자가 길면 줄바꿈과 카드 높이 조정으로 처리한다.

## 5. API와 데이터 규칙

모든 API는 Access가 보호하는 같은 출처의 `/api/*` 아래에 둔다. 서버만 Notion API를 호출한다. 프로젝트 응답은 `id`, `name`, `notionUrl`, `icon`, `progress`, `progressStatus`, `timeSpent`, `selected`처럼 화면에 필요한 필드만 제공한다. 날짜는 서버에서 ISO 형식으로 전달하고 화면에서는 J님의 현지 시간대로 표시한다.

| API | 동작 |
| --- | --- |
| `GET /api/projects` | Schedule view의 전체 페이지를 순서대로 읽어 작은 프로젝트 목록으로 변환한다. |
| `GET /api/state` | `Now Knitting` 선택값과 `Category = Knitting`, `End`가 비어 있는 Daily Log를 읽어 현재 프로젝트·진행 중 세션을 반환한다. |
| `POST /api/select-project` `{ projectId }` | 해당 ID가 Schedule 대상인지 확인한다. 열린 세션이 없을 때 기존 선택을 해제하고 새 프로젝트 하나를 선택한 뒤 결과를 다시 읽는다. |
| `POST /api/toggle` `{ startAt? }` | 서버에서 현재 열린 뜨개 기록을 확인한다. 없는데 선택 프로젝트도 없으면 시작하지 않고 프로젝트 선택이 필요하다고 응답한다. 선택 프로젝트가 있으면 `Name = 프로젝트명`, `Category = Knitting`, `Start`, 프로젝트 관계로 Daily Log를 만든다. `startAt`이 없으면 서버의 현재 시각을, 있으면 검증한 입력 시각을 사용한다. 열린 기록이 하나 있으면 그 기록의 `End`에 현재 시각을 쓴다. 어느 동작을 했는지와 새 상태를 응답한다. |

화면 버튼과 물리 키는 같은 `toggle` 작업을 호출해야 하며, 각각 START/END를 별도로 추측하지 않는다. 서버가 성공을 확인한 뒤 화면 상태를 갱신한다. Notion 쓰기 요청의 응답이 불확실하면 `toggle`을 자동 재시도하지 않는다. 재호출은 곧바로 반대 동작이 될 수 있으므로 상태를 다시 읽고 결과를 알린다. 연속 키 입력·중복 요청이 두 번 전환을 일으키지 않도록 동시 요청과 키 반복에 대한 방어를 구현·검증한다. 프로젝트 선택의 두 페이지 수정 중 일부만 성공한 경우도 재조회 후 사용자에게 오류와 재시도 경로를 보여준다.

선택 입력의 날짜·시각은 화면에서 현지 시간으로 받고 ISO 시각으로 전송한다. 서버는 유효한 시각인지, 미래가 아닌지 검증한다. END는 입력한 `Start` 이후의 시각만 허용하며, 시간이 맞지 않으면 기록을 수정하지 않고 오류를 보여준다.

Notion에서 선택 체크박스가 둘 이상 켜져 있거나 열린 뜨개 로그가 둘 이상이면 임의의 하나를 고르지 않는다. 여러 선택값은 Projects에서 J님이 한 항목을 다시 선택하면 나머지를 해제하여 복구한다. 열린 로그가 여러 개인 경우에는 추가 toggle 및 프로젝트 변경을 막고 Notion에서 해당 로그를 정리하도록 안내한다. 네트워크 오류는 직전 표시 상태를 보존하되 완료된 작업처럼 표시하지 않는다.

## 6. 구현 순서와 검증

1. Vite/React 화면과 PWA manifest·아이콘을 만들고, 실제 Notion 값 형태의 모의 데이터로 Timer/Projects와 모바일 조작을 완성한다.
2. Cloudflare Worker 정적 배포를 준비하고 **Worker 하나에만 Access**를 적용한다. 비로그인으로 화면과 API에 접근할 수 없는지 먼저 확인한다.
3. Notion 내부 연결을 생성해 두 data source에 공유하고 Worker secret을 등록한다. Schedule 목록·선택값·열린 세션 조회를 연결한다.
4. 선택과 단일 toggle 동작을 연결하고 모든 작업의 성공/실패 후 Notion 재조회 결과를 확인한다.
5. **1차 앱 검증:** iPhone과 iPad의 Safari·홈 화면 PWA에서 로그인 유지·만료 후 재인증, 타이머 복원, 한 버튼 START/END, Notion 링크 열기를 확인한다. Chrome 100%에서 약 2048px 및 1280px CSS 너비도 확인한다. 여기까지 단축어 없이 사용할 수 있다.
6. **2차 물리 키 연결:** iPhone의 다른 앱 위에서 Notion 빠른 메모 키가 작동했고, iPad 차트 앱 위에서 하이라이터 이동 키와 Notion 명령 키가 모두 작동한 사실을 출발점으로 삼는다. 이제 iPad에서 Now Knitting용 단축어를 만들고 같은 toggle API에 연결한다. Access 인증 방법과 J님이 기기에서 해야 할 최소 설정을 확인한다.
7. iPad 차트 앱 위에서 물리 키 한 번으로 시작→종료→다음 시작이 실행되는지, 키 반복·네트워크 오류·재인증 상황을 실기기로 검증한다. 차트 앱은 현재 포커스 설정을 유지한다.

**1차 앱 수용 기준:** Schedule의 WIP·On Pause 항목이 누락 없이 보이고, Notion 선택값이 앱을 다시 열어도 일치한다. 화면의 같은 버튼을 한 번 누르면 Daily Log 하나가 올바른 이름·Category·관계·Start로 만들어지고 다시 누르면 그 로그만 닫힌다. 바로 START하면 현재 시각이 기록되고, **Set start time**을 사용하면 입력한 시각이 기록되며 미래 시각은 거부된다. 네트워크 재시도로 의도치 않은 두 번째 전환이 생기지 않는다. 진행 중 프로젝트 전환, 비로그인 API/정적 자산 접근, 비정상 다중 선택/열린 로그를 의도대로 막거나 복구한다. 375–390px 모바일에서 주요 버튼과 텍스트가 잘리지 않는다.

**2차 물리 키 수용 기준:** iPad 차트 앱 위에서 매크로 키 **한 개**로 시작→종료→다음 시작이 같은 순서로 동작한다. 키 반복이나 실패한 요청으로 의도치 않게 상태가 두 번 바뀌지 않고, 결과를 알림으로 확인할 수 있다.

## 7. 후속 범위와 현재 남은 준비

- 후속: `카뜨가능`, `역행용`, `여름불가` 필터; 프로젝트 상세; 설정 화면; 저장된 기록의 시작·종료 시각 수정; 개인 도메인.
- 물리 키 연동은 최종 핵심 목표이지만 **1차 앱 개발을 막지 않는다.** 앱·서버의 toggle 동작을 먼저 완성하고, 이후 iPad 단축어가 같은 API를 호출하게 한다. 단축어가 필요해도 Notion 토큰은 넣지 않는다.
- 현재 완료: Notion 구조 확인, `Now Knitting` 속성 존재 확인, Cloudflare MCP 연결, Zero Trust 초기 설정 확인.
- 구현 때 필요: Worker 생성과 전용 Access 정책, Notion 내부 연결 토큰 발급·data source 공유·Worker secret 등록, 실제 FAK 모델·매핑 가능한 키 조합·iPad OS 버전 확인 및 실기기 검증. 앱 자체는 아직 구현되지 않았다.
