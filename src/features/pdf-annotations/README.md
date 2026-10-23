# PDF annotation 모듈 (현재 화면에서 비활성)

J님 요청으로 Pattern은 `shortcuts://run-shortcut?name=OpenPreview`를 여는 링크로 변경했다. 기존 PDF 뷰어는 나중에 재사용할 수 있도록 이 폴더에 분리했으며 일반 앱에서 import하거나 자동 동기화하지 않는다.

- `index.tsx`: 선택적으로 마운트하는 React 진입점. 뷰어·스타일·복귀/온라인 동기화를 함께 연결한다.
- `PatternViewer.tsx`: PDF 열기·형광펜·지우기·Undo·표시 백업 UI.
- `patternStore.ts`: 기존 IndexedDB와 클라우드 표시 저장/병합.
- `styles.css`: PDF 화면 전용 스타일.
- `vite-assets.ts`: PDF.js 폰트·CMap·WASM 제공/복사 플러그인. 기본 앱 빌드에서는 실행하지 않는다.

표시 스키마는 `shared/pattern.ts`, 서버 저장 API는 `worker/pattern.ts`에 그대로 남아 있다. IndexedDB 이름 `now-knitting-patterns`, 저장소 documents/pdfs/bindings, 클라우드 pattern-meta:/pattern-op: 키와 기존 데이터는 변경·삭제하지 않았다. `pdfjs-dist` 의존성과 저장 계약 테스트도 유지한다. 사용 중이던 표시가 새 앱을 실행했다는 이유로 삭제되거나 Preview로 자동 이전되지는 않는다.

## 재사용할 때

1. 이 폴더의 기본 export를 lazy import하여 프로젝트와 onBack을 전달한다. 같은 프로젝트 ID를 전달해야 기존 표시를 찾는다.
2. `ENABLE_PDF_ANNOTATIONS=true` 환경으로 Vite를 실행/빌드하여 PDF.js 보조 자산을 제공한다. 이 플래그만 켜면 화면이 자동으로 추가되는 것은 아니다.
3. 뷰어를 담는 호스트에 `app-shell app-shell--pattern`을 적용하고 기존 앱의 기본 styles.css를 함께 사용한다. 공유 버튼·썸네일 스타일은 기본 스타일에 남아 있다.
4. 실제 원본 PDF와 기존 JSON 백업으로 저장·복원을 확인한다. 서버 API와 기존 Access 보호는 계속 유지한다.

모듈이 마운트되면 그때 동기화가 재개된다. 비활성 상태에서도 브라우저의 저장 공간 정리 자체를 막는 것은 아니므로 중요한 표시 JSON/원본 백업은 계속 보관한다.
