# Spec 02 — ML 파이프라인

## 모델

> ⚠️ **구현 전 PoC 필수**: Transformers.js v3의 YOLOv11-seg 지원 여부, 실제 HuggingFace 모델 ID, 출력 포맷(마스크 해상도 등)을 50줄 이내 PoC로 먼저 검증한다. 아래 명세는 검증 결과에 따라 수정될 수 있다.

### 우선순위별 모델 후보

| 우선순위 | 모델 | 이유 |
|----------|------|------|
| 1순위 | YOLOv8n-seg | Transformers.js 공식 예제 존재, 검증됨 |
| 2순위 | YOLOv11n-seg | 더 최신이나 Transformers.js 지원 미검증 |

PoC에서 1순위부터 시도. 동작 확인 후 모델 ID를 `constants/config.ts`에 고정.

| 항목 | 값 (PoC 후 확정) |
|------|-----------------|
| 소스 | Transformers.js v3 HuggingFace CDN 자동 로드 |
| 크기 | ~10MB 이하 (양자화) |
| 클래스 | COCO 80개 |
| 출력 | bounding box + segmentation mask per detection |

---

## Worker 구현 명세

### 파일: `src/workers/segmentation.worker.ts`

```ts
// 책임: ML 모델 로드 + 추론 실행. UI 로직 없음.

// 초기화 (Worker 생성 시 1회)
// 1. pipeline('object-detection' 또는 'image-segmentation', MODEL_ID) 로 모델 로드
//    → 정확한 pipeline task 이름은 PoC에서 확인
// 2. READY 메시지 전송

// 추론 (RUN 메시지 수신 시)
// 1. ImageData → 모델 입력 변환
// 2. 추론 실행
// 3. 결과 파싱 → Detection[] 변환
//    → mask가 저해상도(e.g. 160×160)로 오는 경우 원본 이미지 크기로 upscale 필요
// 4. RESULT 메시지 전송
```

### Worker 메시지 타입 (`types/worker.ts`)

```ts
// 메인 → Worker
type WorkerInMessage =
  | { type: 'RUN'; imageData: ImageData }

// Worker → 메인
type WorkerOutMessage =
  | { type: 'READY' }
  | { type: 'PROGRESS'; percent: number }
  | { type: 'RESULT'; detections: Detection[] }
  | { type: 'ERROR'; message: string }
```

---

## Detection 타입 (`types/index.ts`)

> ⚠️ `mask` 필드의 실제 타입·해상도는 PoC 후 확정. YOLO seg 출력은 저해상도 마스크(e.g. 160×160)로 나올 수 있으며, Worker 내부에서 원본 이미지 크기로 upscale한 뒤 이 타입으로 정규화한다.

```ts
type Detection = {
  label: string           // COCO 클래스명 (영어, 원본)
  score: number           // 신뢰도 0~1
  box: BoundingBox        // 정규화된 좌표 (0~1)
  mask: Uint8ClampedArray // 픽셀별 마스크, 원본 이미지와 동일 크기로 정규화됨
                          // mask[i] > 128 이면 해당 픽셀이 객체에 속함
}

type BoundingBox = {
  x: number   // left (0~1)
  y: number   // top (0~1)
  w: number   // width (0~1)
  h: number   // height (0~1)
}
```

---

## use-segmentation 훅 명세

### 파일: `src/hooks/use-segmentation.ts`

```ts
type UseSegmentationReturn = {
  run: (imageData: ImageData) => void
  result: SegmentationResult | null
  status: 'idle' | 'loading' | 'done' | 'error'
  progress: number        // 0~100
  error: string | null
}
```

**책임:**
- Worker 인스턴스 생성 및 생명주기 관리
- 메시지 송수신 처리
- 상태 업데이트

**규칙:**
- Worker는 훅 마운트 시 1회 생성, 언마운트 시 terminate
- `status === 'loading'` 중 새 `run()` 호출은 무시 (UI에서 disabled 처리로 방어)
- Worker terminate 후 재생성은 모델 재로드를 유발하므로 사용하지 않음

---

## 모델 로딩 UX

1. 첫 방문: HuggingFace CDN에서 모델 다운로드 (~10MB)
2. 이후: 브라우저 캐시 사용 (Cache API)
3. ProgressBar로 다운로드 진행률 표시

---

## 성능 목표

> 모델 다운로드 시간은 유저 네트워크에 달려 있어 SLA로 보장 불가. "X초 이내"가 아닌 **UX 목표**로 정의한다.

| 환경 | UX 목표 |
|------|---------|
| 첫 방문 (모델 다운로드) | ProgressBar로 진행률 표시, 완료 전까지 버튼 비활성 |
| 재추론 (모델 캐시 후) | 체감상 빠름 (목표: 3초 이내, 기기·이미지 크기 의존) |
| 언어 전환 (재추론 없음) | 즉시 (Canvas만 재렌더) |

---

## 에러 처리

| 케이스 | 처리 |
|--------|------|
| 모델 로드 실패 | ERROR 메시지 + 재시도 버튼 |
| 추론 실패 | ERROR 메시지 + 다른 이미지 시도 안내 |
| 감지 결과 없음 | "객체를 감지하지 못했습니다" 안내 |
| WebGPU 미지원 | CPU fallback (Transformers.js 자동 처리) |
