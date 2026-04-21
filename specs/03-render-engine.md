# Spec 03 — Canvas 렌더 엔진

## 핵심 알고리즘: 마스크 영역에 글자 채우기

### 전체 흐름

```
Detection[] + Language
      ↓
1. 원본 이미지를 Canvas에 그리기 (배경)
2. Detection마다:
   a. 마스크에서 채울 수 있는 픽셀 좌표 샘플링
   b. 해당 영역의 평균 색상 추출
   c. 글자 크기 결정 (영역 면적 기반)
   d. 좌표 그리드에 글자 반복 배치
3. 결과 Canvas 반환
```

---

## 세부 구현 명세

### 1. 마스크 샘플링

```ts
// mask: Uint8ClampedArray (원본 이미지 픽셀 수와 동일 크기)
// mask[i] > 0 이면 해당 픽셀이 객체에 속함

function sampleMaskPixels(
  mask: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  sampleStep: number   // 성능을 위해 전체 픽셀 말고 N픽셀마다 샘플
): Point[] {
  // mask[y * imageWidth + x] > 128 인 좌표만 수집
}
```

### 2. 평균 색상 추출

```ts
function getAverageColor(
  imageData: ImageData,
  maskPixels: Point[]
): RGB {
  // 마스크 픽셀들의 R,G,B 평균
  // 결과를 약간 진하게 (채도 올림) → 글자가 더 선명하게 보임
}
```

### 3. 글자 크기 결정

```ts
function calcFontSize(maskPixelCount: number, imageArea: number): number {
  // 영역 비율 = maskPixelCount / imageArea
  // 비율 0~5%   → 8~12px
  // 비율 5~15%  → 12~18px
  // 비율 15~30% → 18~28px
  // 비율 30%+   → 28~40px
  // 최소 8px, 최대 40px 클램핑
}
```

### 4. 글자 그리드 배치

```ts
function placeTextInMask(
  ctx: CanvasRenderingContext2D,
  label: string,       // 배치할 글자 (다국어)
  maskPixels: Point[], // 채울 수 있는 좌표들
  color: RGB,
  fontSize: number
): void {
  // 전략: 그리드 방식
  // 1. maskPixels의 bounding box 계산 (minX, minY, maxX, maxY)
  // 2. fontSize + gap(2px) 간격으로 그리드 생성
  // 3. 각 그리드 좌표가 mask 내부인지 확인
  // 4. 내부이면 fillText 호출
  //
  // 배경 대비: 흰 텍스트 shadow or 배경색 반전 적용
}
```

---

## use-canvas-render 훅 명세

### 파일: `src/hooks/use-canvas-render.ts`

```ts
type UseCanvasRenderProps = {
  canvasRef: RefObject<HTMLCanvasElement>
  imageFile: File | null
  segmentationResult: SegmentationResult | null
  language: Language
}

type UseCanvasRenderReturn = {
  isRendering: boolean
  render: () => void   // 명시적 트리거 (언어 변경 시 재호출)
}
```

**규칙:**
- `language` 변경 시 재추론 없이 Canvas만 다시 그림
- `segmentationResult` 변경 시 자동으로 render() 호출
- 렌더링은 `requestAnimationFrame` 안에서 실행

---

## 순수 함수 모듈: `src/lib/text-placer.ts`

이 파일의 함수들은 **모두 순수 함수** (Canvas 직접 접근 없음, 테스트 용이).

```ts
export function sampleMaskPixels(mask, width, height, step): Point[]
export function getAverageColor(imageData, pixels): RGB
export function calcFontSize(pixelCount, totalArea): number
export function buildTextGrid(bbox, fontSize, gap): Point[]
export function filterGridByMask(grid, mask, width): Point[]
```

Canvas 조작은 `use-canvas-render.ts` 훅에서만 수행.

---

## 다국어 글자 맵 (`constants/coco-labels.ts`)

```ts
type Language = 'ko' | 'en' | 'ja'

type CocoLabelMap = Record<string, Record<Language, string>>

const COCO_LABELS: CocoLabelMap = {
  person:     { ko: '사람', en: 'PERSON', ja: '人' },
  dog:        { ko: '개',   en: 'DOG',    ja: '犬' },
  cat:        { ko: '고양이', en: 'CAT',  ja: '猫' },
  car:        { ko: '자동차', en: 'CAR',  ja: '車' },
  sky:        { ko: '하늘', en: 'SKY',    ja: '空' },
  // ... 80개 전체
}

export function getLabel(cocoClass: string, lang: Language): string {
  return COCO_LABELS[cocoClass]?.[lang] ?? cocoClass.toUpperCase()
}
```

---

## 렌더링 품질 옵션 (Nice to Have)

```ts
type RenderOptions = {
  fontSize: 'auto' | number     // auto: calcFontSize 사용
  fontFamily: string            // 기본: 'Noto Sans KR'
  textDensity: 'dense' | 'normal' | 'sparse'  // 글자 간격
  colorMode: 'original' | 'monochrome' | 'inverted'
}
```
