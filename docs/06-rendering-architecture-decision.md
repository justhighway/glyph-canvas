# 렌더링 아키텍처 의사결정 — Canvas 2D → WebGL2

## 배경

프로토타입 단계에서 글리프 렌더링은 Canvas 2D API의 `fillText()`를 JS 루프로 반복 호출하는 방식으로 구현됐다. 600px 분석 해상도의 정적 이미지에서는 문제가 없었지만, 다음 두 가지 요구사항이 확정되면서 아키텍처 재검토가 필요해졌다.

1. **고해상도 정적 이미지 지원**: 4K~8K급 원본 해상도 그대로 렌더링
2. **실시간 영상 처리**: 30fps로 매 프레임 글리프 렌더링

이 문서는 Canvas 2D, WebGL2, WebGPU 세 가지 선택지를 검토하고 최종적으로 **WebGL2 Instanced Rendering**을 채택하게 된 근거와 트레이드오프를 기록한다.

---

## 현재 구현 방식 (Canvas 2D) 상세

### 동작 방식

```
fillRegionWithGlyph() 호출 1회 (예: 피부 영역)
    ↓
bounding box 계산 (JS 루프, O(픽셀 수))
    ↓
OffscreenCanvas(boxW × boxH) 생성
    ↓
for y in rows:
    for x in cols:
        fillText(text, x, y)   ← JS → 브라우저 렌더링 엔진 호출
    ↓
maskCanvas 생성 + putImageData (JS 픽셀 루프)
    ↓
destination-in 합성
    ↓
ctx.drawImage()
```

`fillText()` 1회 호출은 브라우저 내부적으로 폰트 래스터라이징 → 픽셀 그리기 과정을 거친다. 이 과정이 JS 싱글스레드에서 직렬로 실행된다.

### 성능 측정

`fillText()` 1회 = 약 0.01~0.02ms (브라우저, 폰트 크기에 따라 다름)

| 시나리오 | 글리프 수 | 예상 렌더링 시간 |
|---|---|---|
| 600px 정적 이미지 (현재) | ~3,000개 | ~30~60ms |
| 4K 정적 이미지 (2160p) | ~50,000개 | ~500~1,000ms |
| 8K 정적 이미지 | ~200,000개 | ~2,000~4,000ms |
| 실시간 30fps (600px) | 매 프레임 3,000개 | 33ms 예산의 90% 이상 소모 |

**근본 원인**: `fillText()`는 CPU 기반 렌더링이다. GPU를 활용하지 않는다. 글리프 수에 비례해 선형으로 느려지며, 해상도가 올라갈수록 이 한계가 더 빠르게 드러난다.

---

## 선택지 검토

### 선택지 A: Canvas 2D (현재 방식 유지)

**장점**
- 구현이 단순하다. `fillText()`, `drawImage()` 등 직관적인 API.
- 폰트 렌더링을 브라우저가 알아서 처리한다. 한국어/일본어 등 유니코드 지원이 자동.
- 디버깅이 쉽다.

**단점**
- JS 싱글스레드 병목. 글리프 수가 늘어날수록 선형으로 느려짐.
- 4K 이상에서 탭 프리즈 불가피.
- 실시간 30fps 불가능. MediaPipe 추론에 이미 ~20ms가 소요되는데, 그 위에 Canvas 2D 렌더링이 33ms를 넘으면 프레임 드롭.

**결론**: 현재 요구사항을 충족하지 못한다. 최적화 여지가 없는 구조적 한계.

---

### 선택지 B: Canvas 2D + Web Worker

Canvas 2D 렌더링을 메인 스레드 밖 Worker로 옮기는 방식. OffscreenCanvas를 Worker에 전달해 렌더링한다.

**장점**
- 메인 스레드 블로킹 해결. UI가 멈추지 않음.
- Canvas 2D 로직을 그대로 유지.

**단점**
- 렌더링 자체의 속도는 전혀 개선되지 않는다. Worker도 JS 단일 스레드.
- 실시간 30fps에서는 Worker 안에서도 프레임 예산을 초과.
- Worker ↔ 메인 스레드 간 데이터 전달(마스크 배열, ImageBitmap) 오버헤드 추가.

**결론**: UI 반응성은 개선되지만 핵심 성능 문제(글리프 수 × 렌더링 시간)는 해결되지 않는다. 보조 기법이지 아키텍처 해법이 아니다.

---

### 선택지 C: WebGL2 Instanced Rendering

**개념**: GPU의 병렬 처리 능력을 직접 활용한다. "인스턴싱(instancing)"은 같은 형태(글리프 사각형)를 다른 위치에 수천 번 그릴 때, 각 인스턴스의 위치·색상 데이터를 Float32Array로 한 번에 GPU에 전송하고 1번의 draw call로 모두 그리는 기법이다.

**동작 방식**

```
폰트 아틀라스 생성 (OffscreenCanvas → GPU texture, 1회)
    ↓
글리프 인스턴스 위치 계산 (CPU, Float32Array)
    ↓
마스크 데이터를 GPU texture로 업로드 (Uint8Array → texture)
    ↓
gl.drawArraysInstanced(TRIANGLE_STRIP, 0, 4, instanceCount)
    ← GPU가 instanceCount개 글리프를 병렬로 처리
    ↓
fragment shader에서 마스크 texture 참조 → 마스크 밖 픽셀 discard
```

Canvas 2D가 `fillText()` N번을 직렬 실행하는 반면, WebGL2는 N개 인스턴스를 GPU 코어들이 병렬로 처리한다.

**성능 예측**

| 시나리오 | 글리프 수 | 예상 렌더링 시간 |
|---|---|---|
| 600px 정적 이미지 | ~3,000개 | ~2~5ms |
| 4K 정적 이미지 | ~50,000개 | ~5~15ms |
| 8K 정적 이미지 | ~200,000개 | ~15~30ms |
| 실시간 30fps (600px) | 매 프레임 3,000개 | ~2~5ms |

실시간 시나리오에서 MediaPipe(~20ms) + 마스크 생성(~5ms) + WebGL2 렌더링(~5ms) = ~30ms. 33ms 예산 안에 들어온다.

**장점**
- 글리프 수에 비례한 선형 증가가 없다. GPU 병렬 처리.
- 마스크 적용을 fragment shader에서 처리해 CPU 픽셀 루프 제거.
- 실시간 30fps 대응 가능.

**단점**
- 폰트 렌더링을 직접 구현해야 한다. 브라우저가 `fillText()`로 처리해주던 것을 font atlas + UV mapping + shader로 구현.
- 한국어/일본어 등 비ASCII 문자는 글리프 수가 많아 atlas 설계가 복잡해진다.
- GLSL shader 코드 작성 필요. 러닝 커브 존재.
- 초기 구현 비용이 높다.

**브라우저 지원**: Chrome, Firefox, Safari, Edge 모두 WebGL2를 지원한다. (Firefox 기준 2017년부터 지원)

---

### 선택지 D: WebGPU

WebGL2보다 더 현대적인 GPU API. Metal, Vulkan, DirectX 12의 설계 철학을 웹에 가져온 것이다.

**WebGL2 대비 기술적 우위**
- Compute shader: 마스크 처리, 색상 샘플링 등 범용 GPU 연산 가능
- 더 낮은 드라이버 오버헤드, 명시적 자원 관리
- GPUDevice를 Web Worker에서 사용 가능 → 진정한 멀티스레드 렌더링
- 웹 GPU API의 장기 표준 방향

**결정적 단점: Firefox 미지원 (2026년 4월 기준)**

| 브라우저 | WebGPU 지원 상태 |
|---|---|
| Chrome 113+ | ✅ 정식 지원 |
| Edge 113+ | ✅ 정식 지원 |
| Safari 18+ | ✅ 정식 지원 (일부 기능 제한) |
| Firefox | ❌ 미지원 (플래그로만 실험적 활성화 가능) |

Firefox 점유율은 약 3~4%다. 절대적 수치는 낮지만, 프로덕션 웹앱에서 특정 브라우저를 완전히 배제하는 결정은 별도의 비즈니스 근거가 필요하다.

**추가 고려사항**
- MediaPipe가 이미 WebGL 컨텍스트를 점유하고 있다. WebGPU 컨텍스트와 공존 시 GPU 자원 관리 복잡도가 증가한다.
- Compute shader의 이점(마스크 GPU 처리)은 실제로 활용하려면 MediaPipe 출력 포맷을 WebGPU buffer 포맷에 맞추는 추가 설계가 필요하다. 현재 구조에서 바로 쓸 수 있는 이점이 아니다.
- 이 프로젝트의 성능 요구사항(30fps, 4K)은 WebGL2로 이미 충족된다. WebGPU를 써야만 달성 가능한 성능 목표가 없다.

**결론**: 기술적 방향성은 맞지만, 브라우저 지원 공백과 이 프로젝트 규모에서 실제 이점이 없다는 점에서 시기상조다. Firefox가 정식 지원하거나, Compute shader 없이는 해결 안 되는 병목이 생길 때 재검토한다.

---

## 선택지 종합 비교

| 기준 | Canvas 2D | Canvas 2D + Worker | WebGL2 | WebGPU |
|---|:---:|:---:|:---:|:---:|
| 4K 정적 이미지 성능 | ❌ | △ | ✅ | ✅ |
| 실시간 30fps | ❌ | ❌ | ✅ | ✅ |
| Firefox 지원 | ✅ | ✅ | ✅ | ❌ |
| 구현 복잡도 | 낮음 | 중간 | 높음 | 매우 높음 |
| 장기 유지보수 | 단순하나 확장 불가 | 단순하나 확장 불가 | 중간 | 낮음 (API 안정화 후) |
| 현재 요구사항 충족 | ❌ | ❌ | ✅ | ✅ |

---

## 최종 결정: WebGL2 Instanced Rendering

### 근거 요약

1. **실시간 30fps가 요구사항에 있는 순간 Canvas 2D는 선택지에서 제외된다.** 이건 최적화 문제가 아니라 CPU 기반 렌더링의 구조적 한계다.

2. **WebGPU는 Firefox 배제라는 명확한 단점이 있고, 이 프로젝트에서 실제로 필요한 Compute shader 이점이 아직 없다.** 기술적 우위가 실재하지만 지금 당장 필요한 이점이 아니다.

3. **Canvas 2D → WebGL2 전환을 나중으로 미룰수록 비용이 커진다.** 두 API는 패러다임이 완전히 다르기 때문에 점진적 마이그레이션이 어렵다. 코드베이스가 작은 지금 하는 것이 맞다.

4. **WebGL2 shader는 한 번 작성하면 이후 변경이 거의 없다.** 영역 추가·글리프 변경은 JS 레이어에서 처리되고 shader는 그대로다. 장기적으로 Canvas 2D 최적화 코드보다 오히려 유지보수가 단순하다.

---

## 기존 방식과의 구체적 차이

### 기존 (Canvas 2D)

```
CPU: JS 루프로 글리프 위치 계산
CPU: fillText() N번 직렬 호출 → 브라우저 렌더링 엔진
CPU: 픽셀 루프로 마스크 적용 (maskCanvas 픽셀 채우기)
CPU: destination-in 합성
```

병목: `fillText()` × N번, 마스크 픽셀 루프 × boxW×boxH

### 변경 후 (WebGL2)

```
CPU: 글리프 인스턴스 위치 Float32Array 계산 (1회)
CPU → GPU: 폰트 아틀라스 texture 업로드 (1회)
CPU → GPU: 마스크 texture 업로드 (1회, Uint8Array)
CPU → GPU: 인스턴스 버퍼 업로드 (1회, Float32Array)
GPU: drawArraysInstanced() → N개 인스턴스 병렬 처리
GPU: vertex shader — 각 인스턴스의 사각형 위치 계산
GPU: fragment shader — atlas에서 글자 alpha 읽기 + 마스크 texture에서 discard 여부 결정
```

병목: GPU texture 업로드 (해상도에 비례하지 않음), GPU 처리 (병렬)

### 변하지 않는 것

마스크 생성 파이프라인(createPolygonMask, splitIrisAndSclera)과 MediaPipe 추론 레이어는 그대로 유지된다. 렌더링 레이어만 교체된다. 인터페이스는 동일하게 유지한다:

```ts
// 기존
fillRegionWithGlyph(ctx, mask, analysisW, analysisH, W, H, 'FACE', '#4ade80', 20);

// 변경 후
glyphRenderer.renderRegion({ mask, analysisWidth, analysisHeight, displayWidth, displayHeight, text: 'FACE', color: '#4ade80', targetRows: 20 });
```

---

## 예상 결과

| 시나리오 | 기존 Canvas 2D | WebGL2 |
|---|---|---|
| 600px 정적 이미지 렌더링 | ~30~60ms | ~5~10ms |
| 4K 정적 이미지 렌더링 | ~500~1,000ms (탭 프리즈) | ~10~20ms |
| 실시간 30fps | 불가 (프레임 드롭) | 가능 (~5ms/프레임) |
| 메모리 사용 | 높음 (OffscreenCanvas 다수) | 낮음 (texture 재사용) |

---

## 재검토 조건

다음 상황이 되면 WebGPU로의 전환을 재검토한다:

- Firefox가 WebGPU를 정식 지원할 때
- Compute shader 없이는 해결할 수 없는 성능 병목이 실제로 측정될 때
- MediaPipe가 WebGPU 기반 추론을 공식 지원해 컨텍스트 공유 문제가 해소될 때
