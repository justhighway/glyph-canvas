# Glyph Canvas — 프로젝트 개요

## 프로젝트 한 줄 요약

이미지를 업로드하면 얼굴을 감지해, 각 얼굴 영역(피부, 눈썹, 코, 입술, 눈, 홍채)을 **그 영역의 이름(글자)** 으로 빽빽하게 채우는 Semantic Typography Art 웹앱.

---

## 왜 만드는가

타이포그래피와 얼굴 인식을 결합한 아트 프로젝트다. 결과물은 멀리서 보면 사람 얼굴처럼 보이지만, 가까이서 보면 전부 글자로 이루어져 있다. 각 영역이 자신의 이름("EYE", "NOSE", "LIPS" 등)으로 채워진다는 점이 핵심 컨셉이다.

---

## 기술 스택 선택 이유

| 기술 | 역할 | 선택 이유 |
|------|------|-----------|
| Next.js 16 (App Router) | 프레임워크 | Gemini API 키를 서버 사이드에서만 관리하기 위해 API Route 필요. Vite + 별도 Express 서버 대비 단일 레포·단일 배포 파이프라인 |
| TypeScript | 언어 | 타입 안전성. 특히 MediaPipe 랜드마크 좌표 처리에서 인덱스 실수 방지 |
| MediaPipe FaceLandmarker | 얼굴 감지 ML | 브라우저에서 직접 실행. 서버 왕복 없이 실시간 처리. 478개 랜드마크로 세밀한 영역 분리 가능 |
| Canvas 2D API | 렌더링 | 픽셀 단위 조작이 필요한 마스크 생성·글리프 합성에 적합 |
| OffscreenCanvas | 오프스크린 처리 | 화면에 표시하지 않고 마스크를 생성하거나 글리프를 합성할 때 사용 |
| Tailwind CSS v4 | 스타일 | 빠른 UI 구성 |

---

## 전체 처리 파이프라인

```
이미지 업로드
    ↓
analysis 해상도로 축소 (max 600px)
    ↓
MediaPipe FaceLandmarker.detect()
    → 478개 랜드마크 (0~1 정규화 좌표)
    ↓
각 영역 폴리곤 마스크 생성
    → FACE_OVAL, EYEBROW, NOSE, LIPS, EYE 컨투어
    → createPolygonMask() → Uint8ClampedArray
    ↓
홍채/흰자 분리 (splitIrisAndSclera)
    → BFS 어두운 픽셀 클러스터 + iris 랜드마크 기하
    ↓
피부 마스크 생성
    → faceOval - (eyebrow + nose + lips + eye)
    ↓
각 영역에 글리프 렌더링 (fillRegionWithGlyph)
    → OffscreenCanvas에 글자 그리드 그림
    → maskCanvas와 destination-in 합성
    → display Canvas에 drawImage
    ↓
원본 이미지 50% 투명도로 깔고
글리프 레이어를 그 위에 합성
```

---

## 폴더 구조

```
glyph-canvas/
├── src/
│   └── app/
│       ├── page.tsx        # 현재 모든 로직이 집중된 메인 파일
│       ├── layout.tsx
│       └── globals.css
└── docs/                   # 이 문서들
```

현재는 프로토타입 단계라 `page.tsx` 한 파일에 모든 로직이 있다. 추후 `hooks/`, `lib/`, `components/`로 분리 예정.
