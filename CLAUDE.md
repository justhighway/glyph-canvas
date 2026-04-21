# CLAUDE.md — Glyph Art 프로젝트 지침

## 프로젝트 한 줄 요약
이미지를 업로드하면 객체를 감지해 각 영역을 **그 객체의 이름(글자)** 으로 채우는 Semantic Typography Art 웹앱.

## 핵심 원칙 (항상 준수)
- **DRY**: 같은 로직 두 번 쓰지 않는다. 공통 로직은 반드시 추출.
- **KISS**: 가장 단순한 구현을 먼저 선택한다. 복잡성은 필요할 때만 추가.
- **단일 책임**: 함수/컴포넌트 하나는 한 가지 일만 한다.
- **명시적 타입**: `any` 금지. 모든 함수에 입출력 타입 명시.
- **순수 함수 우선**: 사이드 이펙트는 경계에서만 (훅, 이벤트 핸들러).

## 기술 스택
- **런타임**: React 19 + TypeScript
- **빌드**: Vite
- **패키지 매니저**: pnpm
- **스타일**: Tailwind CSS v4
- **ML 추론**: Transformers.js v3 (Web Worker 내부에서만 실행)
- **렌더링**: Canvas 2D API
- **배포**: Vercel

> **React Compiler 제외 이유**: 이 앱 규모에서 실질적 이득 없음. Canvas 렌더링은 컴파일러 최적화 대상이 아니고, memo가 필요한 컴포넌트가 존재하지 않음. 필요 시 나중에 추가.

## 폴더 구조
```
src/
├── components/           # UI 컴포넌트
│   ├── ImageUploader.tsx
│   ├── ResultViewer.tsx
│   ├── ControlPanel.tsx
│   └── ui/               # 원자 컴포넌트 (Button, ProgressBar 등)
├── hooks/                # 커스텀 훅
│   ├── use-segmentation.ts
│   └── use-canvas-render.ts
├── lib/                  # 순수 유틸 함수
│   ├── text-placer.ts    # Canvas 글자 배치 알고리즘
│   └── canvas.ts         # Canvas 유틸
├── types/                # 전역 타입 정의
│   ├── index.ts
│   └── worker.ts
├── constants/            # 상수
│   ├── coco-labels.ts    # COCO 80 클래스 다국어 맵
│   └── config.ts
├── workers/              # Web Worker 파일들
│   └── segmentation.worker.ts
├── App.tsx               # 루트 컴포넌트, 전역 상태
├── main.tsx
└── index.css
```

> **FSD 미채택 이유**: 단일 페이지, 화면 1개, 컴포넌트 5~7개 규모에서 `widgets/features/shared` 레이어 분리는 파일 탐색 오버헤드만 늘린다. 멀티팀·멀티도메인 프로젝트가 아니면 FSD는 과도한 구조임.

## 의존성 규칙
- `components/` → `hooks/`, `lib/`, `types/`, `constants/`
- `hooks/` → `lib/`, `types/`, `constants/`
- `lib/` → `types/`, `constants/`
- `workers/` → `types/` (메시지 타입만)
- **역방향 import 금지**

## 코드 컨벤션

### 네이밍
- 컴포넌트: `PascalCase`
- 함수/변수: `camelCase`
- 타입/인터페이스: `PascalCase`, 인터페이스 prefix `I` 사용 안 함
- 상수: `SCREAMING_SNAKE_CASE`
- 파일: `kebab-case.ts` (컴포넌트는 `PascalCase.tsx`)

### 컴포넌트 작성 규칙
```tsx
// ✅ 올바른 예
type Props = {
  imageFile: File
  onResult: (result: SegmentationResult) => void
}

export function ImageUploader({ imageFile, onResult }: Props) {
  // ...
}

// ❌ 금지
export default function({ imageFile, onResult }: any) { ... }
```

### 훅 규칙
- 커스텀 훅은 `hooks/` 안에 위치
- 훅 파일명: `use-*.ts`
- 훅은 UI 로직과 비즈니스 로직을 분리하는 경계

### 타입 규칙
```ts
// ✅ 명시적 반환 타입
function parseDetections(raw: RawYoloOutput): Detection[] { ... }

// ❌ 암묵적 any
function parseDetections(raw) { ... }
```

## Worker 통신 규칙
- ML 추론은 **반드시** `workers/segmentation.worker.ts` 안에서만 실행
- 메인 스레드 ↔ Worker 메시지 타입은 `types/worker.ts`에 정의
- Worker 통신은 `hooks/use-segmentation.ts` 훅으로만 접근
- **추론 중 신규 요청은 무시** (큐잉 없음). Worker terminate 후 재생성 시 모델을 재로드해야 하므로 취소·재시작 패턴은 사용하지 않음

## 파일 생성 전 체크리스트
1. 이 로직이 이미 어딘가에 있지 않은가? (DRY)
2. 이 파일이 속할 레이어가 올바른가? (FSD)
3. 더 단순하게 구현할 수 없는가? (KISS)
4. 타입이 모두 명시되어 있는가?

## 스펙 파일 목록
- `specs/00-overview.md` — 프로젝트 전체 개요 및 범위
- `specs/01-architecture.md` — 폴더 구조 상세 + 기술 결정 근거
- `specs/02-ml-pipeline.md` — YOLO 추론 파이프라인 명세 (⚠️ PoC 필요 항목 포함)
- `specs/03-render-engine.md` — Canvas 렌더 엔진 알고리즘
- `specs/04-ui.md` — UI 컴포넌트 명세

## 작업 시작 전 루틴
1. 관련 `specs/*.md` 먼저 읽기
2. **ML 파이프라인 변경 시 반드시 `specs/02-ml-pipeline.md`의 PoC 검증 상태 확인** — 모델/출력 포맷이 가정과 다를 수 있음
3. 구현 전 타입 정의 먼저 작성
4. 구현 후 의존성 방향 확인 (components → hooks → lib → types)
