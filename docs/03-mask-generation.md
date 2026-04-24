# 마스크 생성 — createPolygonMask

## 마스크란

마스크(mask)는 이미지와 동일한 크기의 1채널 배열이다. 각 픽셀 위치에 대해:
- 255: 해당 영역 **내부**
- 0: 해당 영역 **외부**

이 프로젝트에서는 `Uint8ClampedArray(width * height)`를 마스크로 사용한다. 픽셀 인덱스 계산: `mask[row * width + col]`.

---

## createPolygonMask 구현

```ts
const createPolygonMask = (
  indices: number[],
  landmarks: { x: number; y: number }[],
  imageWidth: number,
  imageHeight: number,
): Uint8ClampedArray => {
  const offscreen = new OffscreenCanvas(imageWidth, imageHeight);
  const ctx = offscreen.getContext('2d')!;
  ctx.fillStyle = 'white';
  ctx.beginPath();
  indices.forEach((index, i) => {
    const x = landmarks[index].x * imageWidth;
    const y = landmarks[index].y * imageHeight;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  const imageData = ctx.getImageData(0, 0, imageWidth, imageHeight);
  const mask = new Uint8ClampedArray(imageWidth * imageHeight);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = imageData.data[i * 4 + 3] > 128 ? 255 : 0;
  }
  return mask;
};
```

### 왜 OffscreenCanvas를 쓰는가

Canvas 2D API의 `fill()`은 폴리곤 내부를 채우는 가장 단순하고 빠른 방법이다. 직접 픽셀 루프로 "이 점이 폴리곤 안인가"를 계산하려면 ray casting 알고리즘이 필요한데, Canvas fill이 이를 GPU에서 처리한다.

`OffscreenCanvas`는 DOM에 연결되지 않은 캔버스다. 화면에 표시할 필요 없이 픽셀 데이터만 읽을 때 사용한다.

### 왜 alpha 채널을 읽는가 (핵심 버그 수정)

초기 구현에서는 R채널을 읽었다:
```ts
mask[i] = imageData.data[i * 4]; // R채널
```

문제: `fillStyle = 'white'`로 채우면 내부 픽셀은 RGBA=(255,255,255,255)다. 그런데 Canvas 2D는 폴리곤 경계에 **안티앨리어싱**을 적용한다. 경계 픽셀은 alpha=1~127의 반투명 픽셀이 되는데, 이때 RGB는 여전히 (255,255,255)다. R채널만 읽으면 이 반투명 경계 픽셀도 255로 잡힌다.

더 심각한 문제: OffscreenCanvas GPU 렌더링 과정에서 **폴리곤 외부임에도 R=1~5 수준의 미세한 서브픽셀 아티팩트**가 전체 이미지에 산발적으로 찍혔다. R채널 기준 `> 0` 체크를 하면 이 노이즈 픽셀이 모두 마스크로 들어가, 배경 전체에 글자 점이 찍히는 현상이 발생했다.

**해결**: alpha 채널 기준으로 변경 + 임계값 128 적용:
```ts
mask[i] = imageData.data[i * 4 + 3] > 128 ? 255 : 0;
```

- 내부 픽셀: alpha=255 → 255 (마스크 내부)
- 경계 반투명 픽셀: alpha=1~127 → 0 (마스크 외부로 처리)
- 외부 픽셀: alpha=0 → 0 (마스크 외부)

이 수정으로 배경 노이즈가 완전히 사라졌다.

---

## 피부 마스크 생성

피부는 독립적인 폴리곤이 없다. 얼굴 외곽(FACE_OVAL) 안에서 세부 영역(눈썹, 코, 입, 눈)을 제외한 나머지가 피부다.

```ts
const skinMask = new Uint8ClampedArray(analysisWidth * analysisHeight);
for (let i = 0; i < faceOvalMask.length; i++) {
  if (
    faceOvalMask[i] > 0 &&
    rightEyebrowMask[i] === 0 &&
    leftEyebrowMask[i] === 0 &&
    noseMask[i] === 0 &&
    lipsMask[i] === 0 &&
    rightEyeMask[i] === 0 &&
    leftEyeMask[i] === 0
  ) {
    skinMask[i] = 255;
  }
}
```

픽셀 인덱스 기준으로 Boolean AND 연산이므로 좌표 변환 없이 직접 마스크 배열끼리 비교한다.

---

## 홍채/흰자 분리 — splitIrisAndSclera

눈 개구부(eye aperture) 마스크 안에서 홍채와 흰자를 분리한다.

### 왜 별도 알고리즘이 필요한가

MediaPipe는 눈 개구부 폴리곤은 제공하지만, 홍채와 흰자를 별도 폴리곤으로 분리해주지 않는다. 홍채 랜드마크(468~477)는 중심 + 4방향 포인트로 구성되어 있어 원형 근사가 가능하다.

### 알고리즘: 랜드마크 기하 + BFS 혼합

두 가지 정보를 조합한다:

**1. 홍채 랜드마크에서 x 중심과 반지름 추출**
```ts
// 좌우 포인트 간 거리의 절반 = 반지름
const dx = (p_right.x - p_left.x) * imageWidth;
const dy = (p_right.y - p_left.y) * imageHeight;
const radius = Math.sqrt(dx * dx + dy * dy) / 2;
```
x 중심과 반지름은 눈꺼풀의 영향을 덜 받아 정확하다.

**2. BFS로 어두운 픽셀 클러스터의 y 중심 추출**

눈 개구부 마스크 안에서 luminance 하위 35%를 "어두운 픽셀"로 분류하고, BFS로 가장 큰 연결 클러스터를 찾아 y 무게중심을 계산한다.

- 하위 35%를 쓰는 이유: 홍채는 눈 전체 면적의 절반 이하이므로, 50%로 자르면 흰자·눈꺼풀 피부가 포함된다.
- y 무게중심은 화장·그림자가 있어도 비교적 안정적이다.

**3. x·반지름은 랜드마크, y는 BFS 무게중심으로 조합**

```ts
// 원형 홍채 마스크 생성
for (let i = 0; i < mask.length; i++) {
  if (mask[i] === 0) continue;
  const x = i % imageWidth;
  const y = Math.floor(i / imageWidth);
  const dx = x - centerX;
  const dy = y - centerY;
  if (dx * dx + dy * dy <= radius * radius) {
    irisMask[i] = 255;
  }
}
// 눈 개구부 안에서 홍채 원 밖 = 흰자
for (let i = 0; i < mask.length; i++) {
  if (mask[i] > 0 && irisMask[i] === 0) scleraMask[i] = 255;
}
```

홍채를 원으로 표현하는 이유: BFS 클러스터 자체를 홍채 마스크로 쓰면 눈꺼풀 그림자가 붙어있을 때 불규칙한 모양이 된다. 원형 근사가 아트 결과물로 더 깔끔하다.
