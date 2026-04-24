'use client';

import { useEffect, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

type LoadingPhase = 'idle' | 'model-loading' | 'analyzing' | 'done' | 'error';

// ── 눈 개구부 ──────────────────────────────────────────────────────────────
// 위 눈꺼풀(33→133) + 아래 눈꺼풀(133→33) 순서로 닫힌 폴리곤
const RIGHT_EYE_CONTOUR = [
  33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7,
];
const LEFT_EYE_CONTOUR = [
  263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249,
];

// ── 눈썹 ──────────────────────────────────────────────────────────────────
// 디버그 이미지 확인 결과:
//   46→53→52→65→55: 눈썹 하단 라인 (안쪽→바깥)
//   70→63→105→66→107: 눈썹 상단 라인 (안쪽→바깥)
// 닫힌 폴리곤: 하단 순방향(46→55) + 상단 역방향(107→70)
// MediaPipe 눈썹은 10포인트뿐이라 세밀하지 않음 — 이건 모델 한계
const RIGHT_EYEBROW_CONTOUR = [46, 53, 52, 65, 55, 107, 66, 105, 63, 70];
const LEFT_EYEBROW_CONTOUR  = [276, 283, 282, 295, 285, 336, 296, 334, 293, 300];

// ── 입술 외곽 ─────────────────────────────────────────────────────────────
// FACE_LANDMARKS_LIPS에 외곽(61↔291)·내곽(78↔308) 두 루프가 섞여있다.
// 외곽 루프만 수동 추출:
//   위 외곽: 61→185→40→39→37→0→267→269→270→409→291
//   아래 외곽: 291→375→321→405→314→17→84→181→91→146→(61로 닫힘)
const LIPS_CONTOUR = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
  291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
];


// ── 얼굴 외곽 ─────────────────────────────────────────────────────────────
// FACE_OVAL 단일 루프 순서 (콘솔에서 확인된 실제 값)
const FACE_OVAL_CONTOUR = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
  54, 103, 67, 109,
];

// ── 코 ────────────────────────────────────────────────────────────────────
// Tesselation 인접 그래프에서 확인한 코 외곽 경로 (시계방향):
//
// 콧대: 168→6→197→195→5→4
// 코끝→우 콧볼: 4→45→220→218→115→131→48→64→98→97
// 인중 위: 97→2
// 좌 콧볼→코끝: 2→326→327→358→279→360→344→440→275
// 275→4 (closePath로 닫힘)
const NOSE_CONTOUR = [
  168, 6, 197, 195, 5, 4,       // 콧대
  45, 220, 218, 115, 131, 48, 64, 98, 97, // 우 콧볼
  2,                              // 인중 위
  326, 327, 358, 279, 360, 344, 440, 275, // 좌 콧볼
];


/**
 * 랜드마크 폴리곤으로 오프스크린 캔버스에 마스크를 생성한다.
 * 반환값: 폴리곤 내부 픽셀이 255, 외부가 0인 Uint8ClampedArray
 */
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
    // R채널 임계값 128: 안티앨리어싱 경계 픽셀(R=1~127)을 마스크 밖으로 처리한다.
    // R채널만 읽으면 alpha=0인 외부 픽셀도 R=255로 보이므로 alpha채널도 함께 확인한다.
    mask[i] = imageData.data[i * 4 + 3] > 128 ? 255 : 0;
  }
  return mask;
};

/**
 * iris 랜드마크 4점(상·하·좌·우)에서 x 중심과 반지름을 계산한다.
 * 좌우(p1, p3) 간 거리의 절반을 반지름으로 쓴다.
 * x 중심·반지름은 눈꺼풀의 영향을 덜 받아 랜드마크 기반이 더 정확하다.
 */
const extractIrisGeometryFromLandmarks = (
  landmarks: { x: number; y: number }[],
  irisIndices: [number, number, number, number],
  imageWidth: number,
  imageHeight: number,
): { centerX: number; radius: number } => {
  const [i0, i1, i2, i3] = irisIndices;
  const p0 = landmarks[i0];
  const p1 = landmarks[i1];
  const p3 = landmarks[i3];
  // x 중심: 4점 평균
  const centerX = ((p0.x + p1.x + landmarks[i2].x + p3.x) / 4) * imageWidth;
  // 반지름: 좌우 점(p1=우, p3=좌) 간 거리의 절반
  const dx = (p1.x - p3.x) * imageWidth;
  const dy = (p1.y - p3.y) * imageHeight;
  const radius = Math.sqrt(dx * dx + dy * dy) / 2;
  return { centerX, radius };
};

/**
 * 눈 개구부 마스크 안에서 BFS로 어두운 픽셀의 연결 클러스터를 찾아
 * y 중심을 결정한다. x 중심·반지름은 iris 랜드마크에서 가져온다.
 *
 * iris 랜드마크: x 위치·반지름은 정확하지만 y가 실제보다 위에 찍힘
 * BFS 클러스터: 화장·그림자에 취약하지만 y 무게중심은 비교적 안정적
 * → x·반지름은 랜드마크, y는 BFS 무게중심으로 조합해 각각의 약점을 보완한다.
 *
 * @param mask - 눈 개구부 폴리곤 마스크 (내부 255, 외부 0)
 * @param originalImageData - 원본 이미지 픽셀 데이터
 * @param irisLandmarkIndices - iris 랜드마크 인덱스 4개 [중심, 우, 하, 좌]
 * @param landmarks - FaceLandmarker 전체 랜드마크 배열
 * @param imageWidth - 이미지 너비
 * @param imageHeight - 이미지 높이
 * @returns irisMask: 홍채 픽셀이 255인 마스크, scleraMask: 흰자 픽셀이 255인 마스크
 */
const splitIrisAndSclera = (
  mask: Uint8ClampedArray,
  originalImageData: ImageData,
  irisLandmarkIndices: [number, number, number, number],
  landmarks: { x: number; y: number }[],
  imageWidth: number,
  imageHeight: number,
): { irisMask: Uint8ClampedArray; scleraMask: Uint8ClampedArray } => {
  const irisMask   = new Uint8ClampedArray(mask.length);
  const scleraMask = new Uint8ClampedArray(mask.length);

  // 마스크 내부 픽셀의 luminance 수집 → 하위 35%를 "어두운 픽셀" 임계값으로 삼는다.
  // 중앙값(50%) 대신 35%를 쓰는 이유: 홍채는 눈 전체 면적의 절반 이하이므로
  // 하위 35%로 잘라야 흰자·눈꺼풀 피부가 어두운 픽셀로 오분류되는 빈도가 줄어든다.
  const luminances: { index: number; lum: number }[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) continue;
    const r = originalImageData.data[i * 4];
    const g = originalImageData.data[i * 4 + 1];
    const b = originalImageData.data[i * 4 + 2];
    luminances.push({ index: i, lum: 0.299 * r + 0.587 * g + 0.114 * b });
  }
  if (luminances.length === 0) return { irisMask, scleraMask };

  luminances.sort((a, b) => a.lum - b.lum);
  const darkThreshold = luminances[Math.floor(luminances.length * 0.35)].lum;

  // 어두운 픽셀 집합 생성
  const isDark = new Uint8ClampedArray(mask.length);
  for (const { index, lum } of luminances) {
    if (lum <= darkThreshold) isDark[index] = 1;
  }

  // BFS로 어두운 픽셀의 연결 클러스터 탐색
  const visited = new Uint8ClampedArray(mask.length);
  const clusters: number[][] = [];

  for (let i = 0; i < mask.length; i++) {
    if (!isDark[i] || visited[i]) continue;

    const cluster: number[] = [];
    const queue: number[] = [i];
    visited[i] = 1;

    while (queue.length > 0) {
      const current = queue.shift()!;
      cluster.push(current);
      const x = current % imageWidth;
      const y = Math.floor(current / imageWidth);

      // 상하좌우 4방향 이웃 탐색
      const neighbors = [
        y > 0              ? current - imageWidth : -1,
        y < imageHeight - 1 ? current + imageWidth : -1,
        x > 0              ? current - 1          : -1,
        x < imageWidth - 1  ? current + 1          : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor >= 0 && isDark[neighbor] && !visited[neighbor] && mask[neighbor] > 0) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
    clusters.push(cluster);
  }

  if (clusters.length === 0) return { irisMask, scleraMask };
  clusters.sort((a, b) => b.length - a.length);
  const irisCluster = clusters[0];

  // y 중심: BFS 가장 큰 클러스터의 무게중심 — 화장이 있어도 y 방향 무게중심은 비교적 안정적
  let sumY = 0;
  for (const pixelIndex of irisCluster) {
    sumY += Math.floor(pixelIndex / imageWidth);
  }
  const centerY = sumY / irisCluster.length;

  // x 중심·반지름: iris 랜드마크 기반 — 좌우는 눈꺼풀에 덜 가려져 정확도가 높음
  const { centerX, radius } = extractIrisGeometryFromLandmarks(
    landmarks, irisLandmarkIndices, imageWidth, imageHeight,
  );

  // 중심+반지름으로 원형 홍채 마스크 생성
  // BFS 클러스터 대신 원을 쓰는 이유: 눈꺼풀 그림자가 클러스터에 붙어있어도
  // 무게중심과 면적은 크게 흔들리지 않아 깔끔한 원형을 유지할 수 있다.
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

  // 눈 개구부 안에서 홍채 원 밖 픽셀 = 흰자
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 0 && irisMask[i] === 0) scleraMask[i] = 255;
  }

  return { irisMask, scleraMask };
};

/**
 * 마스크 영역을 글자로 빽빽하게 채운다.
 *
 * 핵심 설계: bounding box 크기의 소형 OffscreenCanvas만 사용한다.
 * displayWidth×displayHeight 전체 캔버스를 쓰면 마스크 외부 픽셀까지 처리해서
 * 노이즈가 생기고 성능도 나쁘다.
 *
 * 알고리즘:
 * 1. analysis bounding box → display 픽셀 좌표로 변환해 boxW×boxH 크기 결정
 * 2. glyphCanvas(boxW×boxH): 글자 그리드를 (0,0) 기준으로 그린다
 * 3. maskCanvas(boxW×boxH): bounding box 범위의 마스크만 흰색으로 그린다
 * 4. destination-in 합성으로 글자를 마스크 안에만 남긴다
 * 5. ctx.drawImage(glyphCanvas, boxX, boxY)로 정확한 위치에 붙인다
 */
const fillRegionWithGlyph = (
  ctx: CanvasRenderingContext2D,
  mask: Uint8ClampedArray,
  analysisWidth: number,
  analysisHeight: number,
  displayWidth: number,
  displayHeight: number,
  text: string,
  color: string,
  targetRows: number,
): void => {
  // bounding box 계산 (analysis 좌표)
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

  const scaleX = displayWidth / analysisWidth;
  const scaleY = displayHeight / analysisHeight;

  // bounding box를 display 픽셀 좌표로 변환 (정수)
  const boxX = Math.floor(minCol * scaleX);
  const boxY = Math.floor(minRow * scaleY);
  const boxW = Math.ceil((maxCol + 1) * scaleX) - boxX;
  const boxH = Math.ceil((maxRow + 1) * scaleY) - boxY;

  if (boxW <= 0 || boxH <= 0) return;

  // fontSize: bounding box 높이를 targetRows로 나눈 값
  const fontSize = Math.max(4, Math.round(boxH / targetRows));

  // Step 1: glyphCanvas — boxW×boxH 크기, (0,0) 기준으로 글자 그리드
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

  // Step 2: maskCanvas — bounding box 범위의 analysis 마스크를 display 픽셀로 확장
  const maskCanvas = new OffscreenCanvas(boxW, boxH);
  const maskCtx = maskCanvas.getContext('2d')!;
  const maskImageData = maskCtx.createImageData(boxW, boxH);

  for (let dy = 0; dy < boxH; dy++) {
    // display 픽셀 (boxX+dx, boxY+dy) → analysis 픽셀 좌표
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

  // Step 3: destination-in으로 글자를 마스크 안에만 남긴다
  glyphCtx.globalCompositeOperation = 'destination-in';
  glyphCtx.drawImage(maskCanvas, 0, 0);

  // Step 4: 정확한 위치(boxX, boxY)에 붙인다
  ctx.drawImage(glyphCanvas, boxX, boxY);
};

export default function Page() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const [phase, setPhase] = useState<LoadingPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadModel = async (): Promise<void> => {
      setPhase('model-loading');
      try {
        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
        );
        faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'IMAGE',
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });
        setPhase('idle');
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '모델 로드 실패');
        setPhase('error');
      }
    };

    loadModel();
    return () => { faceLandmarkerRef.current?.close(); };
  }, []);

  const handleImageFileSelect = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file || !faceLandmarkerRef.current) return;

    setPhase('analyzing');
    setErrorMessage(null);

    try {
      const objectUrl = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = objectUrl;
      });
      URL.revokeObjectURL(objectUrl);

      const MAX_ANALYSIS_SIZE = 600;
      const scale = Math.min(1, MAX_ANALYSIS_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
      const analysisWidth  = Math.round(img.naturalWidth  * scale);
      const analysisHeight = Math.round(img.naturalHeight * scale);

      const analysisCanvas = new OffscreenCanvas(analysisWidth, analysisHeight);
      const analysisCtx = analysisCanvas.getContext('2d')!;
      analysisCtx.drawImage(img, 0, 0, analysisWidth, analysisHeight);

      const analysisBitmap = await createImageBitmap(analysisCanvas);
      const result = faceLandmarkerRef.current.detect(analysisBitmap);
      analysisBitmap.close();

      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      // 원본 이미지를 50% 투명도로 깔아서 위치 참조용으로 남긴다
      ctx.drawImage(img, 0, 0);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, img.naturalWidth, img.naturalHeight);
      ctx.globalAlpha = 1.0;

      if (result.faceLandmarks[0]) {
        const landmarks = result.faceLandmarks[0];
        const W = img.naturalWidth;
        const H = img.naturalHeight;

        const analysisImageData = analysisCtx.getImageData(0, 0, analysisWidth, analysisHeight);

        // 각 영역 마스크 생성
        const faceOvalMask       = createPolygonMask(FACE_OVAL_CONTOUR,     landmarks, analysisWidth, analysisHeight);
        const rightEyebrowMask   = createPolygonMask(RIGHT_EYEBROW_CONTOUR, landmarks, analysisWidth, analysisHeight);
        const leftEyebrowMask    = createPolygonMask(LEFT_EYEBROW_CONTOUR,  landmarks, analysisWidth, analysisHeight);
        const noseMask           = createPolygonMask(NOSE_CONTOUR,          landmarks, analysisWidth, analysisHeight);
        const lipsMask           = createPolygonMask(LIPS_CONTOUR,          landmarks, analysisWidth, analysisHeight);
        const rightEyeMask       = createPolygonMask(RIGHT_EYE_CONTOUR,     landmarks, analysisWidth, analysisHeight);
        const leftEyeMask        = createPolygonMask(LEFT_EYE_CONTOUR,      landmarks, analysisWidth, analysisHeight);

        // 홍채/흰자 분리
        const { irisMask: rightIrisMask, scleraMask: rightScleraMask } = splitIrisAndSclera(
          rightEyeMask, analysisImageData, [469, 470, 471, 472], landmarks, analysisWidth, analysisHeight,
        );
        const { irisMask: leftIrisMask, scleraMask: leftScleraMask } = splitIrisAndSclera(
          leftEyeMask, analysisImageData, [474, 475, 476, 477], landmarks, analysisWidth, analysisHeight,
        );

        // 얼굴 외곽 안에서 세부 영역을 제외한 피부 마스크
        // faceOval 픽셀 중 눈썹·코·입·눈이 아닌 픽셀 = 피부
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

        // 렌더링 순서: 피부 → 눈썹 → 코 → 입 → 흰자 → 홍채
        // targetRows: bounding box 높이를 몇 행으로 나눌지. 클수록 작고 빽빽한 글자.
        fillRegionWithGlyph(ctx, skinMask,         analysisWidth, analysisHeight, W, H, 'FACE',  '#4ade80', 20);
        fillRegionWithGlyph(ctx, rightEyebrowMask, analysisWidth, analysisHeight, W, H, 'BROW',  '#facc15', 3);
        fillRegionWithGlyph(ctx, leftEyebrowMask,  analysisWidth, analysisHeight, W, H, 'BROW',  '#facc15', 3);
        fillRegionWithGlyph(ctx, noseMask,         analysisWidth, analysisHeight, W, H, 'NOSE',  '#38bdf8', 6);
        fillRegionWithGlyph(ctx, lipsMask,         analysisWidth, analysisHeight, W, H, 'LIPS',  '#f472b6', 4);
        fillRegionWithGlyph(ctx, rightScleraMask,  analysisWidth, analysisHeight, W, H, 'EYE',   '#e2e8f0', 2);
        fillRegionWithGlyph(ctx, leftScleraMask,   analysisWidth, analysisHeight, W, H, 'EYE',   '#e2e8f0', 2);
        fillRegionWithGlyph(ctx, rightIrisMask,    analysisWidth, analysisHeight, W, H, 'IRIS',  '#3b82f6', 2);
        fillRegionWithGlyph(ctx, leftIrisMask,     analysisWidth, analysisHeight, W, H, 'IRIS',  '#3b82f6', 2);
      }

      setPhase('done');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '분석 실패');
      setPhase('error');
    }
  };

  return (
    <main className="min-h-screen p-8 flex flex-col items-center gap-6">
      <h1 className="text-2xl font-bold">Glyph Canvas — 랜드마크 디버그</h1>

      <div className="flex flex-col items-center gap-3">
        <input
          type="file"
          accept="image/*"
          onChange={handleImageFileSelect}
          disabled={phase === 'model-loading' || phase === 'analyzing'}
          className="cursor-pointer"
        />
        <p className="text-sm text-muted-foreground">
          {phase === 'model-loading' && '모델 로딩 중...'}
          {phase === 'analyzing' && '분석 중...'}
          {phase === 'done' && 'FACE · BROW · NOSE · LIPS · EYE · IRIS'}
          {phase === 'error' && `오류: ${errorMessage}`}
          {phase === 'idle' && '이미지를 업로드하세요'}
        </p>
      </div>

      <canvas
        ref={canvasRef}
        className="max-w-full border border-border"
        style={{ maxHeight: '80vh', objectFit: 'contain' }}
      />
    </main>
  );
}
