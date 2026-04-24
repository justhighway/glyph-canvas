# 디버깅 히스토리 — 문제 발생과 해결 과정

이 문서는 개발 과정에서 발생한 주요 버그와 그 원인 분석, 해결 방법을 기록한다. 같은 실수를 반복하지 않기 위한 기록이다.

---

## 버그 1: 컨투어 인덱스 오류 (눈썹, 코)

### 증상
눈썹 폴리곤이 이상한 형태로 그려졌다. 코 폴리곤이 뺨 영역까지 내려갔다.

### 원인
MediaPipe의 `FACE_LANDMARKS_*` 상수에서 엣지를 추출하는 방식으로 인덱스를 수집했는데, 엣지 배열은 **그래프 형태**라 순서가 보장되지 않는다. `extractChainsFromEdges` 함수로 체인을 구성하려 했으나, 눈썹처럼 양 끝이 있는 열린 선에서 end node가 4개(2개 체인 × 2 끝점)로 나와 조건 `chains.length !== 2`가 실패했다.

코 인덱스 중 일부(294, 278, 344, 440, 275)가 뺨 영역 랜드마크였다.

### 해결
1. **디버그 dot 시각화**: 각 랜드마크 인덱스에 순서 번호를 dot으로 표시해 실제 위치를 눈으로 확인
2. **Tesselation 인접 그래프 분석**: Node.js 스크립트로 MediaPipe Tesselation 엣지에서 코 외곽 경로를 BFS로 추출
3. 모든 컨투어를 **하드코딩된 올바른 순서 배열**로 교체

---

## 버그 2: Selfie Segmentation 측면 얼굴 실패

### 증상
정면 얼굴의 FACE_OVAL이 측면 얼굴에서 찌그러진 타원으로 나왔다. 더 정확한 얼굴 외곽을 위해 MediaPipe ImageSegmenter(selfie_segmenter 모델)로 교체를 시도했다.

### 시도한 방법들 (전부 실패)
1. **BFS flood fill** (코끝에서 시작): 얼굴과 목·어깨가 모두 연결된 픽셀이라 분리 불가
2. **Row-by-row left/right scan**: 박스 형태가 나옴, 측면 얼굴 포함 안 됨
3. **FACE_OVAL AND 마스크**: FACE_OVAL 자체가 측면에서 틀림
4. **Square tracing (Jacob's algorithm)**: 전체 인물 실루엣이 추적됨 (목·어깨 포함)
5. **Y cutoff** (턱 아래 배경 처리): 그림자 영역도 포함, 여전히 어깨 잡힘

### 원인
`selfie_segmenter` 모델은 얼굴만이 아니라 **사람 전체 실루엣**을 세그멘테이션한다. 얼굴과 목·어깨가 연결된 픽셀 덩어리이므로 어떤 후처리로도 얼굴만 분리하기 어렵다.

### 결론
FACE_OVAL 한계를 인정하고 유지. 측면 얼굴 정확도 개선은 추후 Gemini Vision API로 해결 예정.

---

## 버그 3: 마스크 bounding box가 이미지 전체 크기로 잡힘

### 증상
```
r-brow: pixels=609, bbox=(col:2~396, row:30~594), h=565
```
눈썹 마스크 픽셀은 609개뿐인데 bounding box 높이가 565px (이미지 거의 전체).

이로 인해 `fillRegionWithGlyph`에서 `boxH = 565px`, `targetRows = 3` → `fontSize = 188px`. 눈썹 영역에 글자 1~2개만 들어갔다.

### 원인
**R채널 기반 마스크 체크 + OffscreenCanvas 안티앨리어싱 아티팩트**

`createPolygonMask`에서 `mask[i] = imageData.data[i * 4]` (R채널)을 읽었다. OffscreenCanvas GPU 렌더링 과정에서 폴리곤 외부 픽셀임에도 R=1~5 수준의 서브픽셀 아티팩트가 이미지 전체에 산발적으로 생겼다. `> 0` 체크를 하면 이 픽셀들이 모두 마스크로 잡혀 bounding box가 이미지 전체가 됐다.

### 디버깅 과정
1. 각 마스크의 픽셀 수와 bounding box를 콘솔 출력
2. 예상 범위 밖 픽셀의 좌표를 샘플링해 출력
3. 이상 픽셀들이 이미지 전체에 **랜덤하게** 분포 → 폴리곤 self-intersecting이 아니라 안티앨리어싱 아티팩트로 판단

### 해결
```ts
// 변경 전
mask[i] = imageData.data[i * 4];          // R채널, > 0 체크

// 변경 후
mask[i] = imageData.data[i * 4 + 3] > 128 ? 255 : 0;  // alpha 채널, 임계값 128
```

alpha 채널 기준으로 변경 후 모든 outlier 픽셀이 사라졌다:
```
[outlier:r-brow] 없음 (정상)
r-brow: pixels=451, bbox=(col:110~159, row:170~191), h=22, w=50
```

---

## 버그 4: 글리프가 다른 영역을 침범

### 증상
"FACE" 글자가 눈썹/코/입 위에 그려져 덮어버렸다.

### 원인
`fillText`는 Canvas에 글자를 그대로 그린다. 마스크 중앙 픽셀 체크(`if mask[sampleRow][sampleCol] === 0 → continue`)를 해도, 글자 자체는 중앙에서 시작해 양쪽으로 퍼지므로 마스크 경계를 넘어간다.

### 시도한 해결 (실패): ctx.clip()
폴리곤 클리핑으로 글자를 잘랐다. 피부처럼 구멍 뚫린 마스크는 단일 폴리곤으로 표현 불가. clip이 구멍을 처리하지 못했다.

### 최종 해결: destination-in 합성
글자를 bounding box 크기 OffscreenCanvas에 자유롭게 그린 뒤, 마스크와 `destination-in` 합성으로 마스크 밖 픽셀을 정확히 제거. 상세 내용은 `04-glyph-rendering.md` 참조.

---

## 버그 5: putImageData가 이전 레이어를 덮어씀

### 증상
피부(FACE) 글리프만 보이고 그 위에 눈썹/코/입이 그려지지 않았다.

### 원인
`ctx.putImageData(glyphData, 0, 0)`은 전체 ImageData를 Canvas에 **덮어쓴다**. 이전에 그린 피부 레이어가 지워졌다.

### 해결
`putImageData`를 별도 OffscreenCanvas에 올린 뒤 `ctx.drawImage(compositeCanvas, 0, 0)`으로 변경. `drawImage`는 `source-over` 합성으로 기존 픽셀 위에 누적된다.

최종적으로 bounding box 소형 Canvas + `ctx.drawImage(glyphCanvas, boxX, boxY)` 방식으로 이 문제를 원천 해결했다.

---

## 핵심 교훈

1. **마스크 생성 시 alpha 채널을 써야 한다.** R채널은 안티앨리어싱 아티팩트에 취약하다.
2. **clip()은 단순 폴리곤에만 유효하다.** 구멍 뚫린 마스크에는 destination-in 합성을 써야 한다.
3. **putImageData는 누적이 아니라 덮어쓰기다.** 레이어 합성이 필요하면 drawImage를 써야 한다.
4. **전체 Canvas 크기 OffscreenCanvas는 쓰지 않는다.** bounding box 크기의 소형 Canvas가 성능과 정확도 모두에서 낫다.
5. **구현 전에 마스크 디버그를 먼저 해야 한다.** 마스크가 틀리면 렌더링 로직이 아무리 맞아도 결과가 이상하다.
