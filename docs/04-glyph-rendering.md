# 글리프 렌더링 — fillRegionWithGlyph

## 목표

각 얼굴 영역 마스크를 해당 영역의 이름 텍스트로 빽빽하게 채운다:
- 피부 → "FACE" (연두)
- 눈썹 → "BROW" (노랑)
- 코 → "NOSE" (하늘)
- 입술 → "LIPS" (핑크)
- 흰자 → "EYE" (밝은 회색)
- 홍채 → "IRIS" (파랑)

---

## 실패한 접근들과 그 이유

### 시도 1: 중앙 샘플링 체크 + fillText

```ts
// 글자 중앙 픽셀이 마스크 안에 있을 때만 그린다
if (mask[sampleRow * analysisWidth + sampleCol] === 0) continue;
ctx.fillText(text, drawX, drawY);
```

**문제**: `fillText`는 마스크 범위를 넘어서 그려진다. 중앙 픽셀만 체크하고 그리면 글자의 절반이 다른 영역을 침범한다. 특히 피부(FACE) 글자가 눈썹/코/입 위에 그려져 덮어버렸다.

### 시도 2: ctx.clip() + 폴리곤 클리핑

```ts
ctx.beginPath();
indices.forEach(...);
ctx.clip();
ctx.fillText(text, drawX, drawY);
```

**문제**: `clip()`은 폴리곤 경계로만 자른다. 피부 마스크(skinMask)는 폴리곤이 아니라 "faceOval에서 눈썹/코/입/눈을 뺀" 구멍 뚫린 마스크다. 이 마스크는 단일 폴리곤으로 표현할 수 없으므로 clip()이 구멍 부분을 처리하지 못한다.

### 시도 3: 전체 Canvas 크기 OffscreenCanvas + putImageData

```ts
// displayWidth × displayHeight 크기 offscreen에 글자 그린 뒤
// 픽셀 루프로 마스크 AND 연산 → putImageData
```

**문제 1**: `putImageData`는 기존 Canvas 픽셀을 **덮어쓴다**. 이전 레이어(피부 글리프)가 지워졌다.  
**문제 2**: 전체 Canvas 크기(예: 2000×3000)를 픽셀 루프하면 6,000,000 픽셀 × 9개 레이어 = 54,000,000번 반복. 성능 문제.  
**문제 3**: R채널 기반 마스크 체크의 노이즈 픽셀 문제(위 문서 참조)로 배경에 점이 찍혔다.

---

## 최종 알고리즘: Bounding Box 소형 Canvas + destination-in

### 핵심 아이디어

전체 Canvas 크기의 OffscreenCanvas 대신, **마스크의 bounding box 크기만큼의 소형 Canvas**를 만든다. 이렇게 하면:
1. 마스크 외부 픽셀이 Canvas에 존재 자체를 하지 않으므로 노이즈 원천 제거
2. 픽셀 루프 범위가 영역 크기로 한정되어 성능 대폭 개선
3. `destination-in` 합성으로 마스크를 정확히 적용

### destination-in이란

Canvas 2D globalCompositeOperation의 하나:
- 기존(destination) 픽셀의 alpha = 기존 alpha × 새로운(source) alpha
- 마스크(흰색=alpha 255)가 source, 글자 그리드가 destination
- 마스크 흰 영역: 글자 보존 (255 × 255/255 = 255)
- 마스크 투명 영역: 글자 삭제 (255 × 0/255 = 0)

결과: **글자가 마스크 모양대로 정확히 잘린다.**

### 구현

```ts
const fillRegionWithGlyph = (
  ctx: CanvasRenderingContext2D,
  mask: Uint8ClampedArray,
  analysisWidth: number, analysisHeight: number,
  displayWidth: number, displayHeight: number,
  text: string, color: string, targetRows: number,
): void => {
  // 1. 마스크 bounding box 계산 (analysis 좌표)
  let minRow = analysisHeight, maxRow = -1, minCol = analysisWidth, maxCol = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) continue;
    const row = Math.floor(i / analysisWidth);
    const col = i % analysisWidth;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
  }
  if (maxRow === -1) return;

  // 2. bounding box → display 픽셀 좌표
  const scaleX = displayWidth / analysisWidth;
  const scaleY = displayHeight / analysisHeight;
  const boxX = Math.floor(minCol * scaleX);
  const boxY = Math.floor(minRow * scaleY);
  const boxW = Math.ceil((maxCol + 1) * scaleX) - boxX;
  const boxH = Math.ceil((maxRow + 1) * scaleY) - boxY;

  // 3. fontSize 결정: bounding box 높이 ÷ targetRows
  const fontSize = Math.max(4, Math.round(boxH / targetRows));

  // 4. glyphCanvas: boxW×boxH 크기로 글자 그리드 그림
  const glyphCanvas = new OffscreenCanvas(boxW, boxH);
  const glyphCtx = glyphCanvas.getContext('2d')!;
  glyphCtx.font = `bold ${fontSize}px monospace`;
  glyphCtx.fillStyle = color;
  glyphCtx.textBaseline = 'top';
  const textWidth = glyphCtx.measureText(text).width;
  const stepX = textWidth * 1.1;
  const stepY = fontSize * 1.15;
  for (let y = 0; y < boxH + stepY; y += stepY) {
    for (let x = 0; x < boxW + stepX; x += stepX) {
      glyphCtx.fillText(text, x, y);
    }
  }

  // 5. maskCanvas: bounding box 범위의 마스크를 display 픽셀로 확장
  const maskCanvas = new OffscreenCanvas(boxW, boxH);
  const maskCtx = maskCanvas.getContext('2d')!;
  const maskImageData = maskCtx.createImageData(boxW, boxH);
  for (let dy = 0; dy < boxH; dy++) {
    const ay = Math.min(analysisHeight - 1, Math.floor((boxY + dy) / scaleY));
    for (let dx = 0; dx < boxW; dx++) {
      const ax = Math.min(analysisWidth - 1, Math.floor((boxX + dx) / scaleX));
      if (mask[ay * analysisWidth + ax] > 0) {
        const offset = (dy * boxW + dx) * 4;
        maskImageData.data[offset]     = 255;
        maskImageData.data[offset + 1] = 255;
        maskImageData.data[offset + 2] = 255;
        maskImageData.data[offset + 3] = 255;
      }
    }
  }
  maskCtx.putImageData(maskImageData, 0, 0);

  // 6. destination-in으로 글자를 마스크 안에만 남김
  glyphCtx.globalCompositeOperation = 'destination-in';
  glyphCtx.drawImage(maskCanvas, 0, 0);

  // 7. 정확한 위치에 display Canvas에 올림
  ctx.drawImage(glyphCanvas, boxX, boxY);
};
```

### targetRows 파라미터

각 영역의 글자 크기를 결정하는 핵심 파라미터다. `boxH / targetRows`가 fontSize가 된다.

- 값이 클수록 → fontSize 작아짐 → 글자 빽빽해짐
- 값이 작을수록 → fontSize 커짐 → 글자 성김

각 영역별 현재 설정:

| 영역 | targetRows | 이유 |
|------|-----------|------|
| 피부(FACE) | 20 | 넓은 영역, 작은 글자로 빽빽하게 |
| 눈썹(BROW) | 3 | 높이가 20~30px으로 매우 납작함 |
| 코(NOSE) | 6 | 중간 크기 영역 |
| 입술(LIPS) | 4 | 가로로 넓고 세로가 짧음 |
| 흰자(EYE) | 2 | 매우 작은 영역 |
| 홍채(IRIS) | 2 | 매우 작은 원형 영역 |

---

## 렌더링 레이어 합성

글리프 레이어는 검정 배경 없이 원본 이미지 위에 올라간다:

```ts
// 원본 이미지를 50% 투명도로 깔음
ctx.drawImage(img, 0, 0);
ctx.globalAlpha = 0.5;
ctx.fillStyle = '#000000';
ctx.fillRect(0, 0, W, H);
ctx.globalAlpha = 1.0;

// 글리프 레이어들을 순서대로 올림 (피부 → 눈썹 → ... → 홍채)
fillRegionWithGlyph(ctx, skinMask, ...);
fillRegionWithGlyph(ctx, rightEyebrowMask, ...);
// ...
```

렌더링 순서가 중요하다. 나중에 그려진 레이어가 위에 올라간다. 피부를 먼저 그리고 세부 영역(눈썹, 코, 입, 눈)을 위에 올려야 피부 글자가 세부 영역을 덮지 않는다.

`ctx.drawImage(glyphCanvas, boxX, boxY)`는 기본 `source-over` 합성 모드로 동작하므로 이전 레이어를 덮어쓰지 않고 누적된다.
