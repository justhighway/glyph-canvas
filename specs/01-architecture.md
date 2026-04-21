# Spec 01 — 아키텍처

## 기술 선택 근거

| 결정 | 선택 | 근거 |
|------|------|------|
| 프레임워크 | Vite + React 19 | SSR 불필요, Web Worker 설정 간단 |
| ~~React Compiler~~ | **미채택** | 컴포넌트 5~7개 규모에 불필요, Canvas 렌더링은 컴파일러 최적화 대상 아님 |
| ML 추론 | Transformers.js v3 | 브라우저 ONNX 추론, WebGPU 자동 지원 |
| 모델 | **PoC 후 확정** (YOLOv8-seg 우선 검토) | YOLOv11-seg의 Transformers.js 지원 여부 미검증 — 구현 전 반드시 확인 |
| 렌더링 | Canvas 2D | WebGL 대비 구현 단순, 충분한 성능 |
| 스타일 | Tailwind CSS v4 | 설정 최소화, 빠른 UI 개발. 외부 UI 라이브러리 미사용으로 생태계 이슈 없음 |
| 패키지 | pnpm | 디스크 효율, 속도 |

---

## 폴더 구조 (전체)

> FSD 미채택. 단일 페이지·소규모 앱에서 `widgets/features/shared` 레이어 분리는 탐색 오버헤드만 늘린다.

```
glyph-canvas/
├── public/
│   └── models/            # ONNX 모델 캐시 (optional, CDN 우선)
├── src/
│   ├── components/
│   │   ├── ImageUploader.tsx    # 드래그앤드롭 + 클릭 업로드
│   │   ├── ResultViewer.tsx     # 결과 Canvas + 오버레이
│   │   ├── ControlPanel.tsx     # 언어 선택, 다운로드 버튼
│   │   ├── CameraCapture.tsx    # WebRTC 카메라 (Day 6)
│   │   └── ui/
│   │       ├── Button.tsx
│   │       ├── LoadingSpinner.tsx
│   │       └── ProgressBar.tsx
│   │
│   ├── hooks/
│   │   ├── use-segmentation.ts  # Worker 통신 훅
│   │   └── use-canvas-render.ts # Canvas 렌더 훅
│   │
│   ├── lib/
│   │   ├── text-placer.ts       # 글자 배치 순수 함수
│   │   └── canvas.ts            # Canvas 유틸 (픽셀 읽기 등)
│   │
│   ├── types/
│   │   ├── index.ts             # Detection, Language 등 전역 타입
│   │   └── worker.ts            # Worker 메시지 타입
│   │
│   ├── constants/
│   │   ├── coco-labels.ts       # COCO 80 클래스 다국어 맵
│   │   └── config.ts            # 앱 설정 상수
│   │
│   ├── workers/
│   │   └── segmentation.worker.ts   # ML 추론 전용 Worker
│   │
│   ├── App.tsx                  # 루트 컴포넌트, 전역 상태
│   ├── main.tsx                 # React 진입점
│   └── index.css                # Tailwind 전역 스타일
│
├── specs/
├── CLAUDE.md
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## 의존성 방향

```
App.tsx
  └── components/ (ImageUploader, ResultViewer, ControlPanel)
        └── hooks/ (use-segmentation, use-canvas-render)
              └── lib/ (text-placer, canvas)
                    └── types/, constants/

workers/ → types/ (Worker 메시지 타입만)
```

**금지된 방향:**
- `lib/` → `hooks/` import ❌
- `lib/` → `components/` import ❌
- `workers/` → `hooks/` import ❌ (타입만 허용)

---

## 전역 상태 설계

React 19 `useState` + props drilling으로 충분 (상태가 단순함).
Zustand 등 외부 상태관리 라이브러리 **도입 안 함** (KISS).

```
App.tsx
├── imageFile: File | null
├── segmentationResult: SegmentationResult | null
├── language: Language
└── status: 'idle' | 'loading' | 'done' | 'error'
```

---

## Worker 통신 설계

```
MainThread                     Worker
    │                             │
    │──── { type: 'RUN', imageData } ──▶│
    │                             │  (YOLO 추론)
    │◀─── { type: 'PROGRESS', pct } ───│
    │◀─── { type: 'RESULT', detections }│
    │◀─── { type: 'ERROR', message } ──│
```

메시지 타입은 `types/worker.ts`에 discriminated union으로 정의.

**추론 중 신규 요청 처리:** `status === 'loading'`이면 새 `run()` 호출을 무시한다. Worker terminate 후 재생성하면 모델을 재로드해야 하므로 취소·재시작 패턴은 사용하지 않는다.
