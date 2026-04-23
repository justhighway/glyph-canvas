'use client';

import {
  FaceLandmarker,
  FilesetResolver,
  ImageSegmenter,
} from '@mediapipe/tasks-vision';
import {
  parseFaceLandmarkerResult,
  parseSegmenterConfidenceMasks,
} from '@/lib/mediapipe-parser';
import { useEffect, useRef, useState } from 'react';

import type { AnalysisPhase } from '@/types';
import type { PortraitAnalysisResult } from '@/types/portrait';
import { SELFIE_SEGMENTATION_THRESHOLD } from '@/constants/config';

type UsePortraitAnalysisReturn = {
  /** 인물 분석 실행. 완료 시 결과를 반환하고, 실패 시 null을 반환한다. */
  runPortraitAnalysis: (imageFile: File) => Promise<PortraitAnalysisResult | null>;
  result: PortraitAnalysisResult | null;
  analysisPhase: AnalysisPhase;
  /** MediaPipe 모델 로딩 완료 여부 */
  isModelReady: boolean;
  errorMessage: string | null;
};

/**
 * MediaPipe Face Landmarker + Image Segmenter를 사용해
 * 인물 사진에서 신체 부위별 마스크를 추출하는 훅.
 *
 * 훅이 마운트될 때 모델을 로드하고, 언마운트될 때 모델을 해제한다.
 * 모델 로드는 최초 1회만 일어나고 이후 분석은 즉시 실행된다.
 */
export function usePortraitAnalysis(): UsePortraitAnalysisReturn {
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const imageSegmenterRef = useRef<ImageSegmenter | null>(null);

  const [isModelReady, setIsModelReady] = useState(false);
  const [result, setResult] = useState<PortraitAnalysisResult | null>(null);
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    /**
     * MediaPipe WASM 바이너리와 모델 파일을 CDN에서 내려받아 초기화한다.
     * FilesetResolver는 WASM 바이너리의 위치를 알려주는 역할이고,
     * FaceLandmarker/ImageSegmenter는 그 위에서 동작하는 ML 모델이다.
     */
    const loadModels = async (): Promise<void> => {
      try {
        setAnalysisPhase('loading');

        const visionFileset = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm',
        );

        const [faceLandmarker, imageSegmenter] = await Promise.all([
          FaceLandmarker.createFromOptions(visionFileset, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            },
            // IMAGE 모드: 정지 이미지 한 장씩 처리 (VIDEO 모드는 연속 프레임용)
            runningMode: 'IMAGE',
            numFaces: 1,
            outputFaceBlendshapes: false,
            // 동양인 얼굴처럼 특징점이 서양인보다 평탄한 경우 감지 실패율이 높다.
            // 기본값(0.5)보다 낮춰 감지 감도를 높인다.
            minFaceDetectionConfidence: 0.3,
            minFacePresenceConfidence: 0.3,
            minTrackingConfidence: 0.3,
          }),

          ImageSegmenter.createFromOptions(visionFileset, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
            },
            runningMode: 'IMAGE',
            // confidence mask: 각 픽셀이 각 클래스에 속할 확률을 0~1로 반환
            outputConfidenceMasks: true,
            outputCategoryMask: false,
          }),
        ]);

        faceLandmarkerRef.current = faceLandmarker;
        imageSegmenterRef.current = imageSegmenter;
        setIsModelReady(true);
        setAnalysisPhase('idle');
      } catch {
        setErrorMessage(
          'AI 모델 로딩에 실패했습니다. 페이지를 새로고침해주세요.',
        );
        setAnalysisPhase('error');
      }
    };

    loadModels();

    return () => {
      // 훅 언마운트 시 모델을 메모리에서 해제한다
      faceLandmarkerRef.current?.close();
      imageSegmenterRef.current?.close();
    };
  }, []);

  const runPortraitAnalysis = async (
    imageFile: File,
  ): Promise<PortraitAnalysisResult | null> => {
    if (analysisPhase === 'loading' || !isModelReady) return null;
    if (!faceLandmarkerRef.current || !imageSegmenterRef.current) return null;

    setAnalysisPhase('loading');
    setErrorMessage(null);

    try {
      /**
       * MediaPipe는 HTMLImageElement를 입력으로 받는다.
       * File → Object URL → HTMLImageElement 순으로 변환해야 한다.
       * 변환 후 Object URL은 메모리 누수를 막기 위해 즉시 해제한다.
       */
      const imageElement = await fileToImageElement(imageFile);
      const { naturalWidth: imageWidth, naturalHeight: imageHeight } =
        imageElement;

      // 동양인 얼굴처럼 피부 색조 대비가 낮은 이미지에서 감지율을 높이기 위해
      // 밝기·대비를 약간 강화한 이미지를 MediaPipe에 전달한다.
      // 원본 픽셀 데이터는 그대로 유지하므로 렌더링 색상에는 영향 없다.
      const enhancedImageElement = await enhanceContrastForDetection(imageElement);

      const [faceLandmarkerResult, segmenterResult] = await Promise.all([
        faceLandmarkerRef.current.detect(enhancedImageElement),
        imageSegmenterRef.current.segment(enhancedImageElement),
      ]);

      const facePartDetections = parseFaceLandmarkerResult(
        faceLandmarkerResult,
        imageWidth,
        imageHeight,
      );

      /**
       * selfie_multiclass 모델의 클래스 인덱스:
       * 0: 배경, 1: 머리카락, 2: 몸통 피부(목/몸), 3: 얼굴 피부, 4: 옷, 5: 기타(악세서리)
       *
       * 채널 3을 faceOval + ear 두 용도로 활용한다.
       * - faceOval: 채널 3 전체 → 이마 포함 얼굴 피부를 픽셀 단위로 정확히 커버
       * - ear: 채널 3에서 faceOval 마스크 영역을 뺀 나머지 → 귀 측면
       * 채널 4+5를 합산해 목걸이 등 악세서리도 옷으로 처리한다.
       */
      const skinAndHairDetections = parseSegmenterConfidenceMasks(
        segmenterResult.confidenceMasks!,
        2, // 몸통 피부 (목/몸) → 'skin'
        1, // 머리카락 → 'hair'
        3, // 얼굴 피부 → 'faceOval' + 'ear'
        4, // 옷 → 'clothing'
        5, // 악세서리·기타 → 'clothing'에 합산
        SELFIE_SEGMENTATION_THRESHOLD,
      );

      const portraitResult: PortraitAnalysisResult = {
        bodyPartDetections: [...facePartDetections, ...skinAndHairDetections],
        imageWidth,
        imageHeight,
      };

      setResult(portraitResult);
      setAnalysisPhase('done');
      return portraitResult;
    } catch {
      setErrorMessage(
        '분석 중 오류가 발생했습니다. 다른 이미지를 시도해주세요.',
      );
      setAnalysisPhase('error');
      return null;
    }
  };

  return {
    runPortraitAnalysis,
    result,
    analysisPhase,
    isModelReady,
    errorMessage,
  };
}

/**
 * File 객체를 MediaPipe가 입력으로 받을 수 있는 HTMLImageElement로 변환한다.
 * 이미지 로딩이 완료될 때까지 기다리는 비동기 함수다.
 */
const fileToImageElement = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const imageElement = new Image();
    imageElement.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(imageElement);
    };
    imageElement.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('이미지 로딩 실패'));
    };
    imageElement.src = objectUrl;
  });

/**
 * 동양인 얼굴처럼 피부 대비가 낮은 이미지를 MediaPipe에 넘기기 전에
 * 밝기·대비를 보정해 감지율을 높인다.
 *
 * CSS filter의 contrast()·brightness()를 OffscreenCanvas에 적용하면
 * 브라우저가 GPU에서 처리해 빠르고, 결과를 HTMLImageElement로 변환해 반환한다.
 * 원본 File은 그대로이므로 렌더링 시 색상 샘플링에는 영향이 없다.
 *
 * @param imageElement - 원본 이미지 엘리먼트
 * @returns 대비·밝기가 보정된 HTMLImageElement
 */
const enhanceContrastForDetection = (imageElement: HTMLImageElement): Promise<HTMLImageElement> =>
  new Promise((resolve) => {
    const { naturalWidth, naturalHeight } = imageElement;
    const offscreen = new OffscreenCanvas(naturalWidth, naturalHeight);
    const context = offscreen.getContext('2d')!;

    // 대비 1.25배, 밝기 1.05배: 동양인 피부의 낮은 대비를 보정하면서
    // 과도한 노출로 특징점이 날아가지 않도록 조심스럽게 올린다.
    context.filter = 'contrast(1.25) brightness(1.05)';
    context.drawImage(imageElement, 0, 0);

    offscreen.convertToBlob().then((blob) => {
      const url = URL.createObjectURL(blob);
      const enhanced = new Image();
      enhanced.onload = () => {
        URL.revokeObjectURL(url);
        resolve(enhanced);
      };
      enhanced.src = url;
    });
  });
