import type { BodyPartDetection, BodyPartKey } from '@/types/portrait';

import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';

/**
 * Face Mesh 랜드마크 기반 부위 폴리곤.
 * faceOval은 폴리곤으로 이마를 포함한 얼굴 전체를 잡지 못하므로
 * selfie segmenter 채널 3(얼굴 피부)으로 대체한다.
 * ear도 Face Mesh 랜드마크로는 면적을 못 잡으므로 selfie segmenter로 대체한다.
 * 여기서는 눈·눈썹·코·입 세밀 부위만 Face Mesh로 처리한다.
 */
const FACE_PART_LANDMARK_POLYGONS: Record<
  Exclude<
    BodyPartKey,
    'skin' | 'hair' | 'clothing' | 'ear' | 'faceOval' | 'iris'
  >,
  number[][]
> = {
  // 눈: 실제 눈꺼풀 개구부(eye aperture) 속눈썹 경계 폴리곤.
  //
  // 출처: MediaPipe 공식 FACEMESH_RIGHT_EYE / FACEMESH_LEFT_EYE 엣지 셋
  // (google-ai-edge/mediapipe face_mesh_connections.py)
  //
  // 엣지 셋을 연결 그래프로 재구성해 자기교차 없는 단일 순환 폴리곤으로 정렬한다.
  // 위 눈꺼풀 라인(눈꼬리→눈머리)과 아래 눈꺼풀 라인(눈머리→눈꼬리)을 이어
  // 눈 개구부 전체를 하나의 닫힌 폴리곤으로 구성한다.
  //
  // 이미지 기준 왼쪽 눈 (MediaPipe FACEMESH_RIGHT_EYE):
  //   위: 33(눈꼬리)→246→161→160→159→158→157→173→133(눈머리)
  //   아래: 133→155→154→153→145→144→163→7→33
  // 이미지 기준 오른쪽 눈 (MediaPipe FACEMESH_LEFT_EYE):
  //   위: 263(눈꼬리)→466→388→387→386→385→384→398→362(눈머리)
  //   아래: 362→382→381→380→374→373→390→249→263
  eye: [
    [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7, 33],
    [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249, 263],
  ],
  // 눈썹: 눈썹 전체 + 아래쪽 눈꺼풀까지 포함해 눈썹-눈 사이 빈 공간을 줄인다.
  eyebrow: [
    [46, 53, 52, 65, 55, 107, 66, 105, 63, 70, 46],
    [276, 283, 282, 295, 285, 336, 296, 334, 293, 300, 276],
  ],
  // 코: 폴리곤 두 개로 전체 코를 커버한다.
  // [0] 콧대: 미간(6) ~ 코끝(4) ~ 콧볼(129,358) ~ 비익(49,279) 외곽 윤곽
  // [1] 콧구멍·콧볼 하단: 기존 폴리곤 그대로 유지
  nose: [
    [6, 197, 195, 5, 4, 1, 19, 94, 2, 164, 393, 391, 3, 196, 197, 6],
    [
      49, 131, 134, 51, 5, 281, 363, 360, 279, 331, 294, 327, 326, 2, 97, 98,
      60, 166, 59, 49,
    ],
  ],
  // 입술: 외곽 립 라인 전체 (윗입술+아랫입술+입꼬리).
  mouth: [
    [
      61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17,
      84, 181, 91, 146, 61,
    ],
  ],
};

/**
 * 랜드마크 폴리곤 배열과 이미지 크기를 받아 마스크를 생성한다.
 * 각 폴리곤을 독립적으로 beginPath → fill해야 왼눈/오른눈처럼
 * 분리된 영역이 하나의 경로로 이어지지 않는다.
 */
const createMaskFromLandmarkPolygons = (
  polygons: number[][],
  allLandmarks: { x: number; y: number }[],
  imageWidth: number,
  imageHeight: number,
): Uint8ClampedArray => {
  const offscreenCanvas = new OffscreenCanvas(imageWidth, imageHeight);
  const context = offscreenCanvas.getContext('2d')!;

  context.fillStyle = 'white';

  for (const landmarkIndices of polygons) {
    context.beginPath();
    landmarkIndices.forEach((landmarkIndex, i) => {
      const landmark = allLandmarks[landmarkIndex];
      const x = landmark.x * imageWidth;
      const y = landmark.y * imageHeight;
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.fill();
  }

  const imageData = context.getImageData(0, 0, imageWidth, imageHeight);
  const mask = new Uint8ClampedArray(imageWidth * imageHeight);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = imageData.data[i * 4];
  }

  return mask;
};

/**
 * iris 랜드마크 4점(상·하·좌·우)에서 중심과 반지름을 계산해 원형 마스크를 생성한다.
 * 4점을 폴리곤으로 채우면 마름모꼴이 나오므로, arc()로 원을 그려 실제 홍채 모양에 맞춘다.
 *
 * MediaPipe iris 인덱스 배치:
 *   RIGHT_IRIS(이미지 왼쪽): 469(중심?), 470(우), 471(하), 472(좌) — 실제로는 둘레 4점
 *   LEFT_IRIS(이미지 오른쪽): 474(중심?), 475(우), 476(하), 477(좌)
 * 4점의 중심과 좌우 거리의 절반을 반지름으로 사용한다.
 */
const createIrisMask = (
  allLandmarks: { x: number; y: number }[],
  imageWidth: number,
  imageHeight: number,
): Uint8ClampedArray => {
  // 이미지 기준 왼쪽 눈: MediaPipe RIGHT_IRIS (469~472)
  // 이미지 기준 오른쪽 눈: MediaPipe LEFT_IRIS (474~477)
  const irisPairs: [number, number, number, number][] = [
    [469, 470, 471, 472],
    [474, 475, 476, 477],
  ];

  const offscreenCanvas = new OffscreenCanvas(imageWidth, imageHeight);
  const context = offscreenCanvas.getContext('2d')!;
  context.fillStyle = 'white';

  for (const [i0, i1, i2, i3] of irisPairs) {
    const p0 = allLandmarks[i0];
    const p1 = allLandmarks[i1];
    const p2 = allLandmarks[i2];
    const p3 = allLandmarks[i3];

    // 4점의 평균으로 중심 계산
    const cx = ((p0.x + p1.x + p2.x + p3.x) / 4) * imageWidth;
    const cy = ((p0.y + p1.y + p2.y + p3.y) / 4) * imageHeight;

    // 좌우 점 간 거리의 절반을 반지름으로 사용 (수평 직경 기준)
    const dx = (p1.x - p3.x) * imageWidth;
    const dy = (p1.y - p3.y) * imageHeight;
    const radius = Math.sqrt(dx * dx + dy * dy) / 2;

    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fill();
  }

  const imageData = context.getImageData(0, 0, imageWidth, imageHeight);
  const mask = new Uint8ClampedArray(imageWidth * imageHeight);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = imageData.data[i * 4];
  }
  return mask;
};

/**
 * MediaPipe FaceLandmarker 결과를 BodyPartDetection 배열로 변환한다.
 * faceOval과 ear는 selfie segmenter로 처리하므로 여기서는 제외한다.
 * 세밀한 부위(eye, eyebrow, nose, mouth)와 iris(동공·홍채)를 Face Mesh로 처리한다.
 *
 * @param faceLandmarkerResult - MediaPipe FaceLandmarker가 반환한 원시 결과
 * @param imageWidth - 분석한 이미지 너비
 * @param imageHeight - 분석한 이미지 높이
 * @returns 부위별 BodyPartDetection 배열. 얼굴이 감지되지 않으면 빈 배열.
 */
export const parseFaceLandmarkerResult = (
  faceLandmarkerResult: FaceLandmarkerResult,
  imageWidth: number,
  imageHeight: number,
): BodyPartDetection[] => {
  const [firstFaceLandmarks] = faceLandmarkerResult.faceLandmarks;

  if (process.env.NODE_ENV !== 'production') {
    console.log(
      '[FaceLandmarker] detected faces:',
      faceLandmarkerResult.faceLandmarks.length,
      firstFaceLandmarks
        ? `(${firstFaceLandmarks.length} landmarks)`
        : '(none)',
    );
  }

  if (!firstFaceLandmarks) return [];

  const partKeys = Object.keys(FACE_PART_LANDMARK_POLYGONS) as Exclude<
    BodyPartKey,
    'skin' | 'hair' | 'clothing' | 'ear' | 'faceOval' | 'iris'
  >[];

  const facePartDetections: BodyPartDetection[] = partKeys.map(
    (bodyPartKey) => {
      const mask = createMaskFromLandmarkPolygons(
        FACE_PART_LANDMARK_POLYGONS[bodyPartKey],
        firstFaceLandmarks,
        imageWidth,
        imageHeight,
      );
      if (process.env.NODE_ENV !== 'production') {
        const nonZeroCount = mask.reduce((sum, v) => sum + (v > 0 ? 1 : 0), 0);
        console.log(
          `[FaceLandmarker] ${bodyPartKey} mask non-zero pixels: ${nonZeroCount} / ${mask.length}`,
        );
      }
      return {
        bodyPartKey,
        mask,
        maskWidth: imageWidth,
        maskHeight: imageHeight,
      };
    },
  );

  // iris 마스크: 4점 랜드마크에서 원을 그려 동공·홍채 영역을 생성한다.
  const irisMask = createIrisMask(firstFaceLandmarks, imageWidth, imageHeight);
  if (process.env.NODE_ENV !== 'production') {
    const nonZeroCount = irisMask.reduce((sum, v) => sum + (v > 0 ? 1 : 0), 0);
    console.log(
      `[FaceLandmarker] iris mask non-zero pixels: ${nonZeroCount} / ${irisMask.length}`,
    );
  }

  return [
    ...facePartDetections,
    {
      bodyPartKey: 'iris',
      mask: irisMask,
      maskWidth: imageWidth,
      maskHeight: imageHeight,
    },
  ];
};

/**
 * MediaPipe ImageSegmenter 결과를 BodyPartDetection 배열로 변환한다.
 *
 * 채널 역할:
 * - 채널 1: 머리카락 → 'hair'
 * - 채널 2: 목·몸통 피부 → 'skin'
 * - 채널 3: 얼굴 피부 → 'faceOval' (이마 포함 얼굴 전체를 픽셀 단위로 정확히 잡음)
 *           + 'ear' (faceOval 마스크 바깥 영역 = 귀 측면. 렌더러에서 AND NOT으로 분리)
 * - 채널 4+5: 옷·악세서리 → 'clothing' (OR 합산으로 목걸이 등 포함)
 *
 * @param confidenceMasks - ImageSegmenter가 반환한 채널별 확률 맵
 * @param bodySkinChannelIndex - 목·몸통 피부 채널 (2)
 * @param hairChannelIndex - 머리카락 채널 (1)
 * @param faceSkinChannelIndex - 얼굴 피부 채널 (3) → faceOval + ear 용도
 * @param clothingChannelIndex - 옷 채널 (4)
 * @param accessoryChannelIndex - 기타(악세서리) 채널 (5) → clothing에 합산
 * @param threshold - 해당 부위로 판단하는 최소 확률값
 */
export const parseSegmenterConfidenceMasks = (
  confidenceMasks: {
    getAsFloat32Array: () => Float32Array;
    width: number;
    height: number;
  }[],
  bodySkinChannelIndex: number,
  hairChannelIndex: number,
  faceSkinChannelIndex: number,
  clothingChannelIndex: number,
  accessoryChannelIndex: number,
  threshold: number,
): BodyPartDetection[] => {
  const toMask = (
    channelIndex: number,
    overrideThreshold?: number,
  ): { mask: Uint8ClampedArray; maskWidth: number; maskHeight: number } => {
    const channel = confidenceMasks[channelIndex];
    const floatArray = channel.getAsFloat32Array();
    const effectiveThreshold = overrideThreshold ?? threshold;
    const mask = new Uint8ClampedArray(floatArray.length);
    for (let i = 0; i < floatArray.length; i++) {
      mask[i] = floatArray[i] > effectiveThreshold ? 255 : 0;
    }
    return { mask, maskWidth: channel.width, maskHeight: channel.height };
  };

  // 옷(4)과 악세서리·기타(5)를 OR 합산해 목걸이 등이 누락되지 않도록 한다.
  const clothingChannel = confidenceMasks[clothingChannelIndex];
  const accessoryChannel = confidenceMasks[accessoryChannelIndex];
  const clothingFloats = clothingChannel.getAsFloat32Array();
  const accessoryFloats = accessoryChannel.getAsFloat32Array();
  const combinedClothingMask = new Uint8ClampedArray(clothingFloats.length);
  for (let i = 0; i < clothingFloats.length; i++) {
    combinedClothingMask[i] =
      clothingFloats[i] > threshold || accessoryFloats[i] > threshold ? 255 : 0;
  }
  const combinedClothing = {
    mask: combinedClothingMask,
    maskWidth: clothingChannel.width,
    maskHeight: clothingChannel.height,
  };

  // 몸통 피부(채널 2)는 피부 노출이 많은 사진에서 확률값이 낮게 나오는 경향이 있다.
  // 별도 낮은 threshold(0.2)를 적용해 벗은 몸 인식률을 높인다.
  const BODY_SKIN_THRESHOLD = Math.min(threshold, 0.2);

  const faceSkinMask = toMask(faceSkinChannelIndex);

  return [
    {
      bodyPartKey: 'skin',
      ...toMask(bodySkinChannelIndex, BODY_SKIN_THRESHOLD),
    },
    { bodyPartKey: 'hair', ...toMask(hairChannelIndex) },
    // faceOval과 ear 모두 채널 3을 원본으로 사용한다.
    // 렌더러(use-canvas-render.ts)에서 ear 처리 시 faceOval 마스크 영역을 빼서 분리한다.
    { bodyPartKey: 'faceOval', ...faceSkinMask },
    { bodyPartKey: 'ear', ...faceSkinMask },
    { bodyPartKey: 'clothing', ...combinedClothing },
  ];
};
